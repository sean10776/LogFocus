import * as assert from 'assert';
import * as vscode from 'vscode';
import { Filter, FocusAction } from '../../filter';
import { createProject, buildCombinedRegex, performCombinedAnalysis, Project } from '../../utils';

suite('LogFocus Engine & Focus Logic Test Suite', () => {
    
    test('Combined Regex Match Priority', () => {
        const f1 = new Filter(/abc/, '#ff0000', 10);
        const f2 = new Filter(/abcd/, '#00ff00', 50); // Higher priority
        
        const { regex, filterMap } = buildCombinedRegex([f1, f2]);
        const text = 'abc abcd message';
        const { linePriorityWinners } = performCombinedAnalysis(text, regex, filterMap);
        
        // On line 0, both match. f2 (priority 50) should win over f1 (10)
        assert.strictEqual(linePriorityWinners.get(0), f2.id);
    });

    test('Focus Mode: Content Generation Logic', async () => {
        // We simulate FocusProvider's content generation logic here
        // as we can't easily instantiate FocusProvider without internal state mocks
        
        const text = [
            'line 0: info',
            'line 1: error',
            'line 2: warning',
            'line 3: debug',
            'line 4: crash'
        ].join('\n');

        const errorFilter = new Filter(/error/);
        errorFilter.focusAction = FocusAction.INCLUDED;
        
        const crashFilter = new Filter(/crash/);
        crashFilter.focusAction = FocusAction.EXCLUDED;

        // Mock caching
        const uri = 'test://uri';
        errorFilter.updateCache(uri, [1]); // 'error' is on line 1
        crashFilter.updateCache(uri, [4]); // 'crash' is on line 4

        const inclusiveFilters = [errorFilter];
        const exclusiveFilters = [crashFilter];

        // LOGIC from focusProvider.ts:generateFilteredContent
        const resultLines: Set<number> = new Set();
        
        // 1. Inclusive
        inclusiveFilters.forEach(f => {
            f.getMatchedLines(uri).forEach(l => resultLines.add(l));
        });

        // 2. Exclusive
        exclusiveFilters.forEach(f => {
            f.getMatchedLines(uri).forEach(l => resultLines.delete(l));
        });

        const sorted = Array.from(resultLines).sort((a,b) => a-b);
        assert.deepStrictEqual(sorted, [1], 'Only line 1 should remain');
    });

    test('Focus Mode: Empty Inclusive List means All Lines', () => {
        const uri = 'test://uri';
        const crashFilter = new Filter(/crash/);
        crashFilter.focusAction = FocusAction.EXCLUDED;
        crashFilter.updateCache(uri, [4]);

        const inclusiveFilters: Filter[] = [];
        const exclusiveFilters = [crashFilter];
        const lineCount = 5;

        // LOGIC
        const resultLines: Set<number> = new Set();
        if (inclusiveFilters.length === 0) {
            for (let i = 0; i < lineCount; i++) {resultLines.add(i);}
        }

        exclusiveFilters.forEach(f => {
            f.getMatchedLines(uri).forEach(l => resultLines.delete(l));
        });

        const sorted = Array.from(resultLines).sort((a,b) => a-b);
        assert.deepStrictEqual(sorted, [0, 1, 2, 3], 'Line 4 should be excluded, all others shown');
    });

    test('Focus Mode: Overlapping Inclusive/Exclusive', () => {
        const uri = 'test://uri';
        
        const f1 = new Filter(/error/); // INCLUDED
        f1.focusAction = FocusAction.INCLUDED;
        f1.updateCache(uri, [1, 2]);

        const f2 = new Filter(/2/); // EXCLUDED (contains "2")
        f2.focusAction = FocusAction.EXCLUDED;
        f2.updateCache(uri, [2]);

        const inclusiveFilters = [f1];
        const exclusiveFilters = [f2];

        // LOGIC
        const resultLines: Set<number> = new Set();
        inclusiveFilters.forEach(f => f.getMatchedLines(uri).forEach(l => resultLines.add(l)));
        exclusiveFilters.forEach(f => f.getMatchedLines(uri).forEach(l => resultLines.delete(l)));

        assert.deepStrictEqual(Array.from(resultLines), [1], 'Line 2 should be subtracted');
    });
});
