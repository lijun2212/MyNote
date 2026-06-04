export const APP_MENU_IDS = ["file", "edit", "view", "note", "help"] as const;

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
	"file.importNote",
	"edit.rename",
	"edit.move",
	"edit.copyLink",
	"view.search",
	"view.toggleLeftSidebar",
	"view.toggleRightSidebar",
	"view.editorOnly",
	"view.split",
	"note.rename",
	"note.move",
	"note.copyLink",
	"note.copyWikiLink",
	"help.shortcuts",
	"help.about",
	"notebook.createNote",
	"notebook.rename",
	"notebook.reorder",
	"notebook.delete",
	"note.open",
	"tag.delete",
	"selection.insertLink",
	"selection.insertTag",
	"selection.createWikiLink",
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
	"relationBlank.create",
	"relationBlank.refresh",
	"relationItem.openTarget",
	"relationItem.delete",
] as const;

export const MENU_PLACEHOLDER_IDS = ["view.graph", "view.revisions", "note.relations", "tag.open", "tag.rename", "selection.relation", "blank.newNote", "blank.paste"] as const;

export type AppMenuId = (typeof APP_MENU_IDS)[number];
export type ContextMenuTargetType = (typeof CONTEXT_MENU_TARGET_TYPES)[number];
export type MenuActionId = (typeof MENU_ACTION_IDS)[number];
export type MenuPlaceholderId = (typeof MENU_PLACEHOLDER_IDS)[number];
export type MenuLeafId = MenuActionId | MenuPlaceholderId;
export type MenuSchemaId = AppMenuId | MenuLeafId;