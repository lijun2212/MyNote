import { invoke } from "@tauri-apps/api/core";
import type {
  KnowledgeBase,
  Note,
  NoteDetail,
  NoteTreeNode,
  SaveNoteResult,
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
};
