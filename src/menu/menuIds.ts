export const APP_MENU_IDS = ["mynote", "edit", "view", "help"] as const;

export const CONTEXT_MENU_TARGET_TYPES = [
	"notebook",
	"note",
	"tag",
	"fileTreeBlank",
	"editorSelection",
	"editorBlank",
	"tagBlank",
	"tagContextItem",
	"previewBlank",
	"previewLink",
	"linksBlank",
	"linkItem",
	"relationBlank",
	"relationItem",
] as const;

export const MENU_ACTION_IDS = [
	"file.newNote",
	"file.newNotebook",
	"kb.open",
	"kb.close",
	"file.importNote",
	"file.refreshTree",
	"edit.rename",
	"edit.move",
	"edit.copyLink",
	"edit.paste",
	"edit.undo",
	"edit.redo",
	"view.search",
	"view.toggleLeftSidebar",
	"view.toggleRightSidebar",
	"view.editorOnly",
	"view.split",
	"view.openProjection",
	"view.closeProjection",
	"view.projectionFollowScroll",
	"ai.settings",
	"ai.toggleAutoSummaryAgent",
	"note.rename",
	"note.move",
	"note.copyLink",
	"note.copyWikiLink",
	"note.delete",
	"help.shortcuts",
	"help.manual",
	"help.checkForUpdates",
	"help.about",
	"notebook.createNote",
	"notebook.rename",
	"notebook.reorder",
	"notebook.delete",
	"note.open",
	"tag.delete",
	"selection.insertLink",
	"selection.paste",
	"selection.insertImage",
	"selection.insertTag",
	"selection.createWikiLink",
	"blank.insertLink",
	"blank.paste",
	"blank.insertImage",
	"blank.createWikiLink",
	"blank.refreshIndex",
	"blank.showSidebar",
	"tagBlank.refresh",
	"tagBlank.clearFilter",
	"tagContextItem.openNote",
	"tagContextItem.locate",
	"previewBlank.returnToEditor",
	"previewBlank.showSidebar",
	"previewLink.open",
	"previewLink.copy",
	"previewLink.openTargetNote",
	"linksBlank.refresh",
	"linksBlank.showSidebar",
	"linkItem.open",
	"linkItem.openTargetNote",
	"linkItem.copy",
	"relationBlank.create",
	"relationBlank.refresh",
	"relationBlank.showSidebar",
	"relationItem.openTarget",
	"relationItem.delete",
] as const;

export const MENU_SUBMENU_IDS = ["mynote.ai"] as const;

export const MENU_SEPARATOR_IDS = ["mynote.separator"] as const;

export const MENU_PLACEHOLDER_IDS = ["view.graph", "view.revisions", "note.relations", "tag.open", "tag.rename", "selection.relation", "blank.newNote"] as const;

export type AppMenuId = (typeof APP_MENU_IDS)[number];
export type ContextMenuTargetType = (typeof CONTEXT_MENU_TARGET_TYPES)[number];
export type MenuActionId = (typeof MENU_ACTION_IDS)[number];
export type MenuPlaceholderId = (typeof MENU_PLACEHOLDER_IDS)[number];
export type MenuSubmenuId = (typeof MENU_SUBMENU_IDS)[number];
export type MenuSeparatorId = (typeof MENU_SEPARATOR_IDS)[number];
export type MenuLeafId = MenuActionId | MenuPlaceholderId;
export type MenuSchemaId = AppMenuId | MenuLeafId | MenuSubmenuId | MenuSeparatorId;