import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as crypto from "crypto";
import { Project, createGroup, createProject } from "./utils";
import { Filter, FilterMode, FocusAction } from "./filter";

function migrateFocusAction(f: any): FocusAction {
    if (f.focusAction !== undefined) {
        return f.focusAction;
    }
    // Migration logic
    if (f.isExclude === true) {
        return FocusAction.EXCLUDED;
    }
    if (f.isShown === false) {
        return FocusAction.NONE;
    }
    return FocusAction.INCLUDED;
}

// Get all possible project storage directories: global and workspaces
function getProjectStorageDirs(storageUri: vscode.Uri): string[] {
    const dirs: string[] = [];
    const storagePath = storageUri.fsPath || (storageUri as any).path || storageUri.toString();
    
    // 1. Global storage projects directory
    dirs.push(path.join(storagePath, "projects"));
    
    // 2. Workspace projects directories: .logfocus/projects
    if (vscode.workspace.workspaceFolders) {
        vscode.workspace.workspaceFolders.forEach(folder => {
            dirs.push(path.join(folder.uri.fsPath, ".logfocus", "projects"));
        });
    }
    
    return dirs;
}

// Get the specific project file path for saving
export function getSaveProjectFilePath(storageUri: vscode.Uri, fileName: string, projectName: string): string {
    const storagePath = storageUri.fsPath || (storageUri as any).path || storageUri.toString();

    // DEFAULT project is always saved in global storage
    if (projectName === "DEFAULT" || !vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        const globalDir = path.join(storagePath, "projects");
        if (!fs.existsSync(globalDir)) {
            fs.mkdirSync(globalDir, { recursive: true });
        }
        return path.join(globalDir, fileName);
    }
    
    // Other projects are saved in the first workspace folder
    const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
    const workspaceRoot = workspaceUri.fsPath || (workspaceUri as any).path || workspaceUri.toString();
    const projectDir = path.join(workspaceRoot, ".logfocus", "projects");
    
    if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
    }
    
    return path.join(projectDir, fileName);
}

// Extension configuration file (contains project list and other settings)
function getExtensionConfigFile(storageUri: vscode.Uri): string {
    const storagePath: string = storageUri.fsPath || (storageUri as any).path || storageUri.toString();

    // Create the directory if it does not exist
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }

    return path.join(storagePath, "logfocus_settings.json");
}

// Extension configuration management
export interface ExtensionConfig {
    version: string;
    selectedProjectName?: string;
}
function getExtensionConfig(storageUri: vscode.Uri): ExtensionConfig {
    const configFile = getExtensionConfigFile(storageUri);
    
    if (fs.existsSync(configFile)) {
        try {
            const text = fs.readFileSync(configFile, "utf8");
            const config = JSON.parse(text);
            return {
                version: config.version || "1.0.0",
                selectedProjectName: config.selectedProjectName
            };
        } catch (e) {
            console.error("Failed to read extension config:", e);
        }
    }
    
    // Return default config
    return {
        version: "1.0.0"
    };
}

function saveExtensionConfig(storageUri: vscode.Uri, config: ExtensionConfig) {
    const configFile = getExtensionConfigFile(storageUri);
    
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(configFile, content, "utf8");
}

export function openSettings(storageUri: vscode.Uri) {
    const configFile = getExtensionConfigFile(storageUri);

    vscode.workspace.openTextDocument(configFile).then((doc) => {
        vscode.window.showTextDocument(doc);
    });
}

// Get the specific project file path (searches all locations)
export function getProjectFilePath(storageUri: vscode.Uri, fileName: string): string {
    const dirs = getProjectStorageDirs(storageUri);
    for (const dir of dirs) {
        const fullPath = path.join(dir, fileName);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }
    // Fallback to global if not found anywhere else
    const storagePath = storageUri.fsPath || (storageUri as any).path || storageUri.toString();
    return path.join(storagePath, "projects", fileName);
}

export function projectFileName(project: Project): string {
    return `${project.name}.json`;
}

// Save individual project to its own file
export function saveProject(storageUri: vscode.Uri, project: Project) {
    const projectFile = getSaveProjectFilePath(storageUri, projectFileName(project), project.name);

    const content = JSON.stringify(
        {
            name: project.name,
            groups: Array.from(project.groups.values()).map((group) => ({
                id: group.id,
                name: group.name,
                priority: group.priority,
                isHighlighted: group.isHighlighted,
                focusAction: group.focusAction
            })),
            filters: Array.from(project.filters.values()).map((filter) => ({
                id: filter.id,
                regex: filter.regex.source,
                color: filter.color,
                priority: filter.priority,
                focusAction: filter.focusAction,
                mode: filter.mode,
                textPattern: filter.textPattern,
                groupId: filter.groupId,
                isHighlighted: filter.isHighlighted
            })),
        },
        null,
        4
    );

    fs.writeFileSync(projectFile, content, "utf8");
}

