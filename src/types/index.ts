export interface KnowledgeBase {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  path: string;
  title: string;
  summary: string | null;
  content_hash: string;
  word_count: number;
  created_at: string;
  updated_at: string;
  indexed_at: string;
  deleted_at: string | null;
}

export interface NoteDetail {
  note: Note;
  content: string;
}

export interface NoteTreeNode {
  id: string | null;
  name: string;
  path: string;
  is_dir: boolean;
  notebook_icon?: string | null;
  notebook_color?: string | null;
  children: NoteTreeNode[];
}

export interface SaveNoteResult {
  note: Note;
  conflict: boolean;
}

export interface RenameNotebookResult {
  notebook_path: string;
  moved_note_paths: Array<[string, string]>;
}

export interface CreateNoteInput {
  directory: string;
  title: string;
}

export interface SaveNoteInput {
  note_id: string;
  content: string;
  expected_hash?: string;
}

export interface Tag {
  id: string;
  name: string;
  note_count?: number;
}

export interface TagContextItem {
  note_id: string;
  note_path: string;
  note_title: string;
  note_updated_at: string;
  source: "inline" | "front_matter";
  occurrence_order: number;
  line_start: number;
  line_end: number;
  heading_context: string | null;
  context_snippet: string;
}

export interface TagContext {
  tag_id: string;
  tag_name: string;
  total_notes: number;
  visible_count: number;
  has_more: boolean;
  items: TagContextItem[];
}

export interface TagNavigationTarget extends TagContextItem {
  tag_name: string;
  revision: number;
}

export type RelationType =
  | "related"
  | "prerequisite"
  | "extension"
  | "opposes"
  | "supports"
  | "similar";

export interface Relation {
  id: string;
  source_note_id: string;
  target_note_id: string;
  relation_type: RelationType;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface RelationItem {
  id: string;
  relation_type: RelationType;
  description: string | null;
  note_id: string;
  note_title: string;
  note_path: string;
  created_at: string;
  updated_at: string;
}

export interface NoteRelations {
  outgoing: RelationItem[];
  incoming: RelationItem[];
}

export interface LinkItem {
  id: string;
  note_id: string;
  note_title: string;
  note_path: string;
  source_note_id: string;
  source_note_title: string;
  source_note_path: string;
  source_line_start?: number | null;
  source_line_end?: number | null;
  link_text: string;
  link_url: string;
  link_type: string;
  target_anchor?: string | null;
  target_line_start?: number | null;
  target_line_end?: number | null;
  resolved: boolean;
}

export interface NoteLinks {
  outgoing: LinkItem[];
  incoming: LinkItem[];
}

export type SearchMatchSource = "title" | "link" | "body";

interface SearchHitLocation {
  note_id: string;
  line_start: number;
  line_end: number;
  occurrence_order: number;
  match_text: string;
  source: SearchMatchSource;
}

export interface SearchResult extends SearchHitLocation {
  title: string;
  path: string;
  summary?: string | null;
  snippet: string;
  link_target_path?: string | null;
  link_target_title?: string | null;
  link_target_href?: string | null;
  score: number;
}

export interface SearchNavigationTarget extends SearchHitLocation {
  note_path: string;
  note_title: string;
  context_snippet: string;
  revision: number;
}

export interface SearchHistoryHitItem {
  query: string;
  note_id: string;
  note_title: string;
  note_path: string;
  line_start: number;
  line_end: number;
  occurrence_order: number;
  snippet: string;
  source: SearchMatchSource;
}

export interface SearchSession {
  query: string;
  results: SearchResult[];
  currentIndex: number;
  active: boolean;
}
