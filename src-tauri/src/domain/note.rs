use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub path: String,
    pub title: String,
    pub summary: Option<String>,
    pub content_hash: String,
    pub word_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub indexed_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDetail {
    pub note: Note,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteTreeNode {
    pub id: Option<String>,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub has_summary: bool,
    pub notebook_icon: Option<String>,
    pub notebook_color: Option<String>,
    pub children: Vec<NoteTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveNoteResult {
    pub note: Note,
    pub conflict: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameNotebookResult {
    pub notebook_path: String,
    pub moved_note_paths: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNoteInput {
    pub directory: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNotebookInput {
    pub name: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveNoteInput {
    pub note_id: String,
    pub content: String,
    pub expected_hash: Option<String>,
}
