export type MaybePromise = Promise<void> | void;

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface ContextMenuPayloadBase {
  type:
    | "notebook"
    | "note"
    | "tag"
    | "fileTreeBlank"
    | "editorSelection"
    | "editorBlank"
    | "tagBlank"
    | "tagContextItem"
    | "previewBlank"
    | "previewLink"
    | "linksBlank"
    | "linkItem"
    | "relationBlank"
    | "relationItem";
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

export interface TagBlankContextMenuPayload extends ContextMenuPayloadBase {
  type: "tagBlank";
  selectedTagIds: string[];
  handlers?: {
    refresh?: (payload: TagBlankContextMenuPayload) => MaybePromise;
    clearFilter?: (payload: TagBlankContextMenuPayload) => MaybePromise;
  };
}

export interface TagContextItemContextMenuPayload extends ContextMenuPayloadBase {
  type: "tagContextItem";
  notePath: string;
  noteTitle?: string;
  lineStart?: number;
  lineEnd?: number;
  occurrenceOrder?: number;
  handlers?: {
    open?: (payload: TagContextItemContextMenuPayload) => MaybePromise;
    locate?: (payload: TagContextItemContextMenuPayload) => MaybePromise;
  };
}

export interface PreviewBlankContextMenuPayload extends ContextMenuPayloadBase {
  type: "previewBlank";
  handlers?: {
    returnToEditor?: (payload: PreviewBlankContextMenuPayload) => MaybePromise;
    showSidebar?: (payload: PreviewBlankContextMenuPayload) => MaybePromise;
  };
}

export type PreviewLinkKind = "external" | "internal" | "wiki";

export interface PreviewLinkContextMenuPayload extends ContextMenuPayloadBase {
  type: "previewLink";
  linkType: PreviewLinkKind;
  href: string;
  notePath?: string;
  handlers?: {
    open?: (payload: PreviewLinkContextMenuPayload) => MaybePromise;
    copy?: (payload: PreviewLinkContextMenuPayload) => MaybePromise;
    openTargetNote?: (payload: PreviewLinkContextMenuPayload) => MaybePromise;
  };
}

export interface LinksBlankContextMenuPayload extends ContextMenuPayloadBase {
  type: "linksBlank";
  handlers?: {
    refresh?: (payload: LinksBlankContextMenuPayload) => MaybePromise;
    showSidebar?: (payload: LinksBlankContextMenuPayload) => MaybePromise;
  };
}

export interface LinkItemContextMenuPayload extends ContextMenuPayloadBase {
  type: "linkItem";
  linkId: string;
  linkType: PreviewLinkKind;
  href: string;
  notePath?: string;
  handlers?: {
    open?: (payload: LinkItemContextMenuPayload) => MaybePromise;
    copy?: (payload: LinkItemContextMenuPayload) => MaybePromise;
    openTargetNote?: (payload: LinkItemContextMenuPayload) => MaybePromise;
  };
}

export interface RelationBlankContextMenuPayload extends ContextMenuPayloadBase {
  type: "relationBlank";
  handlers?: {
    create?: (payload: RelationBlankContextMenuPayload) => MaybePromise;
    refresh?: (payload: RelationBlankContextMenuPayload) => MaybePromise;
    showSidebar?: (payload: RelationBlankContextMenuPayload) => MaybePromise;
  };
}

export interface RelationItemContextMenuPayload extends ContextMenuPayloadBase {
  type: "relationItem";
  relationId: string;
  notePath?: string;
  handlers?: {
    openTarget?: (payload: RelationItemContextMenuPayload) => MaybePromise;
    delete?: (payload: RelationItemContextMenuPayload) => MaybePromise;
  };
}

export type ContextMenuPayload =
  | NotebookContextMenuPayload
  | NoteContextMenuPayload
  | TagContextMenuPayload
  | FileTreeBlankContextMenuPayload
  | EditorSelectionContextMenuPayload
  | EditorBlankContextMenuPayload
  | TagBlankContextMenuPayload
  | TagContextItemContextMenuPayload
  | PreviewBlankContextMenuPayload
  | PreviewLinkContextMenuPayload
  | LinksBlankContextMenuPayload
  | LinkItemContextMenuPayload
  | RelationBlankContextMenuPayload
  | RelationItemContextMenuPayload;

export interface ContextMenuRequest {
  position: ContextMenuPosition;
  payload: ContextMenuPayload;
}