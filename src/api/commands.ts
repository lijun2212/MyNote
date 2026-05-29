import { invoke } from "@tauri-apps/api/core";
import type {
  KnowledgeBase,
  LinkItem,
  Note,
  NoteDetail,
  NoteLinks,
  NoteTreeNode,
  SaveNoteResult,
  SearchResult,
  Tag,
} from "../types";

export const api = {
  createKnowledgeBase: (rootPath: string, name: string) =>
    invoke<KnowledgeBase>("create_knowledge_base", { rootPath, name }),

  openKnowledgeBase: (rootPath: string) =>
    invoke<KnowledgeBase>("open_knowledge_base", { rootPath }),

  createNote: (directory: string, title: string) =>
    invoke<Note>("create_note", { directory, title }),

  getNoteByPath: (path: string) =>
    invoke<NoteDetail>("get_note_by_path", { path }),

  saveNote: (noteId: string, content: string, expectedHash?: string) =>
    invoke<SaveNoteResult>("save_note", { noteId, content, expectedHash }),

  getNoteTree: () =>
    invoke<NoteTreeNode[]>("get_note_tree"),

  importNote: (srcPath: string, destDirectory: string) =>
    invoke<Note>("import_note", { srcPath, destDirectory }),

  listTags: () =>
    invoke<Tag[]>("list_tags"),

  listNotesByTag: (tagIds: string[]) =>
    invoke<Note[]>("list_notes_by_tag", { tagIds }),

  getNoteLinks: (noteId: string) =>
    invoke<NoteLinks>("get_note_links", { noteId }),

  getNoteByTitle: (title: string) =>
    invoke<Note | null>("get_note_by_title", { title }),

  searchNotes: (query: string, kbId: string) =>
    invoke<SearchResult[]>("search_notes", { query, kbId }),
};

// suppress unused import warning for LinkItem (used via NoteLinks)
export type { LinkItem };
