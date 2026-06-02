import { invoke } from "@tauri-apps/api/core";
import type {
  KnowledgeBase,
  LinkItem,
  Note,
  NoteDetail,
  NoteLinks,
  NoteRelations,
  NoteTreeNode,
  Relation,
  RelationType,
  SaveNoteResult,
  SearchResult,
  Tag,
  TagContext,
} from "../types";

export const api = {
  createKnowledgeBase: (rootPath: string, name: string) =>
    invoke<KnowledgeBase>("create_knowledge_base", { rootPath, name }),

  openKnowledgeBase: (rootPath: string) =>
    invoke<KnowledgeBase>("open_knowledge_base", { rootPath }),

  createNote: (directory: string, title: string) =>
    invoke<Note>("create_note", { directory, title }),

  createNotebook: (name: string) =>
    invoke<string>("create_notebook", { name }),

  getNoteByPath: (path: string) =>
    invoke<NoteDetail>("get_note_by_path", { path }),

  saveNote: (noteId: string, content: string, expectedHash?: string) =>
    invoke<SaveNoteResult>("save_note", { noteId, content, expectedHash }),

  getNoteTree: () =>
    invoke<NoteTreeNode[]>("get_note_tree"),

  importNote: (srcPath: string, destDirectory: string) =>
    invoke<Note>("import_note", { srcPath, destDirectory }),

  moveNote: (sourcePath: string, targetDirectory: string) =>
    invoke<Note>("move_note", { sourcePath, targetDirectory }),

  listTags: () =>
    invoke<Tag[]>("list_tags"),

  getTagContext: (tagId: string) =>
    invoke<TagContext>("get_tag_context", { tagId }),

  deleteTag: (tagId: string) =>
    invoke<void>("delete_tag", { tagId }),

  listNotesByTag: (tagIds: string[]) =>
    invoke<Note[]>("list_notes_by_tag", { tagIds }),

  getNoteLinks: (noteId: string) =>
    invoke<NoteLinks>("get_note_links", { noteId }),

  getNoteByTitle: (title: string) =>
    invoke<Note | null>("get_note_by_title", { title }),

  searchNotes: (query: string, kbId: string) =>
    invoke<SearchResult[]>("search_notes", { query, kbId }),

  listRelations: (noteId: string) =>
    invoke<NoteRelations>("list_relations", { noteId }),

  createRelation: (
    sourceNoteId: string,
    targetNoteId: string,
    relationType: RelationType,
    description?: string,
  ) =>
    invoke<Relation>("create_relation", {
      sourceNoteId,
      targetNoteId,
      relationType,
      description,
    }),

  deleteRelation: (relationId: string) =>
    invoke<void>("delete_relation", { relationId }),
};

// suppress unused import warning for LinkItem (used via NoteLinks)
export type { LinkItem };
