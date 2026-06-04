import type {
  ContextMenuPayload,
  EditorBlankContextMenuPayload,
  EditorSelectionContextMenuPayload,
  NoteContextMenuPayload,
  NotebookContextMenuPayload,
  TagContextMenuPayload,
} from "../components/ContextMenu/contextMenuTypes";
import type { EditorMode } from "../store/useEditorStore";
import type { MenuActionId } from "./menuIds";

type MaybePromise = Promise<void> | void;

export interface MenuActionRunnerHandlers {
  createNote: () => MaybePromise;
  createNotebook: () => MaybePromise;
  importNote: () => MaybePromise;
  openSearch: () => MaybePromise;
  toggleLeftSidebar: () => MaybePromise;
  toggleRightSidebar: () => MaybePromise;
  setEditorMode: (mode: EditorMode) => MaybePromise;
  openCurrentNote: (payload: NoteContextMenuPayload) => MaybePromise;
  moveCurrentNote: (payload: NoteContextMenuPayload) => MaybePromise;
  renameCurrentNote: (payload: NoteContextMenuPayload) => MaybePromise;
  copyCurrentNoteLink: (payload: NoteContextMenuPayload) => MaybePromise;
  copyCurrentNoteWikiLink: (payload: NoteContextMenuPayload) => MaybePromise;
  createNoteInNotebook: (payload: NotebookContextMenuPayload) => MaybePromise;
  renameNotebook: (payload: NotebookContextMenuPayload) => MaybePromise;
  reorderNotebook: (payload: NotebookContextMenuPayload) => MaybePromise;
  deleteNotebook: (payload: NotebookContextMenuPayload) => MaybePromise;
  deleteTag: (payload: TagContextMenuPayload) => MaybePromise;
  insertLinkFromSelection: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
  insertTagFromSelection: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
  createWikiLinkFromSelection: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
  refreshIndex: (payload: EditorBlankContextMenuPayload) => MaybePromise;
  showLeftSidebar: (payload: EditorBlankContextMenuPayload) => MaybePromise;
  openShortcuts: () => MaybePromise;
  openAbout: () => MaybePromise;
}

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

export function createMenuActionRunner(handlers: MenuActionRunnerHandlers) {
  const actionExecutors: Record<MenuActionId, (payload?: ContextMenuPayload) => MaybePromise> = {
    "file.newNote": () => handlers.createNote(),
    "file.newNotebook": () => handlers.createNotebook(),
    "file.importNote": () => handlers.importNote(),
    "edit.rename": (payload) => handlers.renameCurrentNote(assertNotePayload(payload)),
    "edit.move": (payload) => handlers.moveCurrentNote(assertNotePayload(payload)),
    "edit.copyLink": (payload) => handlers.copyCurrentNoteLink(assertNotePayload(payload)),
    "view.search": () => handlers.openSearch(),
    "view.toggleLeftSidebar": () => handlers.toggleLeftSidebar(),
    "view.toggleRightSidebar": () => handlers.toggleRightSidebar(),
    "view.editorOnly": () => handlers.setEditorMode("editor"),
    "view.split": () => handlers.setEditorMode("split"),
    "note.rename": (payload) => handlers.renameCurrentNote(assertNotePayload(payload)),
    "note.move": (payload) => handlers.moveCurrentNote(assertNotePayload(payload)),
    "note.copyLink": (payload) => handlers.copyCurrentNoteLink(assertNotePayload(payload)),
    "note.copyWikiLink": (payload) => handlers.copyCurrentNoteWikiLink(assertNotePayload(payload)),
    "help.shortcuts": () => handlers.openShortcuts(),
    "help.about": () => handlers.openAbout(),
    "notebook.createNote": (payload) => handlers.createNoteInNotebook(assertNotebookPayload(payload)),
    "notebook.rename": (payload) => handlers.renameNotebook(assertNotebookPayload(payload)),
    "notebook.reorder": (payload) => handlers.reorderNotebook(assertNotebookPayload(payload)),
    "notebook.delete": (payload) => handlers.deleteNotebook(assertNotebookPayload(payload)),
    "note.open": (payload) => handlers.openCurrentNote(assertNotePayload(payload)),
    "tag.delete": (payload) => handlers.deleteTag(assertTagPayload(payload)),
    "selection.insertLink": (payload) => handlers.insertLinkFromSelection(assertEditorSelectionPayload(payload)),
    "selection.insertTag": (payload) => handlers.insertTagFromSelection(assertEditorSelectionPayload(payload)),
    "selection.createWikiLink": (payload) => handlers.createWikiLinkFromSelection(assertEditorSelectionPayload(payload)),
    "blank.refreshIndex": (payload) => handlers.refreshIndex(assertEditorBlankPayload(payload)),
    "blank.showSidebar": (payload) => handlers.showLeftSidebar(assertEditorBlankPayload(payload)),
  };

  return {
    async run(actionId: MenuActionId, payload?: ContextMenuPayload): Promise<boolean> {
      await actionExecutors[actionId](payload);
      return true;
    },
  };
}