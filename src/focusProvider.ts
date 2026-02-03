import * as vscode from "vscode";
import { Project, buildCombinedRegex, performCombinedAnalysis } from "./utils";
import { Filter, FocusAction } from "./filter";
import * as path from "path";

/**
 * Provides read-only virtual documents that contain only lines matching shown filters.
 * 
 * This provider creates virtual documents with URIs of the form "focus:<original uri>"
 * where <original uri> is the escaped URI of the original document.
 * 
 * The documents created by this provider are automatically READ-ONLY by VS Code design.
 * Users cannot edit these virtual documents - they serve as filtered views of the original files.
 * 
 * Responsibilities:
 * - Generate filtered content (provideTextDocumentContent)
 * - Provide focus mode marker decoration (static methods)
 * - Provide helper methods for calculating visible lines
 */
export class FocusProvider implements vscode.TextDocumentContentProvider {
    project: Project | null;

    constructor(project: Project | null = null) {
        this.project = project;
    }

    // Focus mode marker decoration (identity of focus mode)
    private static readonly focusDecorationType = vscode.window.createTextEditorDecorationType({
        before: {
            contentText: ">>>>>>>focus mode<<<<<<<",
            color: "#888888",
        },
    });
    private static readonly focusDecorationRangeArray = [
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 0)),
    ];

    /**
     * Apply focus mode marker decoration to editor
     * This is the visual identity of focus mode documents
     */
    static applyFocusModeMarker(editor: vscode.TextEditor): void {
        if (!FocusProvider.isFocusUri(editor.document.uri)) {
            return;
        }
        editor.setDecorations(
            FocusProvider.focusDecorationType, 
            FocusProvider.focusDecorationRangeArray
        );
    }

    /**
     * Provides read-only text content for virtual focus documents.
     * Only responsible for generating filtered content, not decorations.
     * 
     * @param uri Virtual document URI in format "focus:/Focus: filename?source=<encoded-original-uri>"
     * @returns Promise<string> Filtered content as read-only text
     */
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        try {
            const queryParams = new URLSearchParams(uri.query);
            const originalUriString = queryParams.get('source');

            const inputUriString = originalUriString ? decodeURIComponent(originalUriString) : uri.path;
            const originalUri = vscode.Uri.parse(inputUriString);
            const sourceDocument = await vscode.workspace.openTextDocument(originalUri);
            
            // Perform optimized analysis if filters haven't been analyzed for this URI
            const { inclusiveFilters, exclusiveFilters } = this.getActiveFiltersSorted();
            const allFilters = [...inclusiveFilters, ...exclusiveFilters];
            const uriString = originalUri.toString();
            
            const needsAnalysis = allFilters.some(f => !f.isAnalyzed(uriString));
            
            if (needsAnalysis) {
                await this.performOnDemandAnalysis(sourceDocument);
            }
            
            return this.generateFilteredContent(uriString, sourceDocument);
        } catch (e) {
            console.error('[FocusProvider] Error:', e);
            return `[ERROR] Failed to generate focus content: ${e}`;
        }
    }

    /**
     * Perform optimized on-demand analysis using combined regex - O(m) time complexity
     * Fallback to ensure focus mode works even if filters weren't pre-analyzed
     */
    private async performOnDemandAnalysis(document: vscode.TextDocument): Promise<void> {
        const { inclusiveFilters, exclusiveFilters } = this.getActiveFiltersSorted();
        const allFilters = [...inclusiveFilters, ...exclusiveFilters];
        
        if (allFilters.length === 0) {return;}
        
        const text = document.getText();
        const { regex: combinedRegex, filterMap } = buildCombinedRegex(allFilters);
        const { filterResults } = performCombinedAnalysis(text, combinedRegex, filterMap);

        // Cache results for each filter per URI
        const uriString = document.uri.toString();
        filterResults.forEach((data, filterId) => {
            const filter = allFilters.find(f => f.id === filterId);
            if (filter) {
                filter.updateCache(uriString, Array.from(data.lines));
            }
        });
    }

    /**
     * Generate filtered content using cached results - O(n) time complexity
     */
    private generateFilteredContent(originalUri: string, document: vscode.TextDocument): string {
        const { inclusiveFilters, exclusiveFilters } = this.getActiveFiltersSorted();
        const resultLines: Set<number> = new Set();

        if (inclusiveFilters.length > 0) {
            // Collect line numbers from inclusive filters
            inclusiveFilters.forEach(filter => {
                const cachedLines = filter.getMatchedLines(originalUri);
                cachedLines.forEach((lineNum: number) => resultLines.add(lineNum));
            });
        } else {
            // Include all lines if no inclusive filters are active
            for (let i = 0; i < document.lineCount; i++) {
                resultLines.add(i);
            }
        }

        // Always subtract exclusive filters
        exclusiveFilters.forEach(filter => {
            const cachedLines = filter.getMatchedLines(originalUri);
            cachedLines.forEach((lineNum: number) => resultLines.delete(lineNum));
        });

        // Build result string from sorted line numbers
        const sortedLines = Array.from(resultLines).sort((a, b) => a - b);
        const resultArr: string[] = [];
        
        sortedLines.forEach(lineNum => {
            if (lineNum < document.lineCount) {
                resultArr.push(document.lineAt(lineNum).text);
            }
        });

        return resultArr.join("\n");
    }

    /**
     * Get currently active focus inclusive and exclusive filters, sorted by priority (descending)
     */
    private getActiveFiltersSorted(): { inclusiveFilters: Filter[], exclusiveFilters: Filter[] } {
        const inclusiveFilters: Filter[] = [];
        const exclusiveFilters: Filter[] = [];
        
        if (!this.project) {
            return { inclusiveFilters, exclusiveFilters };
        }

        Array.from(this.project.filters.values())
            .filter(filter => filter.focusAction !== FocusAction.NONE)
            .sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50))
            .forEach(filter => {
                if (filter.focusAction === FocusAction.EXCLUDED) {
                    exclusiveFilters.push(filter);
                } else if (filter.focusAction === FocusAction.INCLUDED) {
                    inclusiveFilters.push(filter);
                }
            });

        return { inclusiveFilters, exclusiveFilters };
    }

    /**
     * Get visible line numbers in focus mode document
     * Helper method for commands to calculate filter decorations
     * 
     * @param originalUri Original document URI string
     * @param originalDoc Original document
     * @returns Sorted array of line numbers visible in focus document
     */
    getVisibleLines(originalUri: string, originalDoc: vscode.TextDocument): number[] {
        const { inclusiveFilters, exclusiveFilters } = this.getActiveFiltersSorted();
        const resultLines: Set<number> = new Set();

        if (inclusiveFilters.length > 0) {
            // Collect line numbers from inclusive filters using cached results
            inclusiveFilters.forEach(filter => {
                const cachedLines = filter.getMatchedLines(originalUri);
                cachedLines.forEach((lineNum: number) => resultLines.add(lineNum));
            });
        } else {
            // Include all lines if no inclusive filters
            for (let i = 0; i < originalDoc.lineCount; i++) {
                resultLines.add(i);
            }
        }
        
        // Always subtract exclusive filters
        exclusiveFilters.forEach(filter => {
            const cachedLines = filter.getMatchedLines(originalUri);
            cachedLines.forEach((lineNum: number) => resultLines.delete(lineNum));
        });

        return Array.from(resultLines).sort((a, b) => a - b);
    }

    // Event emitter for document change notifications (required by VS Code API)
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    /**
     * Refresh the virtual document content.
     * This triggers VS Code to call provideTextDocumentContent again.
     * Decorations are applied separately by commands.
     */
    refresh(editor: vscode.TextEditor): void {
        const uri = editor.document.uri;
        this.onDidChangeEmitter.fire(uri);
    }

    /**
     * Update the project used for filtering
     * This will affect all subsequent document content generation
     */
    update(project: Project): void {
        this.project = project;
        // if switching projects, refresh all open focus editors
        vscode.window.visibleTextEditors.forEach(editor => {
            if (FocusProvider.isFocusUri(editor.document.uri)) {
                this.refresh(editor);
            }
        });
    }

    /**
     * Validate if a URI is a valid focus document URI
     */
    static isFocusUri(uri: vscode.Uri): boolean {
        return uri.scheme === 'focus';
    }

    /**
     * Extract the original document URI from a focus URI
     */
    static getOriginalUri(focusUri: vscode.Uri): vscode.Uri | null {
        const queryParams = new URLSearchParams(focusUri.query);
        const originalUriString = queryParams.get('source');
        if (originalUriString) {
            return vscode.Uri.parse(originalUriString);
        }
        return null;
    }

    /**
     * Generate a virtual focus URI from an original document URI
     * Creates a title similar to Git extension: "filename (Focus Mode) (full-path)"
     */
    static virtualUri(originalUri: vscode.Uri): vscode.Uri {
        const fileName = path.basename(originalUri.fsPath);
        
        // Create a Git-like display format
        // This will show as: "<Focus Mode>filename"
        const displayName = `<Focus Mode> ${fileName}`;
        
        // Use the display name as the path component of the URI
        // VS Code will use this as the tab title
        return vscode.Uri.parse(`focus:${encodeURIComponent(displayName)}?source=${encodeURIComponent(originalUri.toString())}`);
    }
}