// Load individual project from its file
export function loadProject(projectFile: string): Project | null {
    let filePath = projectFile;
    // Handle URI strings if they are passed
    if (filePath.startsWith('file://')) {
        try {
            filePath = vscode.Uri.parse(filePath).fsPath;
        } catch (e) {
            console.error(`Failed to parse URI from ${projectFile}:`, e);
        }
    }

    if (!fs.existsSync(filePath)) {
        console.warn(`Project file not found: ${filePath}`);
        return null;
    }
    
    try {
        const text = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(text);

        const project: Project = createProject(parsed.name);

        // Legacy support and new structure support
        if (parsed.groups && !parsed.filters) {
            // Old format: filters nested in groups
            parsed.groups.forEach((g: any) => {
                const group = createGroup(g.name as string);
                group.priority = g.priority ?? 100;
                
                g.filters.forEach((f: any) => {
                    const filter = new Filter(
                        new RegExp(f.regex), 
                        f.color as string,
                        f.priority ?? 50
                    );
                    filter.focusAction = migrateFocusAction(f);
                    filter.mode = f.mode ?? FilterMode.REGEX;
                    filter.textPattern = f.textPattern ?? "";
                    filter.groupId = group.id;
                    group.filters.set(filter.id, filter);
                    project.filters.set(filter.id, filter);
                });
                project.groups.set(group.id, group);
            });
        } else {
            // New format: groups and filters side-by-side or mixed
            if (parsed.groups) {
                parsed.groups.forEach((g: any) => {
                    const group = createGroup(g.name as string);
                    group.id = g.id || group.id;
                    group.priority = g.priority ?? 100;
                    group.isHighlighted = g.isHighlighted ?? true;
                    group.focusAction = migrateFocusAction(g);
                    project.groups.set(group.id, group);
                });
            }

            if (parsed.filters) {
                parsed.filters.forEach((f: any) => {
                    const filter = new Filter(
                        new RegExp(f.regex), 
                        f.color as string,
                        f.priority ?? 50
                    );
                    filter.focusAction = migrateFocusAction(f);
                    filter.mode = f.mode ?? FilterMode.REGEX;
                    filter.textPattern = f.textPattern ?? "";
                    filter.groupId = f.groupId;
                    filter.isHighlighted = f.isHighlighted ?? true;
                    
                    project.filters.set(filter.id, filter);
                    
                    if (filter.groupId && project.groups.has(filter.groupId)) {
                        project.groups.get(filter.groupId)!.filters.set(filter.id, filter);
                    }
                });
            }
        }

        return project;
    } catch (e) {
        console.error(`Failed to load project from ${projectFile}:`, e);
        vscode.window.showErrorMessage(`Failed to load project from ${projectFile}`);
        return null;
    }
}

// Map to track project hashes for change detection
let projectHashes: Map<string, string> = new Map();

// Delete individual project file
export function deleteProjectFile(storageUri: vscode.Uri, project: Project) {
    const isDefault = project.name === "DEFAULT";
    const projectFile = getSaveProjectFilePath(storageUri, projectFileName(project), project.name);
    if (fs.existsSync(projectFile)) {
        fs.unlinkSync(projectFile);
    }
    projectHashes.delete(project.name);
}

// Map hash to track project changes
function computeProjectHash(project: Project): string {
    const projectString = JSON.stringify(project, (key, value) => {
        if (value instanceof Map) {
            return Array.from(value.entries());
        }
        return value;
    });
    const hash = crypto.createHash("sha256");
    hash.update(projectString);
    return hash.digest("hex");
}

// Updated readSettings to load all projects from discovered directories
export function readSettings(storageUri: vscode.Uri): {projects: Map<string, Project>, selectedProject: Project | null} {
    const projects: Map<string, Project> = new Map();
    let selectedProject: Project | null = null;

    // Read extension config for selected project
    const config = getExtensionConfig(storageUri);
    
    // Discover and load projects from all storage locations
    const storageDirs = getProjectStorageDirs(storageUri);
    const discoveredFiles: string[] = [];

    storageDirs.forEach(dir => {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
            files.forEach(file => {
                const fullPath = path.join(dir, file);
                const project = loadProject(fullPath);
                if (project) {
                    // Avoid duplicates (later discovered ones overwrite or are ignored)
                    if (!projects.has(project.name)) {
                        projects.set(project.name, project);
                        
                        if (config.selectedProjectName === project.name) {
                            selectedProject = project;
                        }

                        // Compute and store initial hash
                        const hash = computeProjectHash(project);
                        projectHashes.set(project.name, hash);
                    }
                }
            });
        }
    });

    if (projects.size === 0) {
        // Create default project if none found
        const defaultProject = createProject("DEFAULT");
        projects.set("DEFAULT", defaultProject);
        saveProject(storageUri, defaultProject);
    }

    if (!selectedProject) {
        selectedProject = projects.get("DEFAULT") || projects.values().next().value || null;
    }

    if (selectedProject) {
        selectedProject.selected = true;
        config.selectedProjectName = selectedProject.name;
        saveExtensionConfig(storageUri, config);
    }

    return {
        projects,
        selectedProject
    };
}

// Updated saveSettings to save projects as individual files and update config
export function saveSettings(storageUri: vscode.Uri, projects: Map<string, Project>, selectedProject: Project | null) {
    // Save each project to its own file
    projects.forEach((project, projectName) => {
        const currentHash = computeProjectHash(project);
        const previousHash = projectHashes.get(projectName);

        if (currentHash !== previousHash) {
            // Project has changed, save it
            saveProject(storageUri, project);
            projectHashes.set(projectName, currentHash);
        }
    });

    const config = getExtensionConfig(storageUri);
    const selectedProjectName = selectedProject ? selectedProject.name : undefined;
    if (config.selectedProjectName !== selectedProjectName) {
        config.selectedProjectName = selectedProjectName;
        saveExtensionConfig(storageUri, config);
    }
}