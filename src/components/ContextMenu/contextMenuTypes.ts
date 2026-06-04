export type MaybePromise = Promise<void> | void;

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface ContextMenuPayloadBase {
  type: "notebook" | "note" | "tag" | "fileTreeBlank" | "editorSelection" | "editorBlank";
}

export interface NotebookContextMenuPayload extends ContextMenuPayloadBase {
  type: "notebook";
  path: string;
  notebookName?: string;
  handlers?: {
    createNote?: (payload: NotebookContextMenuPayload) => MaybePromise;
    rename?: (payload: NotebookContextMenuPayload) => MaybePromise;
    reorder?: (payload: NotebookContextMenuPayload) => MaybePromise;
    delete?: (payload: NotebookContextMenuPayload) => MaybePromise;
  };
}

export interface NoteContextMenuPayload extends ContextMenuPayloadBase {
  type: "note";
  noteId: string;
  noteTitle?: string;
  path: string;
  handlers?: {
    open?: (payload: NoteContextMenuPayload) => MaybePromise;
    rename?: (payload: NoteContextMenuPayload) => MaybePromise;
    move?: (payload: NoteContextMenuPayload) => MaybePromise;
    copyLink?: (payload: NoteContextMenuPayload) => MaybePromise;
    copyWikiLink?: (payload: NoteContextMenuPayload) => MaybePromise;
  };
}

export interface TagContextMenuPayload extends ContextMenuPayloadBase {
  type: "tag";
  tagId: string;
  tagName?: string;
  handlers?: {
    open?: (payload: TagContextMenuPayload) => MaybePromise;
    rename?: (payload: TagContextMenuPayload) => MaybePromise;
    delete?: (payload: TagContextMenuPayload) => MaybePromise;
  };
}

export interface FileTreeBlankContextMenuPayload extends ContextMenuPayloadBase {
  type: "fileTreeBlank";
  path: string;
  handlers?: {
    createNote?: (payload: FileTreeBlankContextMenuPayload) => MaybePromise;
    createNotebook?: (payload: FileTreeBlankContextMenuPayload) => MaybePromise;
    importNote?: (payload: FileTreeBlankContextMenuPayload) => MaybePromise;
  };
}

export interface EditorSelectionContextMenuPayload extends ContextMenuPayloadBase {
  type: "editorSelection";
  selectedText: string;
  handlers?: {
    insertLink?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
    insertTag?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
    createWikiLink?: (payload: EditorSelectionContextMenuPayload) => MaybePromise;
  };
}

export interface EditorBlankContextMenuPayload extends ContextMenuPayloadBase {
  type: "editorBlank";
  handlers?: {
    refreshIndex?: (payload: EditorBlankContextMenuPayload) => MaybePromise;
    showSidebar?: (payload: EditorBlankContextMenuPayload) => MaybePromise;
  };
}

export type ContextMenuPayload =
  | NotebookContextMenuPayload
  | NoteContextMenuPayload
  | TagContextMenuPayload
  | FileTreeBlankContextMenuPayload
  | EditorSelectionContextMenuPayload
  | EditorBlankContextMenuPayload;

export interface ContextMenuRequest {
  position: ContextMenuPosition;
  payload: ContextMenuPayload;
}