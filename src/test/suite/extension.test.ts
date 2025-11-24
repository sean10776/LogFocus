import * as assert from 'assert';
import * as vscode from 'vscode';
import { Filter } from '../../filter';
import { createProject, createGroup, createState } from '../../utils';
import { 
    setHighlight, 
    setVisibility, 
    setExclude,
    deleteFilter,
    deleteGroup,
    selectProject
} from '../../commands';

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

    test('setHighlight command behavior', () => {
        // Create test state and data
        const testUri = vscode.Uri.file('/tmp/test');
        const state = createState(testUri);
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
        setHighlight(false, filterTreeItem, state);
        assert.strictEqual(filter.isHighlighted, false, 'Filter highlight should be disabled');
        
        // Test enable highlight
        setHighlight(true, filterTreeItem, state);
        assert.strictEqual(filter.isHighlighted, true, 'Filter highlight should be enabled');
    });

    test('setVisibility command behavior', () => {
        // Create test state and data
        const testUri = vscode.Uri.file('/tmp/test');
        const state = createState(testUri);
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
        assert.strictEqual(filter.isShown, true, 'Filter should be visible by default');
        
        // Test hide filter
        setVisibility(false, filterTreeItem, state);
        assert.strictEqual(filter.isShown, false, 'Filter should be hidden');
        
        // Test show filter
        setVisibility(true, filterTreeItem, state);
        assert.strictEqual(filter.isShown, true, 'Filter should be visible');
    });

    test('setExclude command behavior', () => {
        // Create test state and data
        const testUri = vscode.Uri.file('/tmp/test');
        const state = createState(testUri);
        const project = createProject('Test Project');
        const filter = new Filter(new RegExp('test'));

        // Setup test data
        project.filters.set(filter.id, filter);
        state.selectedProject = project;
        state.projectsMap.set(project.name, project);

        const filterTreeItem = { id: filter.id } as vscode.TreeItem;
        
        // Verify initial state
        assert.strictEqual(filter.isExclude, false, 'Filter should be include by default');
        
        // Test set to exclude
        setExclude(true, filterTreeItem, state);
        assert.strictEqual(filter.isExclude, true, 'Filter should be exclude');
        
        // Test set to include
        setExclude(false, filterTreeItem, state);
        assert.strictEqual(filter.isExclude, false, 'Filter should be include');
    });

    test('deleteFilter command behavior', () => {
        // Create test state and data
        const testUri = vscode.Uri.file('/tmp/test');
        const state = createState(testUri);
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
        const state = createState(testUri);
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
});
