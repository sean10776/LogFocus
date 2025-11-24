import * as vscode from "vscode";
import { Filter } from "./filter";
import { FocusProvider } from "./focusProvider";
import { FilterTreeViewProvider } from "./filterTreeViewProvider";
import { ProjectTreeViewProvider } from "./projectTreeViewProvider";

// Large file handling configuration
export const LARGE_FILE_CONFIG = {
    // Large file size threshold (10MB)
    SIZE_THRESHOLD: 10 * 1024 * 1024,
    
    // Enable large file optimization
    ENABLE_LARGE_FILE_OPTIMIZATION: true,
    
    // Maximum lines to process in large file mode
    MAX_LINES_TO_PROCESS: 10000,
};

export function generateId(category: 'filter' | 'group' | 'project'): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).slice(2, 11);
    return `${category}-${timestamp}-${randomString}`;
}

export type Group = {
    filters: Map<string, Filter>; // id of filters in this group
    isHighlighted: boolean; // if the matching lines will be highlighted
    isShown: boolean; //if the matching lines will be kept in focus mode
    name: string;
    id: string; //random generated number
};
export function createGroup(name: string): Group {
    return {
        filters: new Map<string, Filter>(),
        isHighlighted: true,
        isShown: true,
        name: name,
        id: generateId("group")
    };
}

export type Project = {
    filters: Map<string, Filter>; // For quick access to all filters in the project. The filter are same as in groups
    groups: Map<string, Group>; // name to group
    name: string;
    id: string;
    selected: boolean;
};
export function createProject(name: string): Project {
    return {
        filters: new Map<string, Filter>(),
        groups: new Map<string, Group>(),
        name: name,
        id: name, //,
        selected: false
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
};
export function createState(globalStorageUri: vscode.Uri): State {
    return {
        projectsMap: new Map<string, Project>(),
        selectedProject: null,
        filterTreeViewProvider: new FilterTreeViewProvider([]),
        projectTreeViewProvider: new ProjectTreeViewProvider([]),
        focusProvider: new FocusProvider(),
        globalStorageUri: globalStorageUri
    };
}

export function setStatusBarMessage(message: string) {
    vscode.window.setStatusBarMessage(`LOG ANALYSIS: ${message}`, 5000);
}
