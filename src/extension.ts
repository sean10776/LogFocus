import * as vscode from "vscode";
import {
    addFilter,
    deleteFilter,
    editFilter,
    refreshEditors,
    setHighlight,
    setVisibility,
    turnOnFocusMode,
    addGroup,
    editGroup,
    deleteGroup,
    addProject,
    editProject,
    deleteProject,
    refreshSettings,
    selectProject,
    setExclude
} from "./commands";
import { createState, State } from "./utils";
import { openSettings } from "./settings";

// Simple debounce with setTimeout
let refreshTimeout: NodeJS.Timeout | null = null;

export function activate(context: vscode.ExtensionContext) {
    const state: State = createState(context.globalStorageUri);
    refreshSettings(state);

    //tell vs code to open focus:... uris with state.focusProvider
    const disposableFocus = vscode.workspace.registerTextDocumentContentProvider(
        "focus",
        state.focusProvider
    );
    context.subscriptions.push(disposableFocus);
    //register filterTreeViewProvider under id 'filters' which gets attached
    //to the file explorer according to package.json's contributes>views>explorer
    const view = vscode.window.createTreeView(
        "filters",
        { treeDataProvider: state.filterTreeViewProvider, showCollapseAll: true }
    );
    context.subscriptions.push(view);

    // Simple title updater function that view can use directly
    const updateTitle = () => {
        const project = state.selectedProject;
        view.title = project ? `Filters (${project.name})` : "Filters";
    };
    updateTitle(); // Initialize title

    //register projectTreeViewProvider under id 'filters.settings' which gets attached
    //to filter_project_setting in the Activity Bar according to package.json's contributes>views>filter_project_settings
    vscode.window.registerTreeDataProvider(
        "filters.settings",
        state.projectTreeViewProvider);

    // event listeners, include visible editor change, active editor change, document change
    var disposableOnDidChangeVisibleTextEditors =
        vscode.window.onDidChangeVisibleTextEditors((event) => {
            refreshEditors(state);
        });
    context.subscriptions.push(disposableOnDidChangeVisibleTextEditors);

    // Simple debounced refresh using setTimeout
    const DEBOUNCE_DELAY = 500; // 500ms debounce delay

    var disposableOnDidChangeTextDocument =
        vscode.workspace.onDidChangeTextDocument((event) => {
            // Clear existing timeout
            if (refreshTimeout) {
                clearTimeout(refreshTimeout);
            }
            
            // Set new timeout
            refreshTimeout = setTimeout(() => {
                console.log("Document changed, refreshing editors...");
                refreshEditors(state);
                refreshTimeout = null;
            }, DEBOUNCE_DELAY);
        });
    context.subscriptions.push(disposableOnDidChangeTextDocument);

    var disposableOnDidChangeActiveTextEditor =
        vscode.window.onDidChangeActiveTextEditor((event) => {
            refreshEditors(state);
        });
    context.subscriptions.push(disposableOnDidChangeActiveTextEditor);

    //register commands
    let disposableAddProject = vscode.commands.registerCommand(
        "log-analysis.addProject",
        () => addProject(state));
    context.subscriptions.push(disposableAddProject);

    let disposibleEditProject = vscode.commands.registerCommand(
        "log-analysis.editProject",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in Log Analysis Projects');
                return;
            }
            editProject(treeItem, state);
            updateTitle();
        }
    );
    context.subscriptions.push(disposibleEditProject);

    let disposableDeleteProject = vscode.commands.registerCommand(
        "log-analysis.deleteProject",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in Log Analysis Projects');
                return;
            }
            deleteProject(treeItem, state);
            updateTitle();
        });
    context.subscriptions.push(disposableDeleteProject);

    let disposableOpenSettings = vscode.commands.registerCommand(
        "log-analysis.openSettings",
        () => openSettings(state.globalStorageUri));
    context.subscriptions.push(disposableOpenSettings);

    let disposableRefreshSettings = vscode.commands.registerCommand(
        "log-analysis.refreshSettings",
        () => {
            refreshSettings(state);
            updateTitle();
        });
    context.subscriptions.push(disposableRefreshSettings);

    let disposableSelectProject = vscode.commands.registerCommand(
        "log-analysis.selectProject",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in Log Analysis+ Projects');
                return;
            }
            if (selectProject(treeItem, state)) {
                updateTitle();
                vscode.commands.executeCommand('workbench.view.explorer');
            }
        });
    context.subscriptions.push(disposableSelectProject);

    let disposableEnableVisibility = vscode.commands.registerCommand(
        "log-analysis.enableVisibility",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
                return;
            }
            setVisibility(true, treeItem, state);
        }
    );
    context.subscriptions.push(disposableEnableVisibility);

    let disposableDisableVisibility = vscode.commands.registerCommand(
        "log-analysis.disableVisibility",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
                return;
            }
            setVisibility(false, treeItem, state);
        }
    );
    context.subscriptions.push(disposableDisableVisibility);

    let disposableTurnOnFocusMode = vscode.commands.registerCommand(
        "log-analysis.turnOnFocusMode",
        () => turnOnFocusMode(state)
    );
    context.subscriptions.push(disposableTurnOnFocusMode);

    let disposibleAddFilter = vscode.commands.registerCommand(
        "log-analysis.addFilter",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
                return;
            }
            addFilter(treeItem, state);
        }
    );
    context.subscriptions.push(disposibleAddFilter);

    let disposibleEditFilter = vscode.commands.registerCommand(
        "log-analysis.editFilter",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
                return;
            }
            editFilter(treeItem, state);
        }
    );
    context.subscriptions.push(disposibleEditFilter);

    let disposibleDeleteFilter = vscode.commands.registerCommand(
        "log-analysis.deleteFilter",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
                return;
            }
            deleteFilter(treeItem, state);
        }
    );
    context.subscriptions.push(disposibleDeleteFilter);

    let disposibleEnableHighlight = vscode.commands.registerCommand(
        "log-analysis.enableHighlight",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
                return;
            }
            setHighlight(true, treeItem, state);
        }
    );
    context.subscriptions.push(disposibleEnableHighlight);

    let disposibleDisableHighlight = vscode.commands.registerCommand(
        "log-analysis.disableHighlight",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
                return;
            }
            setHighlight(false, treeItem, state);
        }
    );
    context.subscriptions.push(disposibleDisableHighlight);

    let disposibleAddGroup = vscode.commands.registerCommand(
        "log-analysis.addGroup",
        () => addGroup(state)
    );
    context.subscriptions.push(disposibleAddGroup);

    let disposibleEditGroup = vscode.commands.registerCommand(
        "log-analysis.editGroup",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
                return;
            }
            editGroup(treeItem, state);
        }
    );
    context.subscriptions.push(disposibleEditGroup);

    let disposableEnableExclude = vscode.commands.registerCommand(
        "log-analysis.enableExclude",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in FILTERS');
                return;
            }
            setExclude(true, treeItem, state);
        }
    );
    context.subscriptions.push(disposableEnableExclude);

    let disposableDisableExclude = vscode.commands.registerCommand(
        "log-analysis.disableExclude",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in FILTERS');
                return;
            }
            setExclude(false, treeItem, state);
        }
    );
    context.subscriptions.push(disposableDisableExclude);

    let disposibleDeleteGroup = vscode.commands.registerCommand(
        "log-analysis.deleteGroup",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is excuted with button in FILTERS');
                return;
            }
            deleteGroup(treeItem, state);
        }
    );
    context.subscriptions.push(disposibleDeleteGroup);
}

// this method is called when your extension is deactivated
export function deactivate() {
    // Clear any pending refresh timeout
    if (refreshTimeout) {
        clearTimeout(refreshTimeout);
        refreshTimeout = null;
    }
}
