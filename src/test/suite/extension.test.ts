import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Filter } from '../../filter';
import { 
    setFocusAction,
    deleteFilter,
    selectProject,
    exportProject,
    importProject,
    toggleHighlight
} from '../../commands';
import { 
    createProject, 
    createGroup, 
    createState,
    buildCombinedRegex, 
    performCombinedAnalysis
} from '../../utils';
import { FilterMode, FocusAction } from '../../filter';

// Import the internal _addProject function for testing
const { _addProject } = require('../../commands');

suite('LogFocus Extension Test Suite', () => {
    vscode.window.showInformationMessage('Starting LogFocus tests.');

    test('Extension should be present', () => {
        const extension = vscode.extensions.getExtension('SeanOwO.logfocus');
        assert.ok(extension, 'Extension should be installed');
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('SeanOwO.logfocus');
        assert.ok(extension, 'Extension should exist');
        
        await extension!.activate();
        assert.ok(extension!.isActive, 'Extension should be active');
    });

    test('Filter creation with regex', () => {
        // Test user input regex string to create filter
        const filter = new Filter(new RegExp('error'));
        assert.ok(filter, 'Filter should be created with valid regex');
        assert.strictEqual(filter.regex.source, 'error');
        assert.ok(filter.id, 'Filter should have an ID');
    });

    test('Filter regex update', () => {
        // Test user editing regex (through editFilter functionality)
        const filter = new Filter(new RegExp('warning'));
        assert.strictEqual(filter.regex.source, 'warning');
        
        // Simulate user editing regex
        filter.setRegex(new RegExp('error'));
        assert.strictEqual(filter.regex.source, 'error');
    });

    test('Filter text matching', () => {
        // Test filter's actual text matching functionality
        const filter = new Filter(new RegExp('ERROR', 'i'));
        
        // Test different log lines
        assert.ok(filter.regex.test('2023-11-20 ERROR: Database connection failed'));
        assert.ok(filter.regex.test('error in processing'));
        assert.ok(!filter.regex.test('INFO: Application started'));
        assert.ok(!filter.regex.test('WARN: Deprecated function'));
    });

    test('Project creation', () => {
        const project = createProject('Test Project');
        assert.ok(project, 'Project should be created');
        assert.strictEqual(project.name, 'Test Project');
        assert.ok(project.groups, 'Project should have groups map');
        assert.ok(project.filters, 'Project should have filters map');
    });

    test('Group creation', () => {
        const group = createGroup('Test Group');
        assert.ok(group, 'Group should be created');
        assert.strictEqual(group.name, 'Test Group');
        assert.ok(group.filters, 'Group should have filters map');
    });

    test('toggleHighlight command behavior', () => {
        // Create test state and data
        const testUri = vscode.Uri.file('/tmp/test');
        const state = createState(testUri, vscode.window.createOutputChannel("Test"));
        const project = createProject('Test Project');
        const group = createGroup('Test Group');
        const filter = new Filter(new RegExp('test'));

        // Setup test data
        project.groups.set(group.id, group);
        project.filters.set(filter.id, filter);
        group.filters.set(filter.id, filter);
        state.selectedProject = project;
        state.projectsMap.set(project.name, project);

        // Test filter highlight setting
        const filterTreeItem = { id: filter.id } as vscode.TreeItem;
        
        // Verify initial state
        assert.strictEqual(filter.isHighlighted, true, 'Filter should be highlighted by default');
        
        // Test disable highlight
        toggleHighlight(filterTreeItem, state);
        assert.strictEqual(filter.isHighlighted, false, 'Filter highlight should be disabled');
        
        // Test enable highlight
        toggleHighlight(filterTreeItem, state);
        assert.strictEqual(filter.isHighlighted, true, 'Filter highlight should be enabled');
    });

    test('setFocusAction (None/Included) command behavior', () => {
        // Create test state and data
        const testUri = vscode.Uri.file('/tmp/test');
        const state = createState(testUri, vscode.window.createOutputChannel("Test"));
        const project = createProject('Test Project');
        const group = createGroup('Test Group');
        const filter = new Filter(new RegExp('test'));

        // Setup test data
        project.groups.set(group.id, group);
        project.filters.set(filter.id, filter);
        group.filters.set(filter.id, filter);
        state.selectedProject = project;
        state.projectsMap.set(project.name, project);

        const filterTreeItem = { id: filter.id } as vscode.TreeItem;
        
        // Verify initial state
        assert.strictEqual(filter.focusAction, FocusAction.INCLUDED, 'Filter should be included by default');
        
        // Test set NONE
        setFocusAction(FocusAction.NONE, filterTreeItem, state);
        assert.strictEqual(filter.focusAction, FocusAction.NONE, 'Filter focus action should be NONE');
        
        // Test set INCLUDED
        setFocusAction(FocusAction.INCLUDED, filterTreeItem, state);
        assert.strictEqual(filter.focusAction, FocusAction.INCLUDED, 'Filter focus action should be INCLUDED');
    });

    test('setFocusAction (Excluded) command behavior', () => {
        // Create test state and data
        const testUri = vscode.Uri.file('/tmp/test');
        const state = createState(testUri, vscode.window.createOutputChannel("Test"));
        const project = createProject('Test Project');
        const filter = new Filter(new RegExp('test'));

        // Setup test data
        project.filters.set(filter.id, filter);
        state.selectedProject = project;
        state.projectsMap.set(project.name, project);

        const filterTreeItem = { id: filter.id } as vscode.TreeItem;
        
        // Verify initial state
        assert.strictEqual(filter.focusAction, FocusAction.INCLUDED, 'Filter should be included by default');
        
        // Test set to EXCLUDED
        setFocusAction(FocusAction.EXCLUDED, filterTreeItem, state);
        assert.strictEqual(filter.focusAction, FocusAction.EXCLUDED, 'Filter focus action should be EXCLUDED');
        
        // Test set back to NONE
        setFocusAction(FocusAction.NONE, filterTreeItem, state);
        assert.strictEqual(filter.focusAction, FocusAction.NONE, 'Filter focus action should be NONE');
    });

    test('deleteFilter command behavior', () => {
        // Create test state and data
        const testUri = vscode.Uri.file('/tmp/test');
        const state = createState(testUri, vscode.window.createOutputChannel("Test"));
        const project = createProject('Test Project');
        const group = createGroup('Test Group');
        const filter = new Filter(new RegExp('test'));

        // Setup test data
        project.groups.set(group.id, group);
        project.filters.set(filter.id, filter);
        group.filters.set(filter.id, filter);
        state.selectedProject = project;
        state.projectsMap.set(project.name, project);

        const filterTreeItem = { id: filter.id } as vscode.TreeItem;
        
        // Verify initial state
        assert.ok(project.filters.has(filter.id), 'Project should have the filter');
        assert.ok(group.filters.has(filter.id), 'Group should have the filter');
        
        // Execute deletion
        deleteFilter(filterTreeItem, state);
        
        // Verify state after deletion
        assert.ok(!project.filters.has(filter.id), 'Project should not have the filter after deletion');
        assert.ok(!group.filters.has(filter.id), 'Group should not have the filter after deletion');
    });

    test('selectProject command behavior', () => {
        // Create test state and data
        const testUri = vscode.Uri.file('/tmp/test');
        const state = createState(testUri, vscode.window.createOutputChannel("Test"));
        const project1 = createProject('Project 1');
        const project2 = createProject('Project 2');

        // Setup test data
        state.projectsMap.set(project1.name, project1);
        state.projectsMap.set(project2.name, project2);
        state.selectedProject = project1;
        project1.selected = true;

        const project2TreeItem = { id: project2.name } as vscode.TreeItem;
        
        // Verify initial state
        assert.strictEqual(state.selectedProject, project1, 'Project 1 should be selected initially');
        assert.strictEqual(project1.selected, true, 'Project 1 should have selected=true');
        assert.strictEqual(project2.selected, false, 'Project 2 should have selected=false');
        
        // Execute project selection
        const result = selectProject(project2TreeItem, state);
        
        // Verify state after selection
        assert.strictEqual(result, true, 'selectProject should return true on success');
        assert.strictEqual(state.selectedProject, project2, 'Project 2 should be selected');
        assert.strictEqual(project1.selected, false, 'Project 1 should have selected=false');
        assert.strictEqual(project2.selected, true, 'Project 2 should have selected=true');
    });

    test('exportProject command behavior', async () => {
        // Create test state and data
        const testUri = vscode.Uri.file(path.join(__dirname, '../../../test-storage'));
        const state = createState(testUri, vscode.window.createOutputChannel("Test"));
        const project = createProject('Export Test Project');
        const group = createGroup('Test Group');
        const filter1 = new Filter(new RegExp('error'), 'hsl(0, 50%, 40%)');
        const filter2 = new Filter(new RegExp('warning'), 'hsl(40, 50%, 40%)');

        // Setup test data
        project.groups.set(group.id, group);
        project.filters.set(filter1.id, filter1);
        project.filters.set(filter2.id, filter2);
        group.filters.set(filter1.id, filter1);
        group.filters.set(filter2.id, filter2);
        filter1.groupId = group.id;
        filter2.groupId = group.id;
        state.projectsMap.set(project.name, project);
        state.selectedProject = project;

        // Save the project first (exportProject relies on saved project files)
        const { saveProject } = require('../../settings');
        saveProject(testUri, project);

        // Create a temporary export path
        const exportPath = path.join(__dirname, '../../../test-storage/exported-project.json');
        const exportUri = vscode.Uri.file(exportPath);

        // Mock the showSaveDialog to return our test path
        const originalShowSaveDialog = vscode.window.showSaveDialog;
        vscode.window.showSaveDialog = async () => exportUri;

        try {
            // Execute export
            const projectTreeItem = { id: project.name } as any;
            await exportProject(state, projectTreeItem);

            // Verify the exported file exists
            assert.ok(fs.existsSync(exportPath), 'Exported file should exist');

            // Verify the exported content
            const exportedContent = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
            assert.strictEqual(exportedContent.name, 'Export Test Project', 'Exported project name should match');
            assert.strictEqual(exportedContent.groups.length, 1, 'Exported project should have 1 group');
            assert.strictEqual(exportedContent.filters.length, 2, 'Exported project should have 2 filters');
            assert.strictEqual(exportedContent.filters[0].groupId, group.id, 'Filter should have correct group ID');

            // Clean up
            if (fs.existsSync(exportPath)) {
                fs.unlinkSync(exportPath);
            }
        } finally {
            // Restore original function
            vscode.window.showSaveDialog = originalShowSaveDialog;
        }
    });

    test('importProject command behavior', async () => {
        // Create test state
        const testUri = vscode.Uri.file(path.join(__dirname, '../../../test-storage'));
        const state = createState(testUri, vscode.window.createOutputChannel("Test"));

        // Ensure the test-storage directory exists
        const testStoragePath = testUri.fsPath;
        if (!fs.existsSync(testStoragePath)) {
            fs.mkdirSync(testStoragePath, { recursive: true });
        }

        // Use the test fixture file from src directory (not compiled)
        const fixtureFile = path.join(__dirname, '../../../src/test/fixtures/test-project.json');
        const importUri = vscode.Uri.file(fixtureFile);

        // Verify fixture file exists
        if (!fs.existsSync(fixtureFile)) {
            assert.fail(`Test fixture file not found at: ${fixtureFile}`);
        }

        // Mock the showOpenDialog to return our test file
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        vscode.window.showOpenDialog = async () => [importUri];

        // Mock showInformationMessage to avoid UI interaction
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        let importSuccessMessage = '';
        vscode.window.showInformationMessage = async (message: string) => {
            importSuccessMessage = message;
            return undefined as any;
        };

        try {
            // Verify initial state
            assert.strictEqual(state.projectsMap.size, 0, 'Projects map should be empty initially');

            // Execute import
            await importProject(state);

            // Verify the project was imported
            assert.ok(state.projectsMap.has('Test Import Project'), 'Imported project should be in projects map');
            
            const importedProject = state.projectsMap.get('Test Import Project')!;
            assert.strictEqual(importedProject.name, 'Test Import Project', 'Imported project name should match');
            assert.strictEqual(importedProject.groups.size, 2, 'Imported project should have 2 groups');
            assert.strictEqual(importedProject.filters.size, 3, 'Imported project should have 3 filters total');

            // Verify groups
            const errorGroup = Array.from(importedProject.groups.values()).find(g => g.name === 'Error Group');
            const warningGroup = Array.from(importedProject.groups.values()).find(g => g.name === 'Warning Group');
            
            assert.ok(errorGroup, 'Error Group should exist');
            assert.ok(warningGroup, 'Warning Group should exist');
            assert.strictEqual(errorGroup!.filters.size, 2, 'Error Group should have 2 filters');
            assert.strictEqual(warningGroup!.filters.size, 1, 'Warning Group should have 1 filter');

            // Verify success message
            assert.ok(importSuccessMessage.includes('Test Import Project'), 'Success message should include project name');
            assert.ok(importSuccessMessage.includes('imported successfully'), 'Success message should confirm import');
        } finally {
            // Restore original functions
            vscode.window.showOpenDialog = originalShowOpenDialog;
            vscode.window.showInformationMessage = originalShowInformationMessage;

            // Clean up created files
            const projectsDir = path.join(testStoragePath, 'projects');
            if (fs.existsSync(projectsDir)) {
                const files = fs.readdirSync(projectsDir);
                files.forEach(file => {
                    fs.unlinkSync(path.join(projectsDir, file));
                });
            }
        }
    });

    test('importProject with duplicate name behavior', async () => {
        // Create test state with existing project
        const testUri = vscode.Uri.file(path.join(__dirname, '../../../test-storage'));
        const state = createState(testUri, vscode.window.createOutputChannel("Test"));
        
        // Ensure the test-storage directory exists
        const testStoragePath = testUri.fsPath;
        if (!fs.existsSync(testStoragePath)) {
            fs.mkdirSync(testStoragePath, { recursive: true });
        }

        const existingProject = createProject('Test Import Project');
        state.projectsMap.set(existingProject.name, existingProject);

        // Use the test fixture file from src directory (not compiled)
        const fixtureFile = path.join(__dirname, '../../../src/test/fixtures/test-project.json');
        const importUri = vscode.Uri.file(fixtureFile);

        // Mock the showOpenDialog
        const originalShowOpenDialog = vscode.window.showOpenDialog;
        vscode.window.showOpenDialog = async () => [importUri];

        // Mock showInformationMessage
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        let importSuccessMessage = '';
        vscode.window.showInformationMessage = async (message: string) => {
            importSuccessMessage = message;
            return undefined as any;
        };

        try {
            // Verify initial state
            assert.strictEqual(state.projectsMap.size, 1, 'Should have 1 project initially');

            // Execute import
            await importProject(state);

            // Verify the original project still exists
            assert.ok(state.projectsMap.has('Test Import Project'), 'Original project should still exist');
            
            // Verify the new project was imported with a modified name
            assert.ok(state.projectsMap.has('Test Import Project_1'), 'Imported project should have modified name');
            
            const importedProject = state.projectsMap.get('Test Import Project_1')!;
            assert.strictEqual(importedProject.name, 'Test Import Project_1', 'Imported project should have incremented name');
            assert.strictEqual(importedProject.groups.size, 2, 'Imported project should have correct structure');

            // Verify success message contains the modified name
            assert.ok(importSuccessMessage.includes('Test Import Project_1'), 'Success message should show modified name');
        } finally {
            // Restore original functions
            vscode.window.showOpenDialog = originalShowOpenDialog;
            vscode.window.showInformationMessage = originalShowInformationMessage;

            // Clean up created files
            const projectsDir = path.join(testStoragePath, 'projects');
            if (fs.existsSync(projectsDir)) {
                const files = fs.readdirSync(projectsDir);
                files.forEach(file => {
                    fs.unlinkSync(path.join(projectsDir, file));
                });
            }
        }
    });

    test('Algorithm: Priority resolution (highest priority match wins)', () => {
        const filterHigh = new Filter(new RegExp('ERROR'));
        filterHigh.priority = 100;
        const highId = filterHigh.id;

        const filterLow = new Filter(new RegExp('DATABASE'));
        filterLow.priority = 10;
        const lowId = filterLow.id;

        const filters = [filterHigh, filterLow];
        const { regex, filterMap } = buildCombinedRegex(filters);

        // Line contains both 'DATABASE' and 'ERROR'
        const text = "10:00 DATABASE ERROR: connection failed\n10:01 DATABASE: ok";
        const { filterResults, linePriorityWinners } = performCombinedAnalysis(text, regex, filterMap);

        const highMatches = filterResults.get(highId)!.lines;
        const lowMatches = filterResults.get(lowId)!.lines;

        // Both filters match line 0
        assert.ok(highMatches.has(0), 'Line 0 should be matched by high priority filter');
        assert.ok(lowMatches.has(0), 'Line 0 should ALSO be matched by low priority filter');
        
        // But highId should be the winner for coloring
        assert.strictEqual(linePriorityWinners.get(0), highId, 'High priority filter should be the coloring winner for line 0');
        
        // Line 1 only has DATABASE
        assert.ok(lowMatches.has(1), 'Line 1 should be matched by low priority filter');
    });

    test('Algorithm: Multi-match on same line (order of detection)', () => {
        const filterA = new Filter(new RegExp('apple'));
        filterA.priority = 10; // lower
        const idA = filterA.id;

        const filterB = new Filter(new RegExp('banana'));
        filterB.priority = 100; // higher
        const idB = filterB.id;

        const filters = [filterA, filterB];
        const { regex, filterMap } = buildCombinedRegex(filters);

        // 'apple' appears BEFORE 'banana', but 'banana' has higher priority
        const text = "I like apple and banana";
        const { filterResults, linePriorityWinners } = performCombinedAnalysis(text, regex, filterMap);

        assert.ok(filterResults.get(idB)!.lines.has(0), 'Filter B should match');
        assert.ok(filterResults.get(idA)!.lines.has(0), 'Filter A should match');
        assert.strictEqual(linePriorityWinners.get(0), idB, 'Higher priority filter B should be the coloring winner');
    });

    test('Filter Mode: TEXT matching handles special characters', () => {
        const filter = new Filter(new RegExp('')); // placeholder
        const textPattern = 'error.log* [crit]';
        const escaped = textPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        filter.mode = FilterMode.TEXT;
        filter.textPattern = textPattern;
        filter.setRegex(new RegExp(escaped));

        assert.ok(filter.test('Something error.log* [crit] happened'), 'Should match exact text');
        assert.ok(!filter.test('Something errorXlogY [crit] happened'), 'Should NOT match as regex');
    });

    test('Focus Mode Logic: content generation flow', () => {
        const project = createProject('FocusTest');
        
        // Filter 1: Show 'error' (INCLUDED)
        const f1 = new Filter(new RegExp('error'));
        f1.focusAction = FocusAction.INCLUDED;
        project.filters.set(f1.id, f1);

        // Filter 2: Show 'warn' (INCLUDED)
        const f2 = new Filter(new RegExp('warn'));
        f2.focusAction = FocusAction.INCLUDED;
        project.filters.set(f2.id, f2);

        // Filter 3: Exclude 'ignore' (EXCLUDED)
        const f3 = new Filter(new RegExp('ignore'));
        f3.focusAction = FocusAction.EXCLUDED;
        project.filters.set(f3.id, f3);

        const text = [
            "line 0: error",
            "line 1: warn",
            "line 2: info",
            "line 3: error ignore this",
            "line 4: warn ok"
        ].join('\n');

        // Build analysis results
        const filters = Array.from(project.filters.values());
        const { regex, filterMap } = buildCombinedRegex(filters);
        const { filterResults } = performCombinedAnalysis(text, regex, filterMap);

        // Map results back to filters
        const uri = 'test-uri';
        filterResults.forEach((data, id) => {
            project.filters.get(id)?.updateCache(uri, Array.from(data.lines));
        });

        // Simulating the new generateFilteredContent logic:
        // 1. Identify filters by action
        const inclusiveFilters = filters.filter(f => f.focusAction === FocusAction.INCLUDED);
        const exclusiveFilters = filters.filter(f => f.focusAction === FocusAction.EXCLUDED);

        // 2. Start with all lines if no inclusive, otherwise start empty and union matched
        let resultLines: Set<number> = new Set();
        if (inclusiveFilters.length === 0) {
            for (let i = 0; i < 5; i++) {resultLines.add(i);}
        } else {
            inclusiveFilters.forEach(f => {
                const matched = f.getMatchedLines(uri) as number[];
                matched.forEach(l => resultLines.add(l));
            });
        }

        // 3. Subtract all exclusive matches
        exclusiveFilters.forEach(f => {
            const matched = f.getMatchedLines(uri) as number[];
            matched.forEach(l => resultLines.delete(l));
        });

        const sorted = Array.from(resultLines).sort((a, b) => a - b);
        
        assert.ok(sorted.includes(0), 'Line 0 (error) should be shown');
        assert.ok(sorted.includes(1), 'Line 1 (warn) should be shown');
        assert.ok(!sorted.includes(2), 'Line 2 (info) should be hidden because it doesnt match any inclusive filter');
        assert.ok(!sorted.includes(3), 'Line 3 should be excluded by f3 even though it matches f1');
        assert.ok(sorted.includes(4), 'Line 4 should be shown');
    });
});
