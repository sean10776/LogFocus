import * as vscode from "vscode";
import * as crypto from "crypto";
import { generateId } from "./utils";
import { FocusProvider } from "./focusProvider";

// Keep track of the last generated hue to avoid similar colors
let lastHue = 0;

/**
 * Editor Info
 */
export type EditorMetaData = {
    lineCount: number;
    isLargeFile: boolean;
    isFocusMode: boolean;
    isSelected: boolean;
};

export type EditorInfo = {
    editor: vscode.TextEditor;
    uri: vscode.Uri;
    metaData: EditorMetaData;
};

/**
 * Cache entry for storing editor analysis results
 */
export interface EditorCacheEntry {
    uri: string;                    // Editor URI
    version: number;               // Document version
    size: number;                  // Document size in bytes
    contentHash: string;           // Content hash for change detection
    lastModified: number;          // Last modified timestamp
    
    // Cached results
    matchedRanges: vscode.Range[]; // Matched ranges for highlighting
    matchedLineNumbers: number[];  // Line numbers that match
    count: number;                 // Total match count
    
    lastAnalyzed: number;          // When this cache was created
}

/**
 * Represents a log filter with regex pattern matching and visual styling
 * Self-contained filter that manages its own decoration and processing with intelligent caching
 */
export class Filter {
    public regex: RegExp;  // Made mutable for editing functionality
    public readonly id: string;
    
    private _color: string;
    private _excludeColor: string;
    private _isHighlighted: boolean;
    private _isShown: boolean;
    private _isExclude: boolean;
    private _iconPath: vscode.Uri;
    private _count: number;
    
    // Internal decoration management - support multiple editors
    private _decoration: vscode.TextEditorDecorationType | null = null;
    private _activeEditors: Map<string, EditorInfo> = new Map(); // Track multiple active editors
    private _editorDecorations: Map<string, vscode.Range[]> = new Map(); // Store decorations per editor
    
    // Cache management
    private _editorCache: Map<string, EditorCacheEntry> = new Map();
    private _cacheMaxSize: number = 10; // Maximum number of editors to cache
    private _cacheMaxAge: number = 300000; // 5 minutes cache TTL
    private _regexVersion: number = 0; // Track regex changes for cache invalidation

    constructor(regex: RegExp, color?: string) {
        this.regex = regex;
        const colors = color ? this.createColorPair(color) : this.generateColorPair();
        this._color = colors.normal;
        this._excludeColor = colors.inverted;
        this.id = generateId("filter");
        
        this._isHighlighted = true;
        this._isShown = true;
        this._isExclude = false;
        this._count = 0;
        this._iconPath = this.generateSvgIcon();
    }

    get color(): string {
        return this.isExclude ? this._excludeColor : this._color;
    }

    set color(value: string) {
        const colors = this.createColorPair(value);
        this._color = colors.normal;
        this._excludeColor = colors.inverted;
        this._iconPath = this.generateSvgIcon();
        this.updateDecoration();
    }

    /**
     * Set regex and invalidate cache
     */
    public setRegex(newRegex: RegExp): void {
        this.regex = newRegex;
        this._regexVersion++;
        this.clearCache(); // Invalidate all cache since regex changed
        this._iconPath = this.generateSvgIcon();
        this.updateDecoration();
    }

    get isHighlighted(): boolean {
        return this._isHighlighted;
    }

    set isHighlighted(value: boolean) {
        this._isHighlighted = value;
        this._iconPath = this.generateSvgIcon();
        this.updateDecoration();
    }

    get isShown(): boolean {
        return this._isShown;
    }

    set isShown(value: boolean) {
        this._isShown = value;
        this.applyDecorationsToAllEditors();
    }

    get isExclude(): boolean {
        return this._isExclude;
    }

    set isExclude(value: boolean) {
        this._isExclude = value;
        this._iconPath = this.generateSvgIcon();
        this.updateDecoration();
    }

    get iconPath(): vscode.Uri {
        return this._iconPath;
    }

