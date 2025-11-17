import * as vscode from "vscode";
import { deleteProjectFile, readSettings, saveSettings } from "./settings";
import {
    State,
    Project,
    Group,
    createProject,
    LARGE_FILE_CONFIG,
    createGroup,
} from "./utils";
import { Filter, EditorInfo } from "./filter";

export function applyHighlight(
    state: State,
    editors: readonly EditorInfo[]
): void {
    const filters = state.selectedProject?.filters;
    if (!filters || filters.size === 0) {
        return;
    }
    
    editors.forEach(({ editor, uri, metaData }) => {
        filters.forEach((filter) => {
            filter.processEditor({ editor, uri, metaData });
        });
    });
}

// refresh filter tree. should be called after any change to the filters or groups
function refreshFilterGroupTreeView(state: State) {
    state.filterTreeViewProvider.update(Array.from(state.selectedProject?.groups.values() || []));
}

// refresh enter point will call this function for all editors or filter change
export function refreshEditors(state: State) {
    const filters = state.selectedProject?.filters;
    if (filters?.size == 0) {
        return;
    }

    const visibleEditors = vscode.window.visibleTextEditors;
    const activatedEditor = vscode.window.activeTextEditor;
    const editorInfos: EditorInfo[] = visibleEditors.map(editor => ({
        editor,
        uri: editor.document.uri,
        metaData: {
            lineCount: editor.document.lineCount,
            isLargeFile: editor.document.getText().length > LARGE_FILE_CONFIG.SIZE_THRESHOLD,
            isFocusMode: editor.document.uri.toString().startsWith("focus:"),
            isSelected: activatedEditor ? editor.document.uri.toString() === activatedEditor.document.uri.toString() : false,
        }
    }));

    applyHighlight(state, editorInfos);
    refreshFilterGroupTreeView(state);
    editorInfos.forEach(({ editor, uri, metaData }) => {
        if (metaData.isFocusMode) {
            state.focusProvider.refresh(editor);
        }
    });
}

export function updateFilterTreeViewAndFocusProvider(state: State) {
    const project = state.selectedProject;
    if (!project) {
        return;
    }
    const groups = project.groups.values() || null;
    if (!groups) {
        return;
    }
    const groupsArray = Array.from(groups);
    state.filterTreeViewProvider.update(groupsArray);
    state.focusProvider.update(project);
}

// refresh project tree view. should be called after any change to the projects
export function updateProjectTreeView(state: State) {
    const projectsArray = Array.from(state.projectsMap.values());
    state.projectTreeViewProvider.update(projectsArray);
}

//set bool for whether the lines matched the given filter will be kept for focus mode
export function setVisibility(
    isShown: boolean,
    treeItem: vscode.TreeItem,
    state: State
) {
    const id = treeItem.id!;
    
    // Check if it's a group operation
    if (id.startsWith('group-')) {
        const group = state.selectedProject?.groups.get(id);
        if (group) {
            group.isShown = isShown;
            group.filters.forEach((filter) => {
                filter.isShown = isShown;
            });
        }
    } 
    // Check if it's a filter operation
    else if (id.startsWith('filter-')) {
        const filter = state.selectedProject?.filters.get(id);
        if (filter) {
            filter.isShown = isShown;
        }
    }

    refreshEditors(state);
}

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

    refreshEditors(state);
}

export function setExclude(
    isExclude: boolean,
    treeItem: vscode.TreeItem,
    state: State
) {
    const id = treeItem.id!;

    const filter = state.selectedProject?.filters.get(id);
    if (!filter) {
        return;
    }
    filter.isExclude = isExclude;

    refreshEditors(state);
}

//turn on focus mode for the active editor. Will create a new tab if not already for the virtual document
export function turnOnFocusMode(state: State) {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    let escapedUri = editor.document.uri.toString();
    if (escapedUri.startsWith("focus:")) {
        //avoid creating nested focus mode documents
        vscode.window.showInformationMessage(
            "You are on focus mode virtual document already!"
        );
        return;
    }

    //set special schema
    let virtualUri = vscode.Uri.parse("focus:" + escapedUri);
    //because of the special schema, openTextDocument will use the focusProvider
    vscode.workspace
        .openTextDocument(virtualUri)
        .then((doc) => vscode.window.showTextDocument(doc));
}

/**
 * Filter related commands
 */
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
    refreshEditors(state);
    refreshFilterGroupTreeView(state);
    saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
}

export function addFilter(treeItem: vscode.TreeItem, state: State) {
    vscode.window
        .showInputBox({
            prompt: "[FILTER] Type a regex for that filter",
            ignoreFocusOut: false,
        })
        .then((regexStr) => {
            const group = state.selectedProject?.groups.get(treeItem.id!);
            if (!regexStr || !group) {
                return;
            }

            const filter = new Filter(new RegExp(regexStr));
            group!.filters.set(filter.id, filter);
            state.selectedProject?.filters.set(filter.id, filter); // for fast lookup
            refreshEditors(state);
            refreshFilterGroupTreeView(state);
            saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
        });
}

export function editFilter(treeItem: vscode.TreeItem, state: State) {
    const filter = state.selectedProject?.filters.get(treeItem.id!);
    if (!filter) {
        return;
    }

    vscode.window
        .showInputBox({
            prompt: "[FILTER] Type a new regex",
            ignoreFocusOut: false,
            value: filter.regex.source, // Pre-fill with the current regex
        })
        .then((regexStr) => {
            if ( regexStr === undefined || regexStr === filter.regex.source ) {
                return;
            }

            try {
                // Update the filter's regex using new method that handles cache invalidation
                filter.setRegex(new RegExp(regexStr));
                // Refresh the editors to apply changes
                refreshEditors(state);
                refreshFilterGroupTreeView(state);
                saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
            } catch (e) {
                // Show an error message if the new regex is invalid
                vscode.window.showErrorMessage(`Invalid Regex: ${e}`);
            }
        });
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

            refreshFilterGroupTreeView(state);
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
            refreshFilterGroupTreeView(state);
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

    refreshEditors(state);
    refreshFilterGroupTreeView(state);
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
    if (selectChanged) {
        updateFilterTreeViewAndFocusProvider(state);
        refreshEditors(state);
    }
    updateProjectTreeView(state);
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

    // Sync Maps after switching projects
    updateProjectTreeView(state);
    updateFilterTreeViewAndFocusProvider(state);
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
    state.selectedProject = selectedProject;

    // Add a project named "NONAMED" in the following cases:
    // - A default project is generated for users who do not use the project feature.
    // - If multiple projects are available but none is selected, an empty project is created and selected.
    if (state.projectsMap.size === 0) {
        createDefaultProject(state);
        saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
    }

    refreshEditors(state);
    updateProjectTreeView(state);
    updateFilterTreeViewAndFocusProvider(state);
}

