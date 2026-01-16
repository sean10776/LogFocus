import * as vscode from "vscode";
import { deleteProjectFile, readSettings, saveSettings } from "./settings";
import {
    State,
    Project,
    Group,
    createProject,
    createGroup,
    buildCombinedRegex,
    performCombinedAnalysis,
} from "./utils";
import { Filter, EditorInfo, FilterMode, FocusAction } from "./filter";
import { FocusProvider } from "./focusProvider";

// ============================================================================
// Update Interfaces - Each function has single responsibility
// ============================================================================

/**
 * Update Project Tree View
 * Responsibility: Refresh the project list tree view display
 * Call when: Project added/deleted/renamed
 */
function updateProjectTreeView(state: State) {
    const projectsArray = Array.from(state.projectsMap.values());
    state.projectTreeViewProvider.update(projectsArray);
}

/**
 * Update Filter/Group Tree View
 * Responsibility: Refresh the filter and group tree view display
 * Call when: Filter/Group added/deleted/renamed/reordered
 */
export function updateFilterTreeView(state: State) {
    const project = state.selectedProject;
    if (!project) {
        return;
    }
    state.filterTreeViewProvider.update(project);
}

/**
 * Apply filter highlights using optimized combined regex approach - O(m) time complexity
 */
async function applyFilterHighlights(
    state: State,
    editors: readonly EditorInfo[]
): Promise<void> {
    if (!state.selectedProject || !state.selectedProject.filteringEnabled) {
        return;
    }

    const filters = Array.from(state.selectedProject.filters.values())
        .filter(f => f.focusAction !== FocusAction.NONE);

    if (filters.length === 0) {
        return;
    }

    // Hoist regex building outside the editor loop
    const { regex: combinedRegex, filterMap } = buildCombinedRegex(filters);

    // Process each visible editor
    for (const editorInfo of editors) {
        const document = editorInfo.editor.document;
        const text = document.getText();
        const { filterResults, linePriorityWinners } = performCombinedAnalysis(text, combinedRegex, filterMap);

        const uriString = document.uri.toString();
        
        // Cache results ONLY for non-focus documents
        // Focus documents have shifting line numbers, we don't cache them
        if (!editorInfo.metaData.isFocusMode) {
            filterResults.forEach((data, filterId) => {
                const filter = state.selectedProject!.filters.get(filterId);
                if (filter) {
                    filter.updateCache(uriString, Array.from(data.lines));
                }
            });
        }

        // Apply decorations to this editor (works for both normal and focus)
        filters.forEach(filter => {
            if (!filter.isHighlighted) {
                if (filter.decoration) {
                    editorInfo.editor.setDecorations(filter.decoration, []);
                }
                return;
            }

            // Only highlight lines where THIS filter is the priority winner
            const ranges: vscode.Range[] = [];
            filterResults.get(filter.id)?.lines.forEach(lineNum => {
                if (linePriorityWinners.get(lineNum) === filter.id) {
                    ranges.push(new vscode.Range(
                        new vscode.Position(lineNum, 0),
                        new vscode.Position(lineNum, 0)
                    ));
                }
            });
            
            const decoration = filter.decoration;
            if (decoration) {
                editorInfo.editor.setDecorations(decoration, ranges);
            }
        });

        // If focus mode, also apply the marker
        if (editorInfo.metaData.isFocusMode) {
            FocusProvider.applyFocusModeMarker(editorInfo.editor);
        }
    }
}

function updateFocusProvider(state: State) {
    const project = state.selectedProject;
    if (!project) {
        return;
    }
    state.focusProvider.update(project);
}

/**
 * Refresh Focus Mode Editors
 * Responsibility: Regenerate content for all visible focus mode editors
 */
function refreshFocusModeEditors(state: State, editors: readonly EditorInfo[]) {
    editors.forEach(({editor, metaData}) => {
        if (metaData.isFocusMode) {
            state.focusProvider.refresh(editor);
        }
    });
}

/**
 * Full Editor Refresh
 * Responsibility: Complete update cycle for all visible editors
 * Call when: Any filter change that affects display
 * - Applies filter highlights
 * - Refreshes focus mode content
 * - Updates filter tree view (to reflect new count values)
 */
export function refreshEditors(state: State) {
    const filters = state.selectedProject?.filters;
    if (!filters || filters.size === 0) {
        return;
    }

    const visibleEditors = vscode.window.visibleTextEditors;
    const editorInfos: EditorInfo[] = visibleEditors.map(editor => ({
        editor,
        metaData: {
            isFocusMode: FocusProvider.isFocusUri(editor.document.uri),
        }
    }));

    void applyFilterHighlights(state, editorInfos).then(() => {
        // Refresh focus mode content (triggers provideTextDocumentContent)
        refreshFocusModeEditors(state, editorInfos);
        
        // Update tree view
        updateFilterTreeView(state);
        
        // Re-apply highlights to focus mode editors after delay
        // This ensures they are highlighted relative to their NEW filtered content
        setTimeout(() => {
            const focusEditors = editorInfos.filter(info => info.metaData.isFocusMode);
            if (focusEditors.length > 0) {
                applyFilterHighlights(state, focusEditors);
            }
        }, 200);
    });
}

//set highlight for matched lines
export function setHighlight(
    isHighlighted: boolean,
    treeItem: vscode.TreeItem,
    state: State
) {
    const id = treeItem.id!;

    // Check if it's a group operation
    if (id.startsWith('group-')) {
        const group = state.selectedProject?.groups.get(id);
        if (group) {
            group.isHighlighted = isHighlighted;
            group.filters.forEach((filter) => {
                filter.isHighlighted = isHighlighted;
            });
        }
    } 
    // Check if it's a filter operation
    else if (id.startsWith('filter-')) {
        const filter = state.selectedProject?.filters.get(id);
        if (filter) {
            filter.isHighlighted = isHighlighted;
        }
    }

    // Update: Filter properties changed → refresh editors (tree view auto-updated)
    refreshEditors(state);
    saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
}

/**
 * Toggle the global filtering mode for the current project
 */
export function toggleFilteringMode(state: State): void {
    if (!state.selectedProject) {
        return;
    }

    state.selectedProject.filteringEnabled = !state.selectedProject.filteringEnabled;
    
    vscode.window.showInformationMessage(
        `Filtering mode: ${state.selectedProject.filteringEnabled ? 'ON' : 'OFF'}`
    );

    saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
    refreshEditors(state);
}

//turn on focus mode for the active editor. Will create a new tab if not already for the virtual document
export function turnOnFocusMode() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const originalUri = editor.document.uri;
    if (FocusProvider.isFocusUri(originalUri)) {
        //avoid creating nested focus mode documents
        vscode.window.showInformationMessage(
            "You are on focus mode virtual document already!"
        );
        return;
    }

    //set special schema
    const virtualUri = FocusProvider.virtualUri(originalUri);
    vscode.workspace
        .openTextDocument(virtualUri)
        .then((doc) => vscode.window.showTextDocument(doc));
}

/**
 * Filter related commands
 */
export function setFocusAction(
    action: FocusAction,
    treeItem: vscode.TreeItem,
    state: State
) {
    const id = treeItem.id!;

    // Check if it's a group operation
    if (id.startsWith('group-')) {
        const group = state.selectedProject?.groups.get(id);
        if (group) {
            group.focusAction = action;
            group.filters.forEach((filter) => {
                filter.focusAction = action;
            });
        }
    } 
    // Check if it's a filter operation
    else if (id.startsWith('filter-')) {
        const filter = state.selectedProject?.filters.get(id);
        if (filter) {
            filter.focusAction = action;
        }
    }

    refreshEditors(state);
    saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
}

export function deleteFilter(treeItem: vscode.TreeItem, state: State) {
    const filter = state.selectedProject?.filters.get(treeItem.id!);
    if (!filter) {
        return;
    }
    state.selectedProject?.filters.delete(treeItem.id!);
    state.selectedProject?.groups.forEach((group) => {
        if (group.filters.has(treeItem.id!)) {
            group.filters.delete(treeItem.id!);
        }
    });
    filter.dispose();
    
    // Update: Filter deleted → refresh editors (tree view auto-updated)
    refreshEditors(state);
    saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
}

export async function addFilter(treeItem: vscode.TreeItem | undefined, state: State) {
    if (!state.selectedProject) return;

    // 1. Choose Mode
    const modePick = await vscode.window.showQuickPick(
        [
            { label: "Regex", description: "Match using Regular Expressions", value: FilterMode.REGEX },
            { label: "Text", description: "Match using Plain Text (case-sensitive)", value: FilterMode.TEXT }
        ],
        { title: "Select Filter Mode" }
    );

    if (!modePick) return;

    // 2. Input Pattern
    const pattern = await vscode.window.showInputBox({
        prompt: modePick.value === FilterMode.REGEX 
            ? "[FILTER] Type a regex pattern" 
            : "[FILTER] Type a plain text pattern",
        ignoreFocusOut: false,
    });

    if (!pattern) return;

    try {
        let regex: RegExp;
        let textPattern = "";

        if (modePick.value === FilterMode.REGEX) {
            regex = new RegExp(pattern);
        } else {
            // In TEXT mode, we use a regex that escapes all special characters
            const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            regex = new RegExp(escaped);
            textPattern = pattern;
        }

        const filter = new Filter(regex);
        filter.mode = modePick.value;
        filter.textPattern = textPattern;
        
        // If treeItem is a group, add to group. Otherwise, it's top-level
        if (treeItem && state.selectedProject.groups.has(treeItem.id!)) {
            const group = state.selectedProject.groups.get(treeItem.id!);
            if (group) {
                filter.groupId = group.id;
                group.filters.set(filter.id, filter);
            }
        }
        
        state.selectedProject.filters.set(filter.id, filter); 
        
        // Update: Filter added → refresh editors (tree view auto-updated)
        refreshEditors(state);
        saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
    } catch (e) {
        vscode.window.showErrorMessage(`Invalid Pattern: ${e}`);
    }
}

export async function editFilter(treeItem: vscode.TreeItem, state: State) {
    const filter = state.selectedProject?.filters.get(treeItem.id!);
    if (!filter) {
        return;
    }

    // 1. Choose Mode
    const modePick = await vscode.window.showQuickPick(
        [
            { label: "Regex", description: "Match using Regular Expressions", value: FilterMode.REGEX },
            { label: "Text", description: "Match using Plain Text (case-sensitive)", value: FilterMode.TEXT }
        ],
        { 
            title: "Edit Filter Mode",
            placeHolder: `Current: ${filter.mode === FilterMode.REGEX ? "Regex" : "Text"}`
        }
    );

    if (!modePick) return;

    // 2. Input Pattern
    const pattern = await vscode.window.showInputBox({
        prompt: modePick.value === FilterMode.REGEX 
            ? "[FILTER] Edit regex pattern" 
            : "[FILTER] Edit plain text pattern",
        ignoreFocusOut: false,
        value: modePick.value === FilterMode.TEXT && filter.textPattern ? filter.textPattern : filter.regex.source,
    });

    if (pattern === undefined) return;

    try {
        let regex: RegExp;
        let textPattern = "";

        if (modePick.value === FilterMode.REGEX) {
            regex = new RegExp(pattern);
        } else {
            const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            regex = new RegExp(escaped);
            textPattern = pattern;
        }

        filter.mode = modePick.value;
        filter.textPattern = textPattern;
        filter.setRegex(regex);
        
        refreshEditors(state);
        saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
    } catch (e) {
        vscode.window.showErrorMessage(`Invalid Pattern: ${e}`);
    }
}

/**
 * Group related commands
 */
export function addGroup(state: State) {
    vscode.window
        .showInputBox({
            prompt: "[GROUP] Type a new group name",
            ignoreFocusOut: false,
        })
        .then((name) => {
            if (name === undefined) {
                return;
            }

            const group: Group = createGroup(name);
            state.selectedProject?.groups.set(group.id, group);

            // Update: Group added → update tree only (no filter change)
            updateFilterTreeView(state);
            saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
        });
}