    get count(): number {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            var editorUri = activeEditor.document.uri;
            if (FocusProvider.isFocusUri(editorUri)) {
                editorUri = FocusProvider.getOriginalUri(editorUri) || editorUri;
            }
            const cacheEntry = this._editorCache.get(editorUri.toString());
            return cacheEntry?.count || 0;
        }
        return this._count;
    }

    /**
     * Process an editor and apply filter logic with caching
     * This is the main entry point for applying the filter to an editor
     */
    public async processEditor(editorInfo: EditorInfo): Promise<void> {
        if (!this._decoration) {
            this.createDecoration();
        }
        const editorUri = editorInfo.uri.toString();
        const isFocusMode = FocusProvider.isFocusUri(editorInfo.uri);
        
        // Focus mode editors need decoration but not cache computation
        if (editorInfo.metaData.isFocusMode || isFocusMode) {
            // await this.processFocusModeEditor(editorInfo);
            // TODO 
            return;
        }
        
        this._activeEditors.set(editorUri, editorInfo);
        
        const cacheEntry = await this.getCachedAnalysisOrCompute(editorInfo);
        this._editorDecorations.set(editorUri, cacheEntry.matchedRanges);

        this.applyDecorationsToEditor(editorInfo, cacheEntry.matchedRanges);
    }

    /**
     * Process focus mode editor
     * Focus mode documents are virtual and filtered, so we do lightweight matching
     * and ensure original document cache exists for accurate count
     */
    private async processFocusModeEditor(editorInfo: EditorInfo): Promise<void> {
        const editor = editorInfo.editor;
        
        // Ensure cache exists for the original document
        await this.ensureOriginalDocumentCache(editorInfo);
        
        // Skip if this filter is not shown or is exclude filter (invisible in focus mode)
        if (!this._isShown || this._isExclude) {
            editor.setDecorations(this._decoration!, []);
            return;
        }
        
        // Skip if highlight is disabled
        if (!this._isHighlighted) {
            editor.setDecorations(this._decoration!, []);
            return;
        }
        
        // Lightweight matching - use extracted matching logic
        const matchedRanges = this.matchLinesInDocument(editor.document);
        editor.setDecorations(this._decoration!, matchedRanges);
    }

    /**
     * Ensure that cache exists for the original document when in focus mode
     * This is important for newly created filters in focus mode
     */
    private async ensureOriginalDocumentCache(editorInfo: EditorInfo): Promise<void> {
        const originalUri = FocusProvider.getOriginalUri(editorInfo.uri);
        if (!originalUri) {
            return;
        }
        
        const originalUriString = originalUri.toString();
        
        // Check if cache already exists
        if (this._editorCache.has(originalUriString)) {
            return;
        }
        
        try {
            // Open the original document to analyze it
            const originalDocument = await vscode.workspace.openTextDocument(originalUri);
            
            // Double check if another call already created the cache
            if (this._editorCache.has(originalUriString)) {
                return;
            }
            
            // Create a temporary EditorInfo for analysis
            const tempEditorInfo: EditorInfo = {
                editor: vscode.window.activeTextEditor!, // Temporary, only document matters
                uri: originalUri,
                metaData: {
                    lineCount: originalDocument.lineCount,
                    isLargeFile: originalDocument.lineCount > 5000,
                    isFocusMode: false,
                    isSelected: false
                }
            };
            
            // Use async analysis to avoid blocking
            const cacheEntry = await this.getCachedAnalysisOrCompute(tempEditorInfo);
            
            // The cache should already be set by getCachedAnalysisOrCompute
            // but we ensure it's using the correct URI
            if (!this._editorCache.has(originalUriString)) {
                cacheEntry.lastAnalyzed = Date.now();
                this._editorCache.set(originalUriString, cacheEntry);
                this.enforceMaxCacheSize();
            }
        } catch (error) {
            console.error('Failed to analyze original document for focus mode:', error);
        }
    }

    /**
     * Clear processing and decorations
     */
    public clearProcessing(editorUri?: string): void {
        if (editorUri) {
            const editorInfo = this._activeEditors.get(editorUri);
            if (this._decoration && editorInfo) {
                editorInfo.editor.setDecorations(this._decoration, []);
            }
            this._activeEditors.delete(editorUri);
            this._editorDecorations.delete(editorUri);
        } else {
            if (this._decoration) {
                for (const editorInfo of this._activeEditors.values()) {
                    editorInfo.editor.setDecorations(this._decoration, []);
                }
            }
            this._activeEditors.clear();
            this._editorDecorations.clear();
        }
        this._count = 0;
    }

    /**
     * Remove a specific editor from processing
     */
    public removeEditor(editorUri: string): void {
        this.clearProcessing(editorUri);
        this.clearCache(editorUri);
    }

    /**
     * Clear cache for specific editor or all editors
     */
    public clearCache(editorUri?: string): void {
        if (editorUri) {
            this._editorCache.delete(editorUri);
        } else {
            this._editorCache.clear();
        }
    }

    /**
     * Dispose of this filter's resources
     */
    public dispose(): void {
        this.clearProcessing();
        this.clearCache(); // Clear all cache entries
        if (this._decoration) {
            this._decoration.dispose();
            this._decoration = null;
        }
    }

    /**
     * Tests if a line matches this filter's regex pattern
     */
    public test(line: string): boolean {
        return this.regex.test(line);
    }

    /**
     * Get line numbers that match this filter (sync version using cache only)
     */
    public getMatchedLineNumbers(editorUri?: string): number[] {
        if (editorUri) {
            const editorInfo = this._activeEditors.get(editorUri);
            if (!editorInfo) {return [];}
            
            const cacheEntry = this._editorCache.get(editorUri);
            if (cacheEntry && this.isCacheValid(cacheEntry, editorInfo.editor.document, editorInfo.metaData)) {
                return cacheEntry.matchedLineNumbers;
            }
            
            // If no valid cache, compute synchronously (fallback)
            const syncEntry = editorInfo.metaData.isLargeFile ? 
                this.computeOptimizedAnalysis(editorInfo) : 
                this.computeAnalysis(editorInfo);
            return syncEntry.matchedLineNumbers;
        } else {
            const allLineNumbers: number[] = [];
            for (const [uri] of this._activeEditors.entries()) {
                allLineNumbers.push(...this.getMatchedLineNumbers(uri));
            }
            return allLineNumbers;
        }
    }

    /**
     * Get cached analysis or compute new one (async to avoid blocking)
     */
    private async getCachedAnalysisOrCompute(editorInfo: EditorInfo): Promise<EditorCacheEntry> {
        const editorUri = editorInfo.editor.document.uri.toString();
        const document = editorInfo.editor.document;

        this.cleanupExpiredCache();

        const cachedEntry = this._editorCache.get(editorUri);
        if (cachedEntry && this.isCacheValid(cachedEntry, document, editorInfo.metaData)) {
            return cachedEntry;
        }

        // Compute analysis asynchronously to avoid blocking UI
        const newEntry = await (editorInfo.metaData.isLargeFile ? 
            this.computeOptimizedAnalysisAsync(editorInfo) : 
            this.computeAnalysisAsync(editorInfo));
        
        newEntry.lastAnalyzed = Date.now();
        
        this._editorCache.set(editorUri, newEntry);
        this.enforceMaxCacheSize();
        
        return newEntry;
    }

    /**
     * Check if cache is still valid
     */
    private isCacheValid(cacheEntry: EditorCacheEntry, document: vscode.TextDocument, metaData?: EditorMetaData): boolean {
        if (cacheEntry.version !== document.version) {return false;}
        if (cacheEntry.size !== Buffer.byteLength(document.getText(), 'utf8')) {return false;}
        if (cacheEntry.contentHash !== this.calculateContentHash(document.getText())) {return false;}
        
        const maxAge = metaData?.isLargeFile ? this._cacheMaxAge / 2 : this._cacheMaxAge;
        const cacheAge = Date.now() - cacheEntry.lastAnalyzed;
        return cacheAge <= maxAge;
    }

    /**
     * Compute fresh analysis for an editor (async version)
     */
    private async computeAnalysisAsync(editorInfo: EditorInfo): Promise<EditorCacheEntry> {
        const document = editorInfo.editor.document;
        const text = document.getText();
        
        // Yield control to avoid blocking UI for large files
        await new Promise(resolve => setImmediate(resolve));
        
        // Pass text to avoid re-fetching
        const matchedRanges = this.matchLinesInText(text);
        const matchedLineNumbers = matchedRanges.map(range => range.start.line);
        const count = matchedLineNumbers.length;
        
        return {
            uri: document.uri.toString(),
            version: document.version,
            size: Buffer.byteLength(text, 'utf8'),
            contentHash: this.calculateContentHash(text),
            lastModified: Date.now(),
            matchedRanges,
            matchedLineNumbers,
            count,
            lastAnalyzed: 0 // Will be set by caller
        };
    }

    /**
     * Optimized analysis for large files (async version)
     */
    private async computeOptimizedAnalysisAsync(editorInfo: EditorInfo): Promise<EditorCacheEntry> {
        const document = editorInfo.editor.document;
        const text = document.getText();
        const maxRanges = 500; // Performance limit
        
        // Yield control to avoid blocking UI
        await new Promise(resolve => setImmediate(resolve));
        
        // Pass text to avoid re-fetching
        const allMatchedRanges = this.matchLinesInText(text);
        const matchedLineNumbers = allMatchedRanges.map(range => range.start.line);
        const count = matchedLineNumbers.length;
        
        // Limit ranges for performance in large files
        const matchedRanges = allMatchedRanges.slice(0, maxRanges);
        
        return {
            uri: document.uri.toString(),
            version: document.version,
            size: Buffer.byteLength(text, 'utf8'),
            contentHash: this.calculateContentHash(text),
            lastModified: Date.now(),
            matchedRanges,
            matchedLineNumbers,
            count,
            lastAnalyzed: 0
        };
    }

    /**
     * Compute fresh analysis for an editor (sync version - kept for compatibility)
     */
    private computeAnalysis(editorInfo: EditorInfo): EditorCacheEntry {
        const document = editorInfo.editor.document;
        const text = document.getText();
        
        // Pass text to avoid re-fetching
        const matchedRanges = this.matchLinesInText(text);
        const matchedLineNumbers = matchedRanges.map(range => range.start.line);
        const count = matchedLineNumbers.length;
        
        return {
            uri: document.uri.toString(),
            version: document.version,
            size: Buffer.byteLength(text, 'utf8'),
            contentHash: this.calculateContentHash(text),
            lastModified: Date.now(),
            matchedRanges,
            matchedLineNumbers,
            count,
            lastAnalyzed: 0 // Will be set by caller
        };
    }

    /**
     * Optimized analysis for large files (sync version - kept for compatibility)
     */
    private computeOptimizedAnalysis(editorInfo: EditorInfo): EditorCacheEntry {
        const document = editorInfo.editor.document;
        const text = document.getText();
        const maxRanges = 500; // Performance limit
        
        // Pass text to avoid re-fetching
        const allMatchedRanges = this.matchLinesInText(text);
        const matchedLineNumbers = allMatchedRanges.map(range => range.start.line);
        const count = matchedLineNumbers.length;
                
        // Limit ranges for performance in large files
        const matchedRanges = allMatchedRanges.slice(0, maxRanges);
        
        return {
            uri: document.uri.toString(),
            version: document.version,
            size: Buffer.byteLength(text, 'utf8'),
            contentHash: this.calculateContentHash(text),
            lastModified: Date.now(),
            matchedRanges,
            matchedLineNumbers,
            count,
            lastAnalyzed: 0
        };
    }

    /**
     * Match lines in text and return ranges
     * Optimized to accept text directly to avoid repeated getText() calls
     */
    private matchLinesInText(text: string): vscode.Range[] {
        const lines = text.split('\n');
        const matchedRanges: vscode.Range[] = [];

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            if (this.test(line)) {
                // Create range for the entire line (for whole line highlighting)
                const wholeLineRange = new vscode.Range(
                    new vscode.Position(lineIndex, 0),
                    new vscode.Position(lineIndex, 0) // position does not matter because isWholeLine is set to true
                );
                matchedRanges.push(wholeLineRange);
            }
        }

        return matchedRanges;
    }

    /**
     * Match lines in a document and return ranges
     * Convenience wrapper for focus mode and other uses
     */
    private matchLinesInDocument(document: vscode.TextDocument): vscode.Range[] {
        return this.matchLinesInText(document.getText());
    }

    /**
     * Calculate content hash for change detection
     */
    private calculateContentHash(content: string): string {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    /**
     * Clean up expired cache entries
     */
    private cleanupExpiredCache(): void {
        const now = Date.now();
        for (const [uri, entry] of this._editorCache.entries()) {
            if (now - entry.lastAnalyzed > this._cacheMaxAge) {
                this._editorCache.delete(uri);
            }
        }
    }

    /**
     * Enforce maximum cache size by removing oldest entries
     */
    private enforceMaxCacheSize(): void {
        if (this._editorCache.size <= this._cacheMaxSize) {return;}
        
        // Sort by lastAnalyzed time and remove oldest
        const entries = Array.from(this._editorCache.entries())
            .sort(([, a], [, b]) => a.lastAnalyzed - b.lastAnalyzed);
        
        const toRemove = entries.slice(0, this._editorCache.size - this._cacheMaxSize);
        for (const [uri] of toRemove) {
            this._editorCache.delete(uri);
        }
    }

    /**
     * Creates decoration type for this filter
     */
    private createDecoration(): void {
        this._decoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: this.color,
            isWholeLine: true,
            overviewRulerColor: this.color,
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
    }

    /**
     * Updates decoration style when properties change
     */
    private updateDecoration(): void {
        if (this._decoration) {
            this._decoration.dispose();
        }
        this.createDecoration();
        this.applyDecorationsToAllEditors();
    }

    /**
     * Apply decorations to specific editor (non-focus mode only)
     * Focus mode editors are handled separately in processFocusModeEditor()
     */
    private applyDecorationsToEditor(editorInfo: EditorInfo, matchedRanges: vscode.Range[]): void {
        if (!this._decoration) {return;}

        const editor = editorInfo.editor;
        const isLargeFile = editorInfo.metaData.isLargeFile;
        
        const shouldHighlight = this._isHighlighted && 
                               !this._isExclude &&
                               (!isLargeFile || (this._isShown && this._count < 1000));

        if (shouldHighlight) {
            editor.setDecorations(this._decoration, matchedRanges);
        } else {
            editor.setDecorations(this._decoration, []);
        }
    }

    /**
     * Apply decorations to all active editors
     */
    private applyDecorationsToAllEditors(): void {
        for (const [uri, editorInfo] of this._activeEditors.entries()) {
            const decorations = this._editorDecorations.get(uri) || [];
            this.applyDecorationsToEditor(editorInfo, decorations);
        }
    }

    /**
     * Creates an SVG icon representing the filter state
     * Returns a filled circle if highlighted, empty circle otherwise
     * Shows diagonal slash for exclude filters
     */
    private generateSvgIcon(): vscode.Uri {
        const svgContent = this.createIcon();
        const dataUri = `data:image/svg+xml;base64,${btoa(svgContent)}`;
        return vscode.Uri.parse(dataUri);
    }

    /**
     * Create unified icon based on filter state
     */
    private createIcon(): string {
        const color = this._isExclude ? this._excludeColor : this._color;
        const isFilled = this._isHighlighted;
        
        // Base circle
        const circle = isFilled 
            ? `<circle fill="${color}" cx="50" cy="50" r="45"/>`
            : `<circle stroke="${color}" fill="transparent" stroke-width="8" cx="50" cy="50" r="42"/>`;
        
        // Exclude indicator - use diagonal slash for better visibility
        const excludeSymbol = this._isExclude 
            ? `<line x1="25" y1="25" x2="75" y2="75" stroke="${isFilled ? 'white' : color}" stroke-width="${isFilled ? '8' : '6'}" stroke-linecap="round"/>`
            : '';
        
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            ${circle}
            ${excludeSymbol}
        </svg>`;
    }

    /**
     * Generate a random color pair (normal and inverted for exclude filters)
     */
    private generateColorPair(): { normal: string; inverted: string } {
        let newHue;
        do {
            newHue = Math.floor(360 * Math.random());
        } while (this.isHueTooSimilar(newHue, lastHue));
        
        lastHue = newHue;
        const normalColor = `hsl(${newHue}, 50%, 40%)`;
        const invertedColor = `hsl(${newHue}, 40%, 80%)`;
        
        return { normal: normalColor, inverted: invertedColor };
    }

    /**
     * Create color pair from existing color
     */
    private createColorPair(color: string): { normal: string; inverted: string } {
        const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (match) {
            const hue = parseInt(match[1]);
            const normalColor = `hsl(${hue}, 50%, 40%)`;
            const invertedColor = `hsl(${hue}, 40%, 80%)`;
            
            return {
                normal: normalColor,
                inverted: invertedColor
            };
        }
        return { normal: color, inverted: color }; // Fallback
    }

    private isHueTooSimilar(hue1: number, hue2: number): boolean {
        const hueDifference = Math.min(
            Math.abs(hue1 - hue2),
            360 - Math.abs(hue1 - hue2)
        );
        return hueDifference < 60;
    }

    /**
     * Get cache statistics for this filter
     */
    public getCacheStats(): { cachedFiles: number; cacheEntries: Map<string, EditorCacheEntry> } {
        return {
            cachedFiles: this._editorCache.size,
            cacheEntries: this._editorCache
        };
    }
}