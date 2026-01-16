import * as vscode from "vscode";
import { Project, Group, getSortedFiltersInGroup } from "./utils";
import { Filter, FocusAction } from "./filter";

/**
 * Drag and drop data transfer format
 */
interface FilterDragData {
    filterId: string;
    groupId?: string;
}

//provides filters as tree items to be displayed on the sidebar
export class FilterTreeViewProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
    constructor(public project: Project | null = null) { }

    public onDataChange?: () => void;

    dropMimeTypes = ['application/json'];
    dragMimeTypes = ['application/json'];

    async handleDrag(source: readonly vscode.TreeItem[], dataTransfer: vscode.DataTransfer): Promise<void> {
        const dragData: FilterDragData[] = [];
        
        for (const item of source) {
            if (item instanceof FilterItem) {
                dragData.push({
                    filterId: item.id!,
                    groupId: item.groupId
                });
            }
        }

        if (dragData.length > 0) {
            dataTransfer.set('application/json', new vscode.DataTransferItem(JSON.stringify(dragData)));
        }
    }

    async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        if (!this.project) return;

        const jsonData = dataTransfer.get('application/json');
        if (!jsonData) return;

        try {
            const dragDataStr = await jsonData.asString();
            const dragData: FilterDragData[] = JSON.parse(dragDataStr);

            // Target can be either a GroupItem or a FilterItem or undefined (root)
            let targetGroupId: string | undefined = undefined;
            let targetFilterId = '';

            if (target instanceof GroupItem) {
                targetGroupId = target.id!;
            } else if (target instanceof FilterItem) {
                targetGroupId = target.groupId;
                targetFilterId = target.id!;
            }

            // 1. Move filters to their new group (if changed)
            for (const data of dragData) {
                const filter = this.project.filters.get(data.filterId);
                if (!filter) continue;

                if (filter.groupId !== targetGroupId) {
                    // Remove from old group
                    if (filter.groupId) {
                        const oldGroup = this.project.groups.get(filter.groupId);
                        oldGroup?.filters.delete(filter.id);
                    }
                    
                    // Add to new group
                    filter.groupId = targetGroupId;
                    if (targetGroupId) {
                        const newGroup = this.project.groups.get(targetGroupId);
                        newGroup?.filters.set(filter.id, filter);
                    }
                }
            }

            // 2. Re-calculate priorities for EVERYTHING at the target level to ensure order
            // This is safer than just incrementing one priority.
            if (targetGroupId) {
                // Moving within a group
                const group = this.project.groups.get(targetGroupId);
                if (group) {
                    const sortedFilters = Array.from(group.filters.values())
                        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
                    
                    // Remove dragged filters from list
                    const remaining = sortedFilters.filter(f => !dragData.some(d => d.filterId === f.id));
                    
                    // Find target index
                    let insertIdx = remaining.findIndex(f => f.id === targetFilterId);
                    if (insertIdx === -1) insertIdx = 0; // Drop on group itself -> top

                    // Insert dragged filters
                    const draggedFilters = dragData.map(d => this.project!.filters.get(d.filterId)!).filter(Boolean);
                    remaining.splice(insertIdx, 0, ...draggedFilters);

                    // Re-assign priorities (descending)
                    remaining.forEach((f, i) => {
                        f.priority = (remaining.length - i) * 10;
                    });
                }
            } else {
                // Moving at root level (can be Filters or Groups)
                const rootFilters = Array.from(this.project.filters.values()).filter(f => !f.groupId);
                const rootGroups = Array.from(this.project.groups.values());
                
                type Sortable = { id: string; priority: number; type: 'filter' | 'group' };
                let items: Sortable[] = [
                    ...rootFilters.map(f => ({ id: f.id, priority: f.priority ?? 0, type: 'filter' as const })),
                    ...rootGroups.map(g => ({ id: g.id, priority: g.priority ?? 0, type: 'group' as const }))
                ];

                items.sort((a, b) => b.priority - a.priority);

                // Remove dragged filters
                const draggedIds = new Set(dragData.map(d => d.filterId));
                items = items.filter(item => !draggedIds.has(item.id));

                // Find target index
                let insertIdx = items.findIndex(item => item.id === targetFilterId || item.id === targetGroupId);
                if (insertIdx === -1) insertIdx = 0;

                // Insert dragged
                const draggedItems: Sortable[] = dragData.map(d => ({
                    id: d.filterId,
                    priority: 0,
                    type: 'filter' as const
                }));
                items.splice(insertIdx, 0, ...draggedItems);

                // Re-assign
                items.forEach((item, i) => {
                    const priority = (items.length - i) * 10;
                    if (item.type === 'filter') {
                        const f = this.project!.filters.get(item.id);
                        if (f) f.priority = priority;
                    } else {
                        const g = this.project!.groups.get(item.id);
                        if (g) g.priority = priority;
                    }
                });
            }

            this.refresh();
            if (this.onDataChange) {
                this.onDataChange();
            }
        } catch (e) {
            console.error('Failed to handle drop:', e);
        }
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (!this.project) return Promise.resolve([]);

        if (element === undefined) {
            // Root elements: Groups and Top-level Filters
            const groups = Array.from(this.project.groups.values());
            const topLevelFilters = Array.from(this.project.filters.values())
                .filter(f => !f.groupId);

            const items: (GroupItem | FilterItem)[] = [
                ...groups.map(g => new GroupItem(g)),
                ...topLevelFilters.map(f => new FilterItem(f))
            ];

            // Sort by priority (descending)
            items.sort((a, b) => {
                const pA = a instanceof GroupItem ? a.group.priority : (this.project?.filters.get(a.id!)?.priority ?? 0);
                const pB = b instanceof GroupItem ? b.group.priority : (this.project?.filters.get(b.id!)?.priority ?? 0);
                return pB - pA;
            });

            return Promise.resolve(items);
        }
        
        if (element instanceof GroupItem) {
            const sortedFilters = getSortedFiltersInGroup(element.group);
            return Promise.resolve(sortedFilters.map(filter => new FilterItem(filter, element.id!)));
        }
        
        return Promise.resolve([]);
    }

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

    refresh(element?: vscode.TreeItem): void {
        this._onDidChangeTreeData.fire(element);
    }

    update(project: Project): void {
        this.project = project;
        this.refresh();
    }
}

