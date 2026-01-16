import * as vscode from "vscode";
import { Filter, FocusAction } from "./filter";
import { FocusProvider } from "./focusProvider";
import { FilterTreeViewProvider } from "./filterTreeViewProvider";
import { ProjectTreeViewProvider } from "./projectTreeViewProvider";

export function generateId(category: 'filter' | 'group' | 'project'): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).slice(2, 11);
    return `${category}-${timestamp}-${randomString}`;
}

export type Group = {
    filters: Map<string, Filter>; // id of filters in this group
    isHighlighted: boolean; // if the matching lines will be highlighted
    focusAction: FocusAction; // default focus action for new filters in group
    name: string;
    id: string; //random generated number
    priority: number; // base priority for filters in this group
};
export function createGroup(name: string): Group {
    return {
        filters: new Map<string, Filter>(),
        isHighlighted: true,
        focusAction: FocusAction.INCLUDED,
        name: name,
        id: generateId("group"),
        priority: 100
    };
}

export type Project = {
    filters: Map<string, Filter>; // All filters in the project (including those in groups)
    groups: Map<string, Group>;   // All groups in the project
    name: string;
    id: string;
    selected: boolean;
    filteringEnabled: boolean; // global filter toggle
};
export function createProject(name: string): Project {
    return {
        filters: new Map<string, Filter>(),
        groups: new Map<string, Group>(),
        name: name,
        id: name, //,
        selected: false,
        filteringEnabled: true
    };
};

// Global state of the extension
export type State = {
    // Maps for fast lookups (automatically synced with arrays)
    projectsMap: Map<string, Project>; // name to project
    selectedProject: Project | null;
    filterTreeViewProvider: FilterTreeViewProvider;
    projectTreeViewProvider: ProjectTreeViewProvider;
    focusProvider: FocusProvider;
    globalStorageUri: vscode.Uri;
    outputChannel: vscode.OutputChannel;
};
export function createState(globalStorageUri: vscode.Uri, outputChannel: vscode.OutputChannel): State {
    return {
        projectsMap: new Map<string, Project>(),
        selectedProject: null,
        filterTreeViewProvider: new FilterTreeViewProvider(null),
        projectTreeViewProvider: new ProjectTreeViewProvider([]),
        focusProvider: new FocusProvider(),
        globalStorageUri: globalStorageUri,
        outputChannel: outputChannel
    };
}

/**
 * Helper function: Get filters in a group sorted by priority (descending)
 */
export function getSortedFiltersInGroup(group: Group): Filter[] {
    return Array.from(group.filters.values())
        .sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
}

/**
 * Build a combined regex from multiple filters sorted by priority
 * Returns the regex and a map to track which filter each capture group belongs to
 */
export function buildCombinedRegex(filters: Filter[]): {
    regex: RegExp;
    filterMap: Map<number, { filterId: string; isExclude: boolean }>;
} {
    if (filters.length === 0) {
        return { regex: /(?!)/, filterMap: new Map() };
    }

    const filterMap = new Map<number, { filterId: string; isExclude: boolean }>();
    const patterns: string[] = [];

    // Sort by priority (descending: higher priority first)
    const sorted = [...filters].sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));

    sorted.forEach((filter, index) => {
        patterns.push(`(${filter.regex.source})`);
        filterMap.set(index + 1, { 
            filterId: filter.id, 
            isExclude: filter.focusAction === FocusAction.EXCLUDED 
        });
    });

    const combined = patterns.join('|');
    return {
        regex: new RegExp(combined, 'gm'),
        filterMap
    };
}

/**
 * Perform single-pass regex analysis on text
 * Returns matched line numbers for each filter and priority winner for each line
 */
export function performCombinedAnalysis(
    text: string,
    combinedRegex: RegExp,
    filterMap: Map<number, { filterId: string; isExclude: boolean }>
): { 
    filterResults: Map<string, { lines: Set<number>; isExclude: boolean }>;
    linePriorityWinners: Map<number, string>;
} {
    const filterResults = new Map<string, { lines: Set<number>; isExclude: boolean }>();
    const linePriorityWinners = new Map<number, string>();

    // Initialize result map for all filters
    filterMap.forEach(({ filterId, isExclude }) => {
        filterResults.set(filterId, { lines: new Set(), isExclude });
    });

    // Scan each line
    const lines = text.split('\n');
    lines.forEach((line, lineIndex) => {
        let match;
        combinedRegex.lastIndex = 0;
        
        let bestFilterIndex = Infinity;
        
        while ((match = combinedRegex.exec(line)) !== null) {
            // Check which capture group matched (group 1+ are filters)
            for (let i = 1; i < match.length; i++) {
                if (match[i] !== undefined) {
                    const filterInfo = filterMap.get(i);
                    if (filterInfo) {
                        filterResults.get(filterInfo.filterId)!.lines.add(lineIndex);
                        if (i < bestFilterIndex) {
                            bestFilterIndex = i;
                        }
                    }
                    // IMPORTANT: We continue checking other groups in the same match
                    // but usually only one group matches at one position in (A)|(B)
                }
            }

            // prevent infinite loop with zero-length matches
            if (match.index === combinedRegex.lastIndex) {
                combinedRegex.lastIndex++;
            }
        }

        if (bestFilterIndex !== Infinity) {
            const winner = filterMap.get(bestFilterIndex);
            if (winner) {
                linePriorityWinners.set(lineIndex, winner.filterId);
            }
        }
    });

    return { filterResults, linePriorityWinners };
}