export function editGroup(treeItem: vscode.TreeItem, state: State) {
    const group = state.selectedProject?.groups.get(treeItem.id!);
    if (!group) {
        return;
    }
    vscode.window
        .showInputBox({
            prompt: "[GROUP] Type a new group name",
            value: group.name,
            ignoreFocusOut: false,
        })
        .then((name) => {
            if (name === undefined) {
                return;
            }
            group!.name = name;
            
            // Update: Group renamed → update tree only (no filter change)
            updateFilterTreeView(state);
            saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
        });
}

export function deleteGroup(treeItem: vscode.TreeItem, state: State) {
    const group = state.selectedProject?.groups.get(treeItem.id!);
    if (!group) {
        return;
    }

    group.filters.forEach((filter) => {
        state.selectedProject?.filters.delete(filter.id);
        filter.dispose();
    });
    state.selectedProject?.groups.delete(treeItem.id!);

    // Update: Group and filters deleted → refresh editors (tree view auto-updated)
    refreshEditors(state);
    saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
}

/**
 * Project related commands
 */

function validProjectName(name: string): boolean {
    // project name should also be a valid file name
    const invalidChars = /[<>:"\/\\|?*\x00-\x1F]/g;
    return !invalidChars.test(name);
}

function _addProject(state: State, name: string) {
    if (!validProjectName(name)) {
        vscode.window.showErrorMessage("Invalid project name");
        return null;
    }
    if (state.projectsMap.has(name)) {
        vscode.window.showErrorMessage("Project name already exists");
        return null;
    }

    const project: Project = createProject(name);
    state.projectsMap.set(project.name, project);
    return project;
}

export function addProject(state: State) {
    vscode.window
        .showInputBox({
            prompt: "[PROJECT] Type a new project name",
            ignoreFocusOut: false,
        })
        .then((name) => {
            if (name === undefined || !_addProject(state, name)) {
                return;
            }

            updateProjectTreeView(state);
            saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
        });
}

export function editProject(
    treeItem: vscode.TreeItem,
    state: State,
) {
    let project = state.projectsMap.get(treeItem.id!);
    if (project === undefined) {
        return;
    }

    vscode.window
        .showInputBox({
            prompt: "[PROJECT] Type a new name",
            value: project.name,
            ignoreFocusOut: false,
        })
        .then((name) => {
            if (name === undefined) {
                return;
            }
            const newProject = _addProject(state, name);
            if (newProject === null) {
                return;
            }
            state.projectsMap.delete(project!.name);
            deleteProjectFile(state.globalStorageUri, project!);
            state.projectsMap.set(name, newProject);

            // copy elements to the new project
            newProject.groups = project!.groups;
            newProject.filters = project!.filters;
            newProject.selected = project!.selected;

            updateProjectTreeView(state);
            saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
        });
}

export function deleteProject(treeItem: vscode.TreeItem, state: State) {
    const project = state.projectsMap.get(treeItem.id!);
    if (project === undefined) {
        return;
    }

    project.filters.forEach((filter) => {
        filter.dispose();
    });

    let selectChanged = false;
    if (project === state.selectedProject) {
        state.selectedProject = state.projectsMap.values().next().value || null;
        selectChanged = true;
    }

    state.projectsMap.delete(treeItem.id!);
    deleteProjectFile(state.globalStorageUri, project);
    
    // Update: Project deleted
    if (selectChanged) {
        // Current project deleted → update all (refreshEditors will update filter tree)
        updateProjectTreeView(state);
        updateFocusProvider(state);
        refreshEditors(state);
    } else {
        // Other project deleted → update project tree only
        updateProjectTreeView(state);
    }
    
    saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
}

export function selectProject(
    treeItem: vscode.TreeItem,
    state: State
): boolean {
    const currentProject = state.selectedProject;

    if (currentProject && currentProject.id === treeItem.id) {
        vscode.window.showInformationMessage("This project is already selected");
        return true;
    }

    state.selectedProject = state.projectsMap.get(treeItem.id! ) || null;
    if (!state.selectedProject) {
        vscode.window.showErrorMessage("Selected project not found");
        state.selectedProject = currentProject;
        return false;
    }

    state.selectedProject.selected = true;

    if (currentProject) {
        currentProject.selected = false;
        currentProject.filters.forEach((filter) => {
            filter.dispose();
        });
    }

    // Update: Project switched → update all (refreshEditors will update filter tree)
    updateProjectTreeView(state);
    updateFocusProvider(state);
    refreshEditors(state);
    saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
    return true;
}

function createDefaultProject(state: State) {
    const default_project: Project = createProject("NONAME");
    state.projectsMap.set(default_project.name, default_project);
    state.selectedProject = default_project;
}

export function refreshSettings(state: State) {
    const { projects, selectedProject } = readSettings(state.globalStorageUri);
    state.projectsMap = projects;
    if (state.selectedProject && selectedProject !== state.selectedProject) {
        state.selectedProject.filters.forEach((filter) => {
            filter.dispose();
        });
    }
    state.selectedProject = selectedProject;

    // Add a project named "NONAMED" in the following cases:
    // - A default project is generated for users who do not use the project feature.
    // - If multiple projects are available but none is selected, an empty project is created and selected.
    if (state.projectsMap.size === 0) {
        createDefaultProject(state);
        saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
    }

    // Update: Settings reloaded → update all (refreshEditors will update filter tree)
    updateProjectTreeView(state);
    updateFocusProvider(state);
    refreshEditors(state);
}

export async function exportProject(state: State, projectItem: any) {
    const projectId = projectItem?.id;
    if (!projectId) {
        vscode.window.showErrorMessage("No project selected for export.");
        return;
    }

    const project = state.projectsMap.get(projectId);
    if (!project) {
        vscode.window.showErrorMessage("Project not found.");
        return;
    }

    const defaultUri = vscode.Uri.file(`${project.name}.json`);
    const uri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: {
            'JSON Files': ['json'],
            'All Files': ['*']
        },
        title: `Export Project: ${project.name}`
    });

    if (!uri) {
        return; // User cancelled
    }

    try {
        // Get the project file path from internal storage
        const { getProjectFilePath, projectFileName } = require('./settings');
        const projectFile = getProjectFilePath(state.globalStorageUri, projectFileName(project));
        
        // Read the existing project file and copy to export location
        const fileUri = projectFile.startsWith('file://') ? vscode.Uri.parse(projectFile) : vscode.Uri.file(projectFile);
        const content = await vscode.workspace.fs.readFile(fileUri);
        await vscode.workspace.fs.writeFile(uri, content);
        
        vscode.window.showInformationMessage(`Project "${project.name}" exported successfully.`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to export project: ${error}`);
    }
}

export async function importProject(state: State) {
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
            'JSON Files': ['json'],
            'All Files': ['*']
        },
        title: 'Import Project'
    });

    if (!uris || uris.length === 0) {
        return; // User cancelled
    }

    try {
        // Read the file content
        const content = await vscode.workspace.fs.readFile(uris[0]);
        const data = JSON.parse(content.toString());

        // Validate data structure
        if (!data.name || !Array.isArray(data.groups)) {
            vscode.window.showErrorMessage("Invalid project file format.");
            return;
        }

        // Check if project with same name already exists
        let projectName = data.name;
        let counter = 1;
        while (state.projectsMap.has(projectName)) {
            projectName = `${data.name}_${counter}`;
            counter++;
        }

        // Save to temporary file in projects directory and use loadProject
        const { getSaveProjectFilePath, loadProject, projectFileName } = require('./settings');
        const tempFileName = projectFileName({ name: projectName } as Project);
        const tempFilePath = getSaveProjectFilePath(state.globalStorageUri, tempFileName, projectName);
        
        // Write the content with potentially renamed project
        const updatedData = { ...data, name: projectName };
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(tempFilePath),
            Buffer.from(JSON.stringify(updatedData, null, 4), 'utf8')
        );
        
        // Load using existing loadProject function
        const newProject = loadProject(tempFilePath);
        
        if (!newProject) {
            vscode.window.showErrorMessage("Failed to load imported project.");
            return;
        }

        // Add to projects map
        state.projectsMap.set(newProject.name, newProject);
        
        // Save settings
        saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
        
        // Refresh UI
        updateProjectTreeView(state);
        
        vscode.window.showInformationMessage(`Project "${projectName}" imported successfully.`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to import project: ${error}`);
    }
}
