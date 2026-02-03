import * as vscode from "vscode";
import { generateId } from "./utils";

// Keep track of the last generated hue to avoid similar colors
let lastHue = 0;

/**
 * Action to take in focus mode
 */
export enum FocusAction {
    INCLUDED = "included", // Match = Show
    EXCLUDED = "excluded", // Match = Hide
    NONE = "none"          // Match = No effect on focus mode
}

/**
 * Filter mode: text or regex
 */
export enum FilterMode {
    TEXT = "text",
    REGEX = "regex"
}

/**
 * Types for backward compatibility with commands.ts and extension.ts
 */
export interface EditorCacheEntry {
    timestamp: number;
    matchedLines: number[];
}

export interface EditorInfo {
    editor: import('vscode').TextEditor;
    metaData: {
        isFocusMode: boolean;
    };
}

/**
 * Represents a log filter with pattern matching and visual styling
 */
export class Filter {
    public regex: RegExp;
    public mode: FilterMode = FilterMode.REGEX;
    public textPattern: string = "";
    public groupId?: string;
    public readonly id: string;
    
    private _color: string;
    private _excludeColor: string;
    private _isHighlighted: boolean;
    private _focusAction: FocusAction = FocusAction.INCLUDED;
    private _iconPath: vscode.Uri;
    private _priority: number = 50;
    private _decoration: vscode.TextEditorDecorationType | null = null;
    private _lineCache: Map<string, number[]> = new Map();
    private _analyzedUris: Set<string> = new Set();

    constructor(regex: RegExp, color?: string, priority: number = 50) {
        this.regex = regex;
        const colors = color ? this.createColorPair(color) : this.generateColorPair();
        this._color = colors.normal;
        this._excludeColor = colors.inverted;
        this.id = generateId("filter");
        
        this._isHighlighted = true;
        this._focusAction = FocusAction.INCLUDED;
        this._priority = Math.max(0, Math.min(100, priority));
        this._iconPath = this.generateSvgIcon();
    }

    get color(): string {
        return this._focusAction === FocusAction.EXCLUDED ? this._excludeColor : this._color;
    }

    set color(value: string) {
        const colors = this.createColorPair(value);
        this._color = colors.normal;
        this._excludeColor = colors.inverted;
        this._iconPath = this.generateSvgIcon();
        this.updateDecoration();
    }

    /**
     * Set regex and update decoration
     */
    public setRegex(newRegex: RegExp): void {
        this.regex = newRegex;
        this.clearCache();
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

    get focusAction(): FocusAction {
        return this._focusAction;
    }

    set focusAction(value: FocusAction) {
        this._focusAction = value;
        this._iconPath = this.generateSvgIcon();
        this.updateDecoration();
    }

    get iconPath(): vscode.Uri {
        return this._iconPath;
    }

    get priority(): number {
        return this._priority;
    }

    set priority(value: number) {
        this._priority = Math.max(0, Math.min(100, value));
    }

    get count(): number {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const uri = activeEditor.document.uri.toString();
            return this._lineCache.get(uri)?.length ?? 0;
        }
        // Fallback to the first cache entry if no active editor
        const firstEntry = this._lineCache.values().next().value;
        return firstEntry?.length ?? 0;
    }

    /**
     * Update the matched lines cache for a specific document
     */
    public updateCache(uri: string, matchedLines: number[]): void {
        this._lineCache.set(uri, matchedLines);
        this._analyzedUris.add(uri);
    }

    public isAnalyzed(uri: string): boolean {
        return this._analyzedUris.has(uri);
    }

    public clearCache(uri?: string): void {
        if (uri) {
            this._lineCache.delete(uri);
            this._analyzedUris.delete(uri);
        } else {
            this._lineCache.clear();
            this._analyzedUris.clear();
        }
    }

    /**
     * Get matched lines for a specific document
     */
    public getMatchedLines(uri: string): number[] {
        return this._lineCache.get(uri) || [];
    }

    getCacheStats(): { cachedFiles: number; cacheEntries: Map<string, number[]> } {
        return { 
            cachedFiles: this._lineCache.size, 
            cacheEntries: new Map(this._lineCache) 
        };
    }

    get decoration(): vscode.TextEditorDecorationType | null {
        return this._decoration;
    }

    /**
     * Tests if a line matches this filter's pattern
     */
    public test(line: string): boolean {
        if (this.mode === FilterMode.TEXT) {
            return line.includes(this.textPattern);
        }
        return this.regex.test(line);
    }

    /**
     * Dispose of this filter's resources
     */
    public dispose(): void {
        if (this._decoration) {
            this._decoration.dispose();
            this._decoration = null;
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
    }

    /**
     * Creates an SVG icon representing the filter state
     */
    private generateSvgIcon(): vscode.Uri {
        const color = this._focusAction === FocusAction.EXCLUDED ? this._excludeColor : this._color;
        const isFilled = this._isHighlighted;
        
        const circle = isFilled 
            ? `<circle fill="${color}" cx="50" cy="50" r="45"/>`
            : `<circle stroke="${color}" fill="transparent" stroke-width="8" cx="50" cy="50" r="42"/>`;
        
        let overlay = '';
        if (this._focusAction === FocusAction.EXCLUDED) {
            // X symbol
            overlay = `<line x1="30" y1="30" x2="70" y2="70" stroke="${isFilled ? 'white' : color}" stroke-width="10" stroke-linecap="round"/>
                       <line x1="70" y1="30" x2="30" y2="70" stroke="${isFilled ? 'white' : color}" stroke-width="10" stroke-linecap="round"/>`;
        } else if (this._focusAction === FocusAction.NONE) {
            // Diagonal line (Ghost mode)
            overlay = `<line x1="20" y1="80" x2="80" y2="20" stroke="${isFilled ? 'white' : color}" stroke-width="6" stroke-linecap="round" opacity="0.6"/>`;
        }
        
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            ${circle}
            ${overlay}
        </svg>`;
        
        const dataUri = `data:image/svg+xml;base64,${btoa(svgContent)}`;
        return vscode.Uri.parse(dataUri);
    }

    /**
     * Generate a random color pair
     */
    private generateColorPair(): { normal: string; inverted: string } {
        let newHue;
        do {
            newHue = Math.floor(360 * Math.random());
        } while (this.isHueTooSimilar(newHue, lastHue));
        
        lastHue = newHue;
        return {
            normal: `hsl(${newHue}, 50%, 40%)`,
            inverted: `hsl(${newHue}, 40%, 80%)`
        };
    }

    /**
     * Create color pair from existing color
     */
    private createColorPair(color: string): { normal: string; inverted: string } {
        const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (match) {
            const hue = parseInt(match[1]);
            return {
                normal: `hsl(${hue}, 50%, 40%)`,
                inverted: `hsl(${hue}, 40%, 80%)`
            };
        }
        return { normal: color, inverted: color };
    }

    private isHueTooSimilar(hue1: number, hue2: number): boolean {
        const hueDifference = Math.min(
            Math.abs(hue1 - hue2),
            360 - Math.abs(hue1 - hue2)
        );
        return hueDifference < 60;
    }
}
