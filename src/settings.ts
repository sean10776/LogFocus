import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as crypto from "crypto";
import { Project, createGroup, createProject } from "./utils";
import { Filter } from "./filter";

// Extension configuration file (contains project list and other settings)
function getExtensionConfigFile(storageUri: vscode.Uri): string {
    const storagePath: string = storageUri.fsPath;

    // Create the directory if it does not exist
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }

    return path.join(storagePath, "logfocus_settings.json");
}

// Extension configuration management
export interface ExtensionConfig {
    projectFileNames: string[]; // List of project file names as <name>.json
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
                projectFileNames: config.projectFileNames || [],
                version: config.version || "1.0.0",
                selectedProjectName: config.selectedProjectName
            };
        } catch (e) {
            console.error("Failed to read extension config:", e);
        }
    }
    
    // Return default config
    return {
        projectFileNames: [],
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

function projectFileName(project: Project): string {
    return `${project.name}.json`;
}

function getProjectFilePath(storageUri: vscode.Uri, projectFileName: string): string {
    const storagePath: string = storageUri.fsPath;
    const projectsDir = path.join(storagePath, "projects");
    // Ensure the projects directory exists
    if (!fs.existsSync(projectsDir)) {
        fs.mkdirSync(projectsDir, { recursive: true });
    }
    return path.join(projectsDir, projectFileName);
}

// Save individual project to its own file
export function saveProject(storageUri: vscode.Uri, project: Project) {
    const projectFile = getProjectFilePath(storageUri, projectFileName(project));

    const content = JSON.stringify(
        {
            name: project.name,
            groups: Array.from(project.groups.values()).map((group) => ({
                name: group.name,
                isHighlighted: group.isHighlighted,
                isShown: group.isShown, 
                filters: Array.from(group.filters.values()).map((filter) => ({
                    regex: filter.regex.source,
                    color: filter.color,
                    isHighlighted: filter.isHighlighted,
                    isShown: filter.isShown,
                    isExclude: filter.isExclude,
                })),
            })),
        },
        null,
        4
    );

    fs.writeFileSync(projectFile, content, "utf8");
}

// Load individual project from its file
export function loadProject(storageUri: vscode.Uri, projectFileName: string): Project | null {
    const projectFile = getProjectFilePath(storageUri, projectFileName);
    if (!fs.existsSync(projectFile)) {
        console.warn(`Project file not found: ${projectFile}`);
        return null;
    }
    
    try {
        const text = fs.readFileSync(projectFile, "utf8");
        const parsed = JSON.parse(text);

        const project:Project = createProject(parsed.name);

        parsed.groups.forEach((g: any) => {
            const group = createGroup(g.name as string);            
            g.filters.forEach((f: any) => {
                const filter = new Filter(new RegExp(f.regex), f.color as string);
                group.filters.set(filter.id, filter);
                project.filters.set(filter.id, filter);
            });
            project.groups.set(group.id, group);
        });

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
    const projectFile = getProjectFilePath(storageUri, projectFileName(project));
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

// Updated readSettings to load all projects from individual files
export function readSettings(storageUri: vscode.Uri): {projects: Map<string, Project>, selectedProject: Project | null} {
    const projects: Map<string, Project> = new Map();
    let selectedProject: Project | null = null;

    // Read extension config to get project list
    const config = getExtensionConfig(storageUri);
    let emptyProjectsCount = 0;
    // Load each project from its individual file
    config.projectFileNames.forEach(projectFileName => {
        const project = loadProject(storageUri, projectFileName);
        if (project) {
            if (config.selectedProjectName === projectFileName) {
                selectedProject = project;
            }
            projects.set(project.name, project);
            // Compute and store initial hash
            const hash = computeProjectHash(project);
            projectHashes.set(project.name, hash);
        } else {
            emptyProjectsCount++;
        }
    });

    if (emptyProjectsCount > 0) {
        // clean up config or notify user as needed
        saveSettings(storageUri, projects, selectedProject);
    }

    if (!selectedProject) {
        selectedProject = projects.values().next().value || null;
    }

    if (selectedProject) {
        selectedProject.selected = true;
        config.selectedProjectName = projectFileName(selectedProject);
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

    // Update extension config with project list if changed
    const config = getExtensionConfig(storageUri);
    const projectsArray = Array.from(projects.values());

    // check if projectFileNames need to be updated
    const projectFileNames = projectsArray.map(p => projectFileName(p));
    if (JSON.stringify(config.projectFileNames) !== JSON.stringify(projectFileNames)) {
        config.projectFileNames = projectFileNames;
        if (projectFileNames.length < config.projectFileNames.length) {
            // Some projects were removed, clean up hashes, and delete file
            const oldProjectFileNames = config.projectFileNames.filter(name => !projectFileNames.includes(name));
            oldProjectFileNames.forEach(fName => {
                const file = getProjectFilePath(storageUri, fName);
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            });
        }
    }

    const selectedProjectName = selectedProject ? projectFileName(selectedProject) : undefined;
    if (config.selectedProjectName !== selectedProjectName) {
        config.selectedProjectName = selectedProjectName;
    }
    saveExtensionConfig(storageUri, config);
}