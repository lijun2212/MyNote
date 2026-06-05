import type {
  ContextMenuPayload,
  EditorBlankContextMenuPayload,
  EditorSelectionContextMenuPayload,
  NoteContextMenuPayload,
  NotebookContextMenuPayload,
  LinkItemContextMenuPayload,
  PreviewBlankContextMenuPayload,
  PreviewLinkContextMenuPayload,
  RelationBlankContextMenuPayload,
  RelationItemContextMenuPayload,
  TagBlankContextMenuPayload,
  TagContextItemContextMenuPayload,
  TagContextMenuPayload,
  LinksBlankContextMenuPayload,
} from "../components/ContextMenu/contextMenuTypes";
import type { EditorMode } from "../store/useEditorStore";
import type { MenuActionId } from "./menuIds";

type MaybePromise = Promise<void> | void;

export interface MenuActionRunnerHandlers {
  createNote?: () => MaybePromise;
  createNotebook?: () => MaybePromise;
  importNote?: () => MaybePromise;
  openSearch?: () => MaybePromise;
  toggleLeftSidebar?: () => MaybePromise;
  toggleRightSidebar?: () => MaybePromise;
  setEditorMode?: (mode: EditorMode) => MaybePromise;
  openCurrentNote?: (payload: NoteContextMenuPayload) => MaybePromise;
  moveCurrentNote?: (payload: NoteContextMenuPayload) => MaybePromise;
  renameCurrentNote?: (payload: NoteContextMenuPayload) => MaybePromise;
  copyCurrentNoteLink?: (payload: NoteContextMenuPayload) => MaybePromise;
  copyCurrentNoteWikiLink?: (payload: NoteContextMenuPayload) => MaybePromise;
  createNoteInNotebook?: (payload: NotebookContextMenuPayload) => MaybePromise;
  renameNotebook?: (payload: NotebookContextMenuPayload) => MaybePromise;
  reorderNotebook?: (payload: NotebookContextMenuPayload) => MaybePromise;
  deleteNotebook?: (payload: NotebookContextMenuPayload) => MaybePromise;
  deleteTag?: (payload: TagContextMenuPayload) => MaybePromise;
  insertLinkFromSelection?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
  insertTagFromSelection?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
  createWikiLinkFromSelection?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
  insertLinkFromBlank?: (payload: EditorBlankContextMenuPayload) => MaybePromise;
  createWikiLinkFromBlank?: (payload: EditorBlankContextMenuPayload) => MaybePromise;
  refreshIndex?: (payload: EditorBlankContextMenuPayload) => MaybePromise;
  showLeftSidebar?: (payload: EditorBlankContextMenuPayload) => MaybePromise;
  refreshTagFilter?: (payload: TagBlankContextMenuPayload) => MaybePromise;
  clearSelectedTags?: (payload: TagBlankContextMenuPayload) => MaybePromise;
  openTagContextItemNote?: (payload: TagContextItemContextMenuPayload) => MaybePromise;
  locateTagContextItem?: (payload: TagContextItemContextMenuPayload) => MaybePromise;
  returnToEditor?: (payload: PreviewBlankContextMenuPayload) => MaybePromise;
  showPreviewSidebar?: (payload: PreviewBlankContextMenuPayload) => MaybePromise;
  openPreviewLink?: (payload: PreviewLinkContextMenuPayload) => MaybePromise;
  copyPreviewLink?: (payload: PreviewLinkContextMenuPayload) => MaybePromise;
  openPreviewTargetNote?: (payload: PreviewLinkContextMenuPayload) => MaybePromise;
  refreshLinks?: (payload: LinksBlankContextMenuPayload) => MaybePromise;
  showLinksSidebar?: (payload: LinksBlankContextMenuPayload) => MaybePromise;
  openLinkItem?: (payload: LinkItemContextMenuPayload) => MaybePromise;
  openLinkTargetNote?: (payload: LinkItemContextMenuPayload) => MaybePromise;
  copyLinkItem?: (payload: LinkItemContextMenuPayload) => MaybePromise;
  createRelation?: (payload: RelationBlankContextMenuPayload) => MaybePromise;
  refreshRelations?: (payload: RelationBlankContextMenuPayload) => MaybePromise;
  showRelationSidebar?: (payload: RelationBlankContextMenuPayload) => MaybePromise;
  openRelationTarget?: (payload: RelationItemContextMenuPayload) => MaybePromise;
  deleteRelation?: (payload: RelationItemContextMenuPayload) => MaybePromise;
  openShortcuts?: () => MaybePromise;
  openAbout?: () => MaybePromise;
}

type MenuActionHandlerKey = keyof MenuActionRunnerHandlers;

function assertNotePayload(payload: ContextMenuPayload | undefined): NoteContextMenuPayload {
  if (!payload || payload.type !== "note") {
    throw new Error("This menu action requires a note context payload.");
  }
  return payload;
}

function assertNotebookPayload(payload: ContextMenuPayload | undefined): NotebookContextMenuPayload {
  if (!payload || payload.type !== "notebook") {
    throw new Error("This menu action requires a notebook context payload.");
  }
  return payload;
}

function assertTagPayload(payload: ContextMenuPayload | undefined): TagContextMenuPayload {
  if (!payload || payload.type !== "tag") {
    throw new Error("This menu action requires a tag context payload.");
  }
  return payload;
}

function assertEditorSelectionPayload(payload: ContextMenuPayload | undefined): EditorSelectionContextMenuPayload {
  if (!payload || payload.type !== "editorSelection") {
    throw new Error("This menu action requires an editor selection context payload.");
  }
  return payload;
}

function assertEditorBlankPayload(payload: ContextMenuPayload | undefined): EditorBlankContextMenuPayload {
  if (!payload || payload.type !== "editorBlank") {
    throw new Error("This menu action requires an editor blank context payload.");
  }
  return payload;
}

function assertTagBlankPayload(payload: ContextMenuPayload | undefined): TagBlankContextMenuPayload {
  if (!payload || payload.type !== "tagBlank") {
    throw new Error("This menu action requires a tag blank context payload.");
  }
  return payload;
}

function assertPreviewBlankPayload(payload: ContextMenuPayload | undefined): PreviewBlankContextMenuPayload {
  if (!payload || payload.type !== "previewBlank") {
    throw new Error("This menu action requires a preview blank context payload.");
  }
  return payload;
}

function assertTagContextItemPayload(payload: ContextMenuPayload | undefined): TagContextItemContextMenuPayload {
  if (!payload || payload.type !== "tagContextItem") {
    throw new Error("This menu action requires a tag context item payload.");
  }
  return payload;
}

function assertPreviewLinkPayload(payload: ContextMenuPayload | undefined): PreviewLinkContextMenuPayload {
  if (!payload || payload.type !== "previewLink") {
    throw new Error("This menu action requires a preview link context payload.");
  }
  return payload;
}

function assertPreviewTargetNotePayload(payload: ContextMenuPayload | undefined): PreviewLinkContextMenuPayload {
  const previewLinkPayload = assertPreviewLinkPayload(payload);

  if (previewLinkPayload.linkType === "external" || !previewLinkPayload.notePath) {
    throw new Error("This menu action requires a preview link payload with a target note path.");
  }

  return previewLinkPayload;
}

function assertLinksBlankPayload(payload: ContextMenuPayload | undefined): LinksBlankContextMenuPayload {
  if (!payload || payload.type !== "linksBlank") {
    throw new Error("This menu action requires a links blank context payload.");
  }
  return payload;
}

function assertRelationBlankPayload(payload: ContextMenuPayload | undefined): RelationBlankContextMenuPayload {
  if (!payload || payload.type !== "relationBlank") {
    throw new Error("This menu action requires a relation blank context payload.");
  }
  return payload;
}

function assertLinkItemPayload(payload: ContextMenuPayload | undefined): LinkItemContextMenuPayload {
  if (!payload || payload.type !== "linkItem") {
    throw new Error("This menu action requires a link item context payload.");
  }
  return payload;
}

function assertLinkTargetPayload(payload: ContextMenuPayload | undefined): LinkItemContextMenuPayload {
  const linkItemPayload = assertLinkItemPayload(payload);

  if (linkItemPayload.linkType === "external" || !linkItemPayload.notePath) {
    throw new Error("This menu action requires a link item payload with a target note path.");
  }

  return linkItemPayload;
}

function assertRelationItemPayload(payload: ContextMenuPayload | undefined): RelationItemContextMenuPayload {
  if (!payload || payload.type !== "relationItem") {
    throw new Error("This menu action requires a relation item context payload.");
  }
  return payload;
}

function assertRelationTargetPayload(payload: ContextMenuPayload | undefined): RelationItemContextMenuPayload {
  const relationItemPayload = assertRelationItemPayload(payload);

  if (!relationItemPayload.notePath) {
    throw new Error("This menu action requires a relation item payload with a target note path.");
  }

  return relationItemPayload;
}

function requireHandler<K extends MenuActionHandlerKey>(
  handlers: MenuActionRunnerHandlers,
  actionId: MenuActionId,
  handlerKey: K,
): NonNullable<MenuActionRunnerHandlers[K]> {
  const handler = handlers[handlerKey];

  if (typeof handler !== "function") {
    throw new Error(`Menu action ${actionId} is not configured.`);
  }

  return handler;
}

export function createMenuActionRunner(handlers: MenuActionRunnerHandlers) {
  const actionExecutors: Record<MenuActionId, (payload?: ContextMenuPayload) => MaybePromise> = {
    "file.newNote": () => requireHandler(handlers, "file.newNote", "createNote")(),
    "file.newNotebook": () => requireHandler(handlers, "file.newNotebook", "createNotebook")(),
    "file.importNote": () => requireHandler(handlers, "file.importNote", "importNote")(),
    "edit.rename": (payload) => requireHandler(handlers, "edit.rename", "renameCurrentNote")(assertNotePayload(payload)),
    "edit.move": (payload) => requireHandler(handlers, "edit.move", "moveCurrentNote")(assertNotePayload(payload)),
    "edit.copyLink": (payload) => requireHandler(handlers, "edit.copyLink", "copyCurrentNoteLink")(assertNotePayload(payload)),
    "view.search": () => requireHandler(handlers, "view.search", "openSearch")(),
    "view.toggleLeftSidebar": () => requireHandler(handlers, "view.toggleLeftSidebar", "toggleLeftSidebar")(),
    "view.toggleRightSidebar": () => requireHandler(handlers, "view.toggleRightSidebar", "toggleRightSidebar")(),
    "view.editorOnly": () => requireHandler(handlers, "view.editorOnly", "setEditorMode")("editor"),
    "view.split": () => requireHandler(handlers, "view.split", "setEditorMode")("split"),
    "note.rename": (payload) => requireHandler(handlers, "note.rename", "renameCurrentNote")(assertNotePayload(payload)),
    "note.move": (payload) => requireHandler(handlers, "note.move", "moveCurrentNote")(assertNotePayload(payload)),
    "note.copyLink": (payload) => requireHandler(handlers, "note.copyLink", "copyCurrentNoteLink")(assertNotePayload(payload)),
    "note.copyWikiLink": (payload) => requireHandler(handlers, "note.copyWikiLink", "copyCurrentNoteWikiLink")(assertNotePayload(payload)),
    "help.shortcuts": () => requireHandler(handlers, "help.shortcuts", "openShortcuts")(),
    "help.about": () => requireHandler(handlers, "help.about", "openAbout")(),
    "notebook.createNote": (payload) => requireHandler(handlers, "notebook.createNote", "createNoteInNotebook")(assertNotebookPayload(payload)),
    "notebook.rename": (payload) => requireHandler(handlers, "notebook.rename", "renameNotebook")(assertNotebookPayload(payload)),
    "notebook.reorder": (payload) => requireHandler(handlers, "notebook.reorder", "reorderNotebook")(assertNotebookPayload(payload)),
    "notebook.delete": (payload) => requireHandler(handlers, "notebook.delete", "deleteNotebook")(assertNotebookPayload(payload)),
    "note.open": (payload) => requireHandler(handlers, "note.open", "openCurrentNote")(assertNotePayload(payload)),
    "tag.delete": (payload) => requireHandler(handlers, "tag.delete", "deleteTag")(assertTagPayload(payload)),
    "selection.insertLink": (payload) => requireHandler(handlers, "selection.insertLink", "insertLinkFromSelection")(assertEditorSelectionPayload(payload)),
    "selection.insertTag": (payload) => requireHandler(handlers, "selection.insertTag", "insertTagFromSelection")(assertEditorSelectionPayload(payload)),
    "selection.createWikiLink": (payload) => requireHandler(handlers, "selection.createWikiLink", "createWikiLinkFromSelection")(assertEditorSelectionPayload(payload)),
    "blank.insertLink": (payload) => requireHandler(handlers, "blank.insertLink", "insertLinkFromBlank")(assertEditorBlankPayload(payload)),
    "blank.createWikiLink": (payload) => requireHandler(handlers, "blank.createWikiLink", "createWikiLinkFromBlank")(assertEditorBlankPayload(payload)),
    "blank.refreshIndex": (payload) => requireHandler(handlers, "blank.refreshIndex", "refreshIndex")(assertEditorBlankPayload(payload)),
    "blank.showSidebar": (payload) => requireHandler(handlers, "blank.showSidebar", "showLeftSidebar")(assertEditorBlankPayload(payload)),
    "tagBlank.refresh": (payload) => requireHandler(handlers, "tagBlank.refresh", "refreshTagFilter")(assertTagBlankPayload(payload)),
    "tagBlank.clearFilter": (payload) => requireHandler(handlers, "tagBlank.clearFilter", "clearSelectedTags")(assertTagBlankPayload(payload)),
    "tagContextItem.openNote": (payload) => requireHandler(handlers, "tagContextItem.openNote", "openTagContextItemNote")(assertTagContextItemPayload(payload)),
    "tagContextItem.locate": (payload) => requireHandler(handlers, "tagContextItem.locate", "locateTagContextItem")(assertTagContextItemPayload(payload)),
    "previewBlank.returnToEditor": (payload) => requireHandler(handlers, "previewBlank.returnToEditor", "returnToEditor")(assertPreviewBlankPayload(payload)),
    "previewBlank.showSidebar": (payload) => requireHandler(handlers, "previewBlank.showSidebar", "showPreviewSidebar")(assertPreviewBlankPayload(payload)),
    "previewLink.open": (payload) => requireHandler(handlers, "previewLink.open", "openPreviewLink")(assertPreviewLinkPayload(payload)),
    "previewLink.copy": (payload) => requireHandler(handlers, "previewLink.copy", "copyPreviewLink")(assertPreviewLinkPayload(payload)),
    "previewLink.openTargetNote": (payload) => requireHandler(handlers, "previewLink.openTargetNote", "openPreviewTargetNote")(assertPreviewTargetNotePayload(payload)),
    "linksBlank.refresh": (payload) => requireHandler(handlers, "linksBlank.refresh", "refreshLinks")(assertLinksBlankPayload(payload)),
    "linksBlank.showSidebar": (payload) => requireHandler(handlers, "linksBlank.showSidebar", "showLinksSidebar")(assertLinksBlankPayload(payload)),
    "linkItem.open": (payload) => requireHandler(handlers, "linkItem.open", "openLinkItem")(assertLinkItemPayload(payload)),
    "linkItem.openTargetNote": (payload) => requireHandler(handlers, "linkItem.openTargetNote", "openLinkTargetNote")(assertLinkTargetPayload(payload)),
    "linkItem.copy": (payload) => requireHandler(handlers, "linkItem.copy", "copyLinkItem")(assertLinkItemPayload(payload)),
    "relationBlank.create": (payload) => requireHandler(handlers, "relationBlank.create", "createRelation")(assertRelationBlankPayload(payload)),
    "relationBlank.refresh": (payload) => requireHandler(handlers, "relationBlank.refresh", "refreshRelations")(assertRelationBlankPayload(payload)),
    "relationBlank.showSidebar": (payload) => requireHandler(handlers, "relationBlank.showSidebar", "showRelationSidebar")(assertRelationBlankPayload(payload)),
    "relationItem.openTarget": (payload) => requireHandler(handlers, "relationItem.openTarget", "openRelationTarget")(assertRelationTargetPayload(payload)),
    "relationItem.delete": (payload) => requireHandler(handlers, "relationItem.delete", "deleteRelation")(assertRelationItemPayload(payload)),
  };

  return {
    async run(actionId: MenuActionId, payload?: ContextMenuPayload): Promise<boolean> {
      await actionExecutors[actionId](payload);
      return true;
    },
  };
}