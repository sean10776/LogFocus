import * as vscode from "vscode";
import { Project } from "./utils";
import { Filter } from "./filter";

/**
 * Provides read-only virtual documents that contain only lines matching shown filters.
 * 
 * This provider creates virtual documents with URIs of the form "focus:<original uri>"
 * where <original uri> is the escaped URI of the original document.
 * 
 * The documents created by this provider are automatically READ-ONLY by VS Code design.
 * Users cannot edit these virtual documents - they serve as filtered views of the original files.
 */
export class FocusProvider implements vscode.TextDocumentContentProvider {
    project: Project | null;

    constructor(project: Project | null = null) {
        this.project = project;
    }

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
     * Provides read-only text content for virtual focus documents.
     * This method leverages Filter caching for improved performance.
     * 
     * @param uri Virtual document URI in format "focus:<original-uri>"
     * @returns Promise<string> Filtered content as read-only text
     */
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const originalUri = vscode.Uri.parse(uri.path);
        const sourceDocument = await vscode.workspace.openTextDocument(originalUri);
        return this.generateFilteredContent(originalUri.toString(), sourceDocument);
    }

    /**
     * Generate filtered content using cached Filter results for optimal performance
     */
    private generateFilteredContent(originalUri: string, document: vscode.TextDocument): string {
        const { positiveFilters, excludeFilters } = this.getActiveFilters();
        
        let resultLines: Set<number> = new Set();

        if (positiveFilters.length > 0) {
            // Collect line numbers from positive filters using their cached results
            positiveFilters.forEach(filter => {
                const lineNumbers = filter.getMatchedLineNumbers(originalUri.toString());
                lineNumbers.forEach(lineNum => resultLines.add(lineNum));
            });
        } else {
            // Include all lines if no positive filters
            for (let i = 0; i < document.lineCount; i++) {
                resultLines.add(i);
            }
            // Remove excluded lines using cached results
            excludeFilters.forEach(filter => {
                const excludedLines = filter.getMatchedLineNumbers(originalUri.toString());
                excludedLines.forEach(lineNum => resultLines.delete(lineNum));
            });
        }

        // Convert to sorted array and build result
        const sortedLines = Array.from(resultLines).sort((a, b) => a - b);
        const resultArr = [""];
        
        sortedLines.forEach(lineNum => {
            if (lineNum < document.lineCount) {
                resultArr.push(document.lineAt(lineNum).text);
            }
        });

        return resultArr.join("\n");
    }

    /**
     * Get currently active positive and exclude filters
     */
    private getActiveFilters(): { positiveFilters: Filter[], excludeFilters: Filter[] } {
        const positiveFilters: Filter[] = [];
        const excludeFilters: Filter[] = [];
        if (this.project === null) {
            return { positiveFilters, excludeFilters };
        }

        this.project.filters.forEach(filter => {
            if (filter.isShown) {
                if (filter.isExclude) {
                    excludeFilters.push(filter);
                } else {
                    positiveFilters.push(filter);
                }
            }
        });

        return { positiveFilters, excludeFilters };
    }

    // Event emitter for document change notifications (required by VS Code API)
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    /**
     * Refresh the virtual document content.
     * This triggers VS Code to call provideTextDocumentContent again.
     * 
     * @param uri The URI of the virtual document to refresh
     */
    refresh(editor: vscode.TextEditor): void {
        editor.setDecorations(FocusProvider.focusDecorationType, FocusProvider.focusDecorationRangeArray);
        this.onDidChangeEmitter.fire(editor.document.uri);
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
}
