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

export interface LinkItem {
  id: number;
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
