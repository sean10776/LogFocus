import * as vscode from "vscode";
import { Group } from "./utils";
import { Filter } from "./filter";

//provides filters as tree items to be displayed on the sidebar
export class FilterTreeViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    constructor(private groups: Group[]) { }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    //getChildren(vscode.TreeItem) returns empty list because filters have no children.
    //getChildren() returns the root elements (all the filters)
    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element === undefined) {
            return Promise.resolve(this.groups.map(group => new GroupItem(group)));
        }
        if (element instanceof GroupItem) {
            return Promise.resolve(element.filters.map(filter => new FilterItem(filter)));
        } else {
            return Promise.resolve([]);
        }
    }

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

    refresh(element?: vscode.TreeItem): void {
        this._onDidChangeTreeData.fire(element);
    }

    update(groups: Group[]): void {
        this.groups = groups;
        this.refresh();
    }
}

export class GroupItem extends vscode.TreeItem {
    filters: Filter[] = [];

    constructor(group: Group) {
        super(group.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'g-unlit-invisible';
        this.update(group);
    }

    update(group: Group) {
        this.label = group.name;
        this.id = group.id;
        this.filters = Array.from(group.filters.values());

        if (group.isHighlighted) {
            if (group.isShown) {
                this.contextValue = 'g-lit-visible';
                this.iconPath = new vscode.ThemeIcon("bracket-dot");
            } else {
                this.description = '';
                this.contextValue = 'g-lit-invisible';
                this.iconPath = new vscode.ThemeIcon("bracket-error");
            }
        } else {
            this.description = '';
            if (group.isShown) {
                this.contextValue = 'g-unlit-visible';
                this.iconPath = new vscode.ThemeIcon("bracket");
            } else {
                this.contextValue = 'g-unlit-invisible';
                this.iconPath = undefined;
            }
        }
    }

    //contextValue connects to package.json>menus>view/item/context
    contextValue:
        | 'g-lit-visible'
        | 'g-unlit-visible'
        | 'g-lit-invisible'
        | 'g-unlit-invisible';
}

//represents a filter as one row in the sidebar
export class FilterItem extends vscode.TreeItem {
    constructor(filter: Filter) {
        super(filter.regex.toString(), vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'f-unlit-invisible-include'; // Set a proper initial value
        this.update(filter);
    }

    update(filter: Filter) {
        this.label = filter.regex.toString();
        this.id = filter.id;
        this.iconPath = filter.iconPath;

        // Build contextValue based on filter state
        let contextValue = 'f-';
        contextValue += filter.isHighlighted ? 'lit-' : 'unlit-';
        contextValue += filter.isShown ? 'visible-' : 'invisible-';
        contextValue += filter.isExclude ? 'exclude' : 'include';
        
        this.contextValue = contextValue as any;

        if (filter.isShown) {
            this.description = ` · ${filter.count}`;
        } else {
            this.description = '';
        }
    }

    //contextValue connects to package.json>menus>view/item/context
    contextValue: string;
}
