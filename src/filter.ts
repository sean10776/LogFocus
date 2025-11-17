import * as vscode from "vscode";
import * as crypto from "crypto";
import { generateId } from "./utils";

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
interface EditorCacheEntry {
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
        return this._count;
    }

    /**
     * Process an editor and apply filter logic with caching
     */
    public processEditor(editorInfo: EditorInfo): void {
        if (!this._decoration) {
            this.createDecoration();
        }
        const editorUri = editorInfo.uri.toString();
        this._activeEditors.set(editorUri, editorInfo);
        
        const cacheEntry = this.getCachedAnalysisOrCompute(editorInfo);
        this._editorDecorations.set(editorUri, cacheEntry.matchedRanges);
        if (editorInfo.metaData.isSelected) {
            this._count = cacheEntry.count;
        }
        
        this.applyDecorationsToEditor(editorInfo, cacheEntry.matchedRanges);
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
     * Get line numbers that match this filter
     */
    public getMatchedLineNumbers(editorUri?: string): number[] {
        if (editorUri) {
            const editorInfo = this._activeEditors.get(editorUri);
            if (!editorInfo) return [];
            
            const cacheEntry = this._editorCache.get(editorUri);
            if (cacheEntry && this.isCacheValid(cacheEntry, editorInfo.editor.document, editorInfo.metaData)) {
                return cacheEntry.matchedLineNumbers;
            }
            
            return this.getCachedAnalysisOrCompute(editorInfo).matchedLineNumbers;
        } else {
            const allLineNumbers: number[] = [];
            for (const [uri] of this._activeEditors.entries()) {
                allLineNumbers.push(...this.getMatchedLineNumbers(uri));
            }
            return allLineNumbers;
        }
    }

    /**
     * Get cached analysis or compute new one
     */
    private getCachedAnalysisOrCompute(editorInfo: EditorInfo): EditorCacheEntry {
        const editorUri = editorInfo.editor.document.uri.toString();
        const document = editorInfo.editor.document;

        this.cleanupExpiredCache();

        const cachedEntry = this._editorCache.get(editorUri);
        if (cachedEntry && this.isCacheValid(cachedEntry, document, editorInfo.metaData)) {
            return cachedEntry;
        }

        const newEntry = editorInfo.metaData.isLargeFile ? 
            this.computeOptimizedAnalysis(editorInfo) : 
            this.computeAnalysis(editorInfo);
        
        newEntry.lastAnalyzed = Date.now();
        
        this._editorCache.set(editorUri, newEntry);
        this.enforceMaxCacheSize();
        
        return newEntry;
    }

    /**
     * Check if cache is still valid
     */
    private isCacheValid(cacheEntry: EditorCacheEntry, document: vscode.TextDocument, metaData?: EditorMetaData): boolean {
        if (cacheEntry.version !== document.version) return false;
        if (cacheEntry.size !== Buffer.byteLength(document.getText(), 'utf8')) return false;
        if (cacheEntry.contentHash !== this.calculateContentHash(document.getText())) return false;
        
        const maxAge = metaData?.isLargeFile ? this._cacheMaxAge / 2 : this._cacheMaxAge;
        const cacheAge = Date.now() - cacheEntry.lastAnalyzed;
        return cacheAge <= maxAge;
    }

    /**
     * Compute fresh analysis for an editor
     */
    private computeAnalysis(editorInfo: EditorInfo): EditorCacheEntry {
        const editor = editorInfo.editor;
        const document = editor.document;
        const text = document.getText();
        const lines = text.split('\n');
        
        const matchedRanges: vscode.Range[] = [];
        const matchedLineNumbers: number[] = [];
        let count = 0;
        
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            
            if (this.test(line)) {
                count++;
                matchedLineNumbers.push(lineIndex);
                
                // Create range for the entire line (for whole line highlighting)
                const wholeLineRange = new vscode.Range(
                    new vscode.Position(lineIndex, 0),
                    new vscode.Position(lineIndex, 0) // position does not matter because isWholeLine is set to true
                );
                matchedRanges.push(wholeLineRange);
            }
        }
        
        return {
            uri: document.uri.toString(),
            version: document.version,
            size: Buffer.byteLength(text, 'utf8'),
            contentHash: this.calculateContentHash(text),
            lastModified: Date.now(), // VS Code doesn't provide file mtime directly
            matchedRanges,
            matchedLineNumbers,
            count,
            lastAnalyzed: 0 // Will be set by caller
        };
    }

    /**
     * Optimized analysis for large files
     */
    private computeOptimizedAnalysis(editorInfo: EditorInfo): EditorCacheEntry {
        const document = editorInfo.editor.document;
        const text = document.getText();
        const lines = text.split('\n');
        const maxRanges = 500; // Performance limit
        
        const matchedRanges: vscode.Range[] = [];
        const matchedLineNumbers: number[] = [];
        let count = 0;
        
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            
            if (this.test(line)) {
                count++;
                matchedLineNumbers.push(lineIndex);
                
                // Limit ranges for performance
                if (matchedRanges.length < maxRanges) {
                    // Create range for the entire line (for whole line highlighting)
                    const wholeLineRange = new vscode.Range(
                        new vscode.Position(lineIndex, 0),
                        new vscode.Position(lineIndex, 0) // position does not matter because isWholeLine is set to true
                    );
                    matchedRanges.push(wholeLineRange);
                }
            }
        }
        
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
        if (this._editorCache.size <= this._cacheMaxSize) return;
        
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
     * Apply decorations to specific editor
     */
    private applyDecorationsToEditor(editorInfo: EditorInfo, matchedRanges: vscode.Range[]): void {
        if (!this._decoration) return;

        const editor = editorInfo.editor;
        const isFocusMode = editorInfo.metaData.isFocusMode || editorInfo.uri.toString().startsWith("focus:");
        const isLargeFile = editorInfo.metaData.isLargeFile;
        
        const shouldHighlight = this._isHighlighted && 
                               (!isFocusMode || this._isShown) &&
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
        const lightness = 50;
        const normalColor = `hsl(${newHue}, 70%, ${lightness}%)`;
        const invertedColor = `hsl(${newHue}, 70%, ${100 - lightness}%)`; // Inverted lightness
        
        return { normal: normalColor, inverted: invertedColor };
    }

    /**
     * Create color pair from existing color
     */
    private createColorPair(color: string): { normal: string; inverted: string } {
        const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (match) {
            const hue = parseInt(match[1]);
            const saturation = parseInt(match[2]);
            const lightness = parseInt(match[3]);
            const invertedLightness = 100 - lightness;
            
            return {
                normal: color,
                inverted: `hsl(${hue}, ${saturation}%, ${invertedLightness}%)`
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
}