import { invoke } from "@tauri-apps/api/core";
import type {
  AiProfile,
  AiProfileInput,
  AiProviderTrace,
  AiProfileTestResult,
  AiSettings,
  GraphCandidateRelation,
  GraphCandidateStatus,
  GraphConflictItem,
  GraphFactualRelationItem,
  GraphLogicPath,
  GraphLogicPathStep,
  GraphNodeRef,
  GraphOverview,
  GraphRelationDirection,
  GraphRelationItem,
  KnowledgeBase,
  LinkItem,
  Note,
  NoteGraphAnalysis,
  NoteDetail,
  NoteLinks,
  NoteOutlineItem,
  NoteRelations,
  NoteTreeNode,
  RenameNotebookResult,
  Relation,
  RelationOrigin,
  RelationType,
  SaveNoteResult,
  SearchResult,
  SummaryGenerationResult,
  SummaryGenerationStreamStart,
  Tag,
  TagContext,
} from "../types";

const RELATION_TYPES = [
  "related",
  "prerequisite",
  "extension",
  "opposes",
  "supports",
  "similar",
  "premise",
  "conclusion",
  "example",
  "rebuts",
] as const satisfies RelationType[];

const GRAPH_RELATION_DIRECTIONS = ["incoming", "outgoing"] as const satisfies GraphRelationDirection[];
const RELATION_ORIGINS = ["manual", "candidate_accepted", "candidate_edited"] as const satisfies RelationOrigin[];

const GRAPH_CANDIDATE_STATUSES = ["pending", "accepted", "ignored"] as const satisfies GraphCandidateStatus[];
interface RawNoteOutlineItem {
  id: string;
  text: string;
  level: number;
  line_start: number;
  line_end: number;
  anchor: string;
  children: RawNoteOutlineItem[];
}

interface RawGraphNodeRef {
  note_id: string;
  note_title: string;
  note_path: string;
  heading_id: string | null;
  heading_text: string | null;
  line_start: number | null;
  line_end: number | null;
}

interface RawGraphRelationItem {
  relation_id: string;
  relation_type: string;
  relation_origin: string;
  direction: string;
  note: RawGraphNodeRef;
  rationale: string | null;
  accepted_candidate_id: string | null;
}

interface RawGraphFactualRelationItem {
  link_id: string;
  direction: string;
  note: RawGraphNodeRef;
  link_text: string | null;
  link_type: string;
  target_anchor: string | null;
}

interface RawGraphOverview {
  confirmed_relations: RawGraphRelationItem[];
  factual_relations: RawGraphFactualRelationItem[];
}

interface RawGraphLogicPathStep {
  node: RawGraphNodeRef;
  relation_type: string | null;
  rationale: string | null;
}

interface RawGraphLogicPath {
  id: string;
  label: string;
  steps: RawGraphLogicPathStep[];
}

interface RawGraphConflictItem {
  relation_id: string;
  counterparty: RawGraphNodeRef;
  relation_type: string;
  direction: string;
  rationale: string | null;
}

interface RawGraphCandidateRelation {
  id: string;
  source_note_id: string;
  source_heading_id: string | null;
  target_note_id: string;
  target_heading_id: string | null;
  relation_type: string;
  rationale: string;
  evidence_excerpt: string | null;
  candidate_status: string;
  provider_name: string | null;
  created_at: string;
  updated_at: string;
  accepted_relation_id: string | null;
}

interface RawNoteGraphAnalysis {
  note_id: string;
  overview: RawGraphOverview;
  logic_paths: RawGraphLogicPath[];
  conflicts: RawGraphConflictItem[];
  missing_premises: string[];
}

function assertAllowedValue<T extends string>(value: string, allowed: readonly T[], fieldName: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }

  throw new Error(`Invalid ${fieldName}: ${value}`);
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

function mapRelationType(value: string): RelationType {
  return assertAllowedValue(value, RELATION_TYPES, "relation type");
}

function mapGraphRelationDirection(value: string): GraphRelationDirection {
  return assertAllowedValue(value, GRAPH_RELATION_DIRECTIONS, "graph relation direction");
}

function mapRelationOrigin(value: string): RelationOrigin {
  return assertAllowedValue(value, RELATION_ORIGINS, "relation origin");
}

function mapGraphCandidateStatus(value: string): GraphCandidateStatus {
  return assertAllowedValue(value, GRAPH_CANDIDATE_STATUSES, "graph candidate status");
}

function mapGraphNodeRef(node: RawGraphNodeRef): GraphNodeRef {
  return {
    noteId: node.note_id,
    noteTitle: node.note_title,
    notePath: node.note_path,
    headingId: node.heading_id,
    headingText: node.heading_text,
    lineStart: node.line_start,
    lineEnd: node.line_end,
  };
}

function mapGraphRelationItem(item: RawGraphRelationItem): GraphRelationItem {
  return {
    relationId: item.relation_id,
    relationType: mapRelationType(item.relation_type),
    relationOrigin: mapRelationOrigin(item.relation_origin),
    direction: mapGraphRelationDirection(item.direction),
    note: mapGraphNodeRef(item.note),
    rationale: item.rationale,
    acceptedCandidateId: item.accepted_candidate_id,
  };
}

function mapGraphFactualRelationItem(item: RawGraphFactualRelationItem): GraphFactualRelationItem {
  return {
    linkId: item.link_id,
    direction: mapGraphRelationDirection(item.direction),
    note: mapGraphNodeRef(item.note),
    linkText: item.link_text,
    linkType: item.link_type,
    targetAnchor: item.target_anchor,
  };
}

function mapGraphOverview(overview: RawGraphOverview): GraphOverview {
  return {
    confirmedRelations: overview.confirmed_relations.map(mapGraphRelationItem),
    factualRelations: overview.factual_relations.map(mapGraphFactualRelationItem),
  };
}

function mapGraphLogicPathStep(step: RawGraphLogicPathStep): GraphLogicPathStep {
  return {
    node: mapGraphNodeRef(step.node),
    relationType: step.relation_type === null ? null : mapRelationType(step.relation_type),
    rationale: step.rationale,
  };
}

function mapGraphLogicPath(path: RawGraphLogicPath): GraphLogicPath {
  return {
    id: path.id,
    label: path.label,
    steps: path.steps.map(mapGraphLogicPathStep),
  };
}

function mapGraphConflictItem(item: RawGraphConflictItem): GraphConflictItem {
  return {
    relationId: item.relation_id,
    counterparty: mapGraphNodeRef(item.counterparty),
    relationType: mapRelationType(item.relation_type),
    direction: mapGraphRelationDirection(item.direction),
    rationale: item.rationale,
  };
}

function mapGraphCandidateRelation(item: RawGraphCandidateRelation): GraphCandidateRelation {
  return {
    id: item.id,
    sourceNoteId: item.source_note_id,
    sourceHeadingId: item.source_heading_id,
    targetNoteId: item.target_note_id,
    targetHeadingId: item.target_heading_id,
    relationType: mapRelationType(item.relation_type),
    rationale: item.rationale,
    evidenceExcerpt: item.evidence_excerpt,
    candidateStatus: mapGraphCandidateStatus(item.candidate_status),
    providerName: item.provider_name,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    acceptedRelationId: item.accepted_relation_id,
  };
}

function mapNoteGraphAnalysis(analysis: RawNoteGraphAnalysis): NoteGraphAnalysis {
  return {
    noteId: analysis.note_id,
    overview: mapGraphOverview(analysis.overview),
    logicPaths: analysis.logic_paths.map(mapGraphLogicPath),
    conflicts: analysis.conflicts.map(mapGraphConflictItem),
    missingPremises: analysis.missing_premises,
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

  getNoteGraphAnalysis: async (noteId: string) => {
    const analysis = await invoke<RawNoteGraphAnalysis>("get_note_graph_analysis", { noteId });
    return mapNoteGraphAnalysis(analysis);
  },

  getNoteGraphCandidates: async (noteId: string) => {
    const candidates = await invoke<RawGraphCandidateRelation[]>("get_note_graph_candidates", { noteId });
    return candidates.map(mapGraphCandidateRelation);
  },

  generateNoteGraphCandidates: async (noteId: string, profileId?: string) => {
    const candidates = await invoke<RawGraphCandidateRelation[]>("generate_note_graph_candidates", {
      noteId,
      profileId,
    });
    return candidates.map(mapGraphCandidateRelation);
  },

  acceptGraphCandidate: (candidateId: string, relationType?: RelationType, description?: string) =>
    invoke<Relation>("accept_graph_candidate", {
      candidateId,
      relationType,
      description,
    }),

  ignoreGraphCandidate: (candidateId: string) =>
    invoke<void>("ignore_graph_candidate", { candidateId }),
};

// suppress unused import warning for LinkItem (used via NoteLinks)
export type { AiProviderTrace, LinkItem };
