use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkItem {
    pub id: String,
    pub note_id: String,
    pub note_title: String,
    pub note_path: String,
    pub source_note_id: String,
    pub source_note_title: String,
    pub source_note_path: String,
    pub source_line_start: Option<i64>,
    pub source_line_end: Option<i64>,
    pub link_text: String,
    pub link_url: String,
    pub link_type: String,
    pub target_anchor: Option<String>,
    pub target_line_start: Option<i64>,
    pub target_line_end: Option<i64>,
    pub resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteLinks {
    pub outgoing: Vec<LinkItem>,
    pub incoming: Vec<LinkItem>,
}
