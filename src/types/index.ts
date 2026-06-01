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
  children: NoteTreeNode[];
}

export interface SaveNoteResult {
  note: Note;
  conflict: boolean;
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
  link_text: string;
  link_url: string;
  link_type: string;
  resolved: boolean;
}

export interface NoteLinks {
  outgoing: LinkItem[];
  incoming: LinkItem[];
}

export interface SearchResult {
  note_id: string;
  title: string;
  path: string;
  snippet: string;
}
