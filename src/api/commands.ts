import { invoke } from "@tauri-apps/api/core";
import type {
  AiProfile,
  AiProfileInput,
  AiProviderTrace,
  AiProfileTestResult,
  AiSettings,
  KnowledgeBase,
  LinkItem,
  Note,
  NoteDetail,
  NoteLinks,
  NoteOutlineItem,
  NoteRelations,
  NoteTreeNode,
  RenameNotebookResult,
  Relation,
  RelationType,
  SaveNoteResult,
  SearchResult,
  SummaryGenerationResult,
  SummaryGenerationStreamStart,
  Tag,
  TagContext,
} from "../types";

interface RawNoteOutlineItem {
  id: string;
  text: string;
  level: number;
  line_start: number;
  line_end: number;
  anchor: string;
  children: RawNoteOutlineItem[];
}

function mapNoteOutlineLevel(level: number): 1 | 2 | 3 {
  if (level === 1 || level === 2 || level === 3) {
    return level;
  }

  throw new Error(`Invalid note outline level: ${level}`);
}

function mapNoteOutlineItem(item: RawNoteOutlineItem): NoteOutlineItem {
  return {
    id: item.id,
    text: item.text,
    level: mapNoteOutlineLevel(item.level),
    lineStart: item.line_start,
    lineEnd: item.line_end,
    anchor: item.anchor,
    children: item.children.map(mapNoteOutlineItem),
  };
}

export const api = {
  createKnowledgeBase: (rootPath: string, name: string) =>
    invoke<KnowledgeBase>("create_knowledge_base", { rootPath, name }),

  getAiSettings: () =>
    invoke<AiSettings>("get_ai_settings"),

  upsertAiProfile: (input: AiProfileInput) =>
    invoke<AiProfile>("upsert_ai_profile", { input }),

  saveAiSettings: (enabled: boolean, defaultProfileId: string | null) =>
    invoke<AiSettings>("save_ai_settings", { enabled, defaultProfileId }),

  setAiProfileSecret: (profileId: string, apiKey: string) =>
    invoke<void>("set_ai_profile_secret", { profileId, apiKey }),

  hasAiProfileSecret: (profileId: string) =>
    invoke<boolean>("has_ai_profile_secret", { profileId }),

  testAiProfile: (profileId: string) =>
    invoke<AiProfileTestResult>("test_ai_profile", { profileId }),

  testAiProfileInput: (input: AiProfileInput, apiKey?: string | null) =>
    invoke<AiProfileTestResult>("test_ai_profile_input", { input, apiKey }),

  openKnowledgeBase: (rootPath: string) =>
    invoke<KnowledgeBase>("open_knowledge_base", { rootPath }),

  createNote: (directory: string, title: string) =>
    invoke<Note>("create_note", { directory, title }),

  createNotebook: (name: string, icon: string, color: string) =>
    invoke<string>("create_notebook", { name, icon, color }),

  getNoteByPath: (path: string) =>
    invoke<NoteDetail>("get_note_by_path", { path }),

  getNoteOutline: async (path: string) => {
    const outline = await invoke<RawNoteOutlineItem[]>("get_note_outline", { path });
    return outline.map(mapNoteOutlineItem);
  },

  saveNote: (noteId: string, content: string, expectedHash?: string) =>
    invoke<SaveNoteResult>("save_note", { noteId, content, expectedHash }),

  getNoteTree: () =>
    invoke<NoteTreeNode[]>("get_note_tree"),

  importNote: (srcPath: string, destDirectory: string) =>
    invoke<Note>("import_note", { srcPath, destDirectory }),

  moveNote: (sourcePath: string, targetDirectory: string) =>
    invoke<Note>("move_note", { sourcePath, targetDirectory }),

  renameNotebook: (oldPath: string, newName: string) =>
    invoke<RenameNotebookResult>("rename_notebook", { oldPath, newName }),

  updateNotebookVisual: (notebookPath: string, icon: string, color: string) =>
    invoke<void>("update_notebook_visual", { notebookPath, icon, color }),

  deleteNotebook: (notebookPath: string) =>
    invoke<void>("delete_notebook", { notebookPath }),

  reorderNotebooks: (orderedPaths: string[]) =>
    invoke<void>("reorder_notebooks", { orderedPaths }),

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

  generateSummaryCandidate: (path: string) =>
    invoke<string>("generate_summary_candidate", { path }),

  generateSummaryCandidateWithAi: (path: string, profileId?: string) =>
    invoke<SummaryGenerationResult>("generate_summary_candidate_with_ai", {
      path,
      profileId,
    }),

  generateSummaryCandidateWithAiStream: (path: string, requestId: string, profileId?: string) =>
    invoke<SummaryGenerationStreamStart>("generate_summary_candidate_with_ai_stream", {
      path,
      requestId,
      profileId,
    }),

  saveNoteSummary: (path: string, summary: string) =>
    invoke<Note>("save_note_summary", { path, summary }),

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
export type { AiProviderTrace, LinkItem };
