import * as vscode from "vscode";
import {
    addFilter,
    deleteFilter,
    editFilter,
    refreshEditors,
    setFocusAction,
    turnOnFocusMode,
    addGroup,
    editGroup,
    deleteGroup,
    addProject,
    editProject,
    deleteProject,
    refreshSettings,
    selectProject,
    exportProject,
    importProject,
    updateFilterTreeView,
    toggleExtension,
    toggleHighlight,
} from "./commands";
import { createState, State } from "./utils";
import { openSettings, saveSettings } from "./settings";
import { FocusProvider } from "./focusProvider";
import { FocusAction } from "./filter";

// Simple debounce with setTimeout
let refreshTimeout: NodeJS.Timeout | null = null;

export function activate(context: vscode.ExtensionContext) {
    // Create output channel for LogFocus
    const outputChannel = vscode.window.createOutputChannel("LogFocus");
    context.subscriptions.push(outputChannel);
    
    const state: State = createState(context.globalStorageUri, outputChannel);
    refreshSettings(state);

    // Create status bar item for extension toggle
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBarItem.text = "$(eye) LogFocus";
    statusBarItem.tooltip = "LogFocus is enabled. Click to disable.";
    statusBarItem.command = "logfocus.toggleExtension";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

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
        { 
            treeDataProvider: state.filterTreeViewProvider, 
            showCollapseAll: true,
            dragAndDropController: state.filterTreeViewProvider
        }
    );
    context.subscriptions.push(view);

    // Refresh editors when filter tree changes (e.g. after drop)
    state.filterTreeViewProvider.onDataChange = () => {
        refreshEditors(state);
        saveSettings(state.globalStorageUri, state.projectsMap, state.selectedProject);
    };

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

    // 1. Visible editors change - refresh editors
    const disposableOnDidChangeVisibleTextEditors =
        vscode.window.onDidChangeVisibleTextEditors(() => refreshEditors(state));
    context.subscriptions.push(disposableOnDidChangeVisibleTextEditors);

    // 2. Document change - debounce refresh editors
    // Simple debounced refresh using setTimeout
    const DEBOUNCE_DELAY = 500; // 500ms debounce delay

    const disposableOnDidChangeTextDocument =
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (FocusProvider.isFocusUri(event.document.uri)) {
                return; // Ignore changes to focus documents
            }
            // Clear existing timeout
            if (refreshTimeout) {
                clearTimeout(refreshTimeout);
            }
            
            // Set new timeout
            refreshTimeout = setTimeout(() => {
                refreshEditors(state);
                refreshTimeout = null;
            }, DEBOUNCE_DELAY);
        });
    context.subscriptions.push(disposableOnDidChangeTextDocument);

    // 3. Active editor change - update filter tree view
    const disposableOnDidChangeActiveTextEditor =
        vscode.window.onDidChangeActiveTextEditor(() => updateFilterTreeView(state));
    context.subscriptions.push(disposableOnDidChangeActiveTextEditor);

    //register commands
    const disposableToggleExtension = vscode.commands.registerCommand(
        "logfocus.toggleExtension",
        () => toggleExtension(state, statusBarItem)
    );
    context.subscriptions.push(disposableToggleExtension);

    const disposableAddProject = vscode.commands.registerCommand(
        "logfocus.addProject",
        () => addProject(state));
    context.subscriptions.push(disposableAddProject);

    const disposableEditProject = vscode.commands.registerCommand(
        "logfocus.editProject",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in Log Analysis Projects');
                return;
            }
            editProject(treeItem, state);
            updateTitle();
        }
    );
    context.subscriptions.push(disposableEditProject);

    const disposableDeleteProject = vscode.commands.registerCommand(
        "logfocus.deleteProject",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in Log Analysis Projects');
                return;
            }
            deleteProject(treeItem, state);
            updateTitle();
        });
    context.subscriptions.push(disposableDeleteProject);

    const disposableOpenSettings = vscode.commands.registerCommand(
        "logfocus.openSettings",
        () => openSettings(state.globalStorageUri));
    context.subscriptions.push(disposableOpenSettings);

    const disposableRefreshSettings = vscode.commands.registerCommand(
        "logfocus.refreshSettings",
        () => {
            refreshSettings(state);
            updateTitle();
        });
    context.subscriptions.push(disposableRefreshSettings);

    const disposableSelectProject = vscode.commands.registerCommand(
        "logfocus.selectProject",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in Log Analysis Projects');
                return;
            }
            if (selectProject(treeItem, state)) {
                updateTitle();
                vscode.commands.executeCommand('workbench.view.explorer');
            }
        });
    context.subscriptions.push(disposableSelectProject);

    const disposableSetFocusIncluded = vscode.commands.registerCommand(
        "logfocus.setFocusIncluded",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in FILTERS');
                return;
            }
            setFocusAction(FocusAction.INCLUDED, treeItem, state);
        }
    );
    context.subscriptions.push(disposableSetFocusIncluded);

    const disposableSetFocusExcluded = vscode.commands.registerCommand(
        "logfocus.setFocusExcluded",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in FILTERS');
                return;
            }
            setFocusAction(FocusAction.EXCLUDED, treeItem, state);
        }
    );
    context.subscriptions.push(disposableSetFocusExcluded);

    const disposableSetFocusNone = vscode.commands.registerCommand(
        "logfocus.setFocusNone",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in FILTERS');
                return;
            }
            setFocusAction(FocusAction.NONE, treeItem, state);
        }
    );
    context.subscriptions.push(disposableSetFocusNone);

    const disposableExportProject = vscode.commands.registerCommand(
        "logfocus.exportProject",
        (treeItem: vscode.TreeItem) => {
            exportProject(state, treeItem);
        });
    context.subscriptions.push(disposableExportProject);

    const disposableImportProject = vscode.commands.registerCommand(
        "logfocus.importProject",
        () => {
            importProject(state);
        });
    context.subscriptions.push(disposableImportProject);

    const disposableTurnOnFocusMode = vscode.commands.registerCommand(
        "logfocus.turnOnFocusMode",
        () => turnOnFocusMode()
    );
    context.subscriptions.push(disposableTurnOnFocusMode);

    const disposibleAddFilter = vscode.commands.registerCommand(
        "logfocus.addFilter",
        (treeItem: vscode.TreeItem | undefined) => {
            addFilter(treeItem, state);
        }
    );
    context.subscriptions.push(disposibleAddFilter);

    const disposibleEditFilter = vscode.commands.registerCommand(
        "logfocus.editFilter",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in FILTERS');
                return;
            }
            editFilter(treeItem, state);
        }
    );
    context.subscriptions.push(disposibleEditFilter);

    const disposibleDeleteFilter = vscode.commands.registerCommand(
        "logfocus.deleteFilter",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in FILTERS');
                return;
            }
            deleteFilter(treeItem, state);
        }
    );
    context.subscriptions.push(disposibleDeleteFilter);

    const disposibleToggleHighlight = vscode.commands.registerCommand(
        "logfocus.toggleHighlight",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in FILTERS');
                return;
            }
            toggleHighlight(treeItem, state);
        }
    );
    context.subscriptions.push(disposibleToggleHighlight);

    const disposibleAddGroup = vscode.commands.registerCommand(
        "logfocus.addGroup",
        () => addGroup(state)
    );
    context.subscriptions.push(disposibleAddGroup);

    const disposibleEditGroup = vscode.commands.registerCommand(
        "logfocus.editGroup",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in FILTERS');
                return;
            }
            editGroup(treeItem, state);
        }
    );
    context.subscriptions.push(disposibleEditGroup);

    const disposibleDeleteGroup = vscode.commands.registerCommand(
        "logfocus.deleteGroup",
        (treeItem: vscode.TreeItem) => {
            if (treeItem === undefined) {
                vscode.window.showErrorMessage('This command is executed with button in FILTERS');
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