export class GroupItem extends vscode.TreeItem {
    filters: Filter[] = [];
    group: Group;

    constructor(group: Group) {
        super(group.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.group = group;
        this.contextValue = 'g-unlit-invisible';
        this.update(group);
    }

    update(group: Group) {
        this.label = group.name;
        this.id = group.id;
        this.group = group;
        this.filters = Array.from(group.filters.values());

        let contextValue = 'g-';
        contextValue += group.isHighlighted ? 'lit-' : 'unlit-';
        
        switch (group.focusAction) {
            case FocusAction.INCLUDED: contextValue += 'included'; break;
            case FocusAction.EXCLUDED: contextValue += 'excluded'; break;
            case FocusAction.NONE: contextValue += 'none'; break;
        }
        
        this.contextValue = contextValue as any;
        
        // Use icons to represent focus action
        // (Reusing the same logic or similar to generateSvgIcon if we wanted, 
        // but for now let's just use ThemeIcons)
        if (group.focusAction === FocusAction.INCLUDED) {
            this.iconPath = new vscode.ThemeIcon("bracket-dot");
        } else if (group.focusAction === FocusAction.EXCLUDED) {
            this.iconPath = new vscode.ThemeIcon("bracket-error");
        } else {
            this.iconPath = new vscode.ThemeIcon("bracket");
        }
    }

    //contextValue connects to package.json>menus>view/item/context
    contextValue: string;
}

//represents a filter as one row in the sidebar
export class FilterItem extends vscode.TreeItem {
    groupId?: string;

    constructor(filter: Filter, groupId?: string) {
        super(filter.regex.toString(), vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'f-unlit-invisible-include'; 
        this.groupId = groupId || filter.groupId;
        this.command = {
            command: 'logfocus.editFilter',
            title: 'Edit Filter',
            arguments: [this]
        };
        this.update(filter);
    }

    update(filter: Filter) {
        this.label = filter.regex.toString();
        this.id = filter.id;
        this.iconPath = filter.iconPath;

        // Build contextValue based on filter state
        let contextValue = 'f-';
        contextValue += filter.isHighlighted ? 'lit-' : 'unlit-';
        
        switch (filter.focusAction) {
            case FocusAction.INCLUDED: contextValue += 'included'; break;
            case FocusAction.EXCLUDED: contextValue += 'excluded'; break;
            case FocusAction.NONE: contextValue += 'none'; break;
        }
        
        this.contextValue = contextValue as any;

        const count = filter.count;
        if (count > 0) {
            this.description = ` · ${count}`;
        } else {
            this.description = '';
        }
    }

    //contextValue connects to package.json>menus>view/item/context
    contextValue: string;
}
