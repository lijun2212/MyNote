use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkItem {
    pub link_id: String,
    pub note_id: Option<String>,
    pub note_title: Option<String>,
    pub note_path: Option<String>,
    pub target_raw: String,
    pub display_text: Option<String>,
    pub link_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteLinks {
    pub outgoing: Vec<LinkItem>,
    pub backlinks: Vec<LinkItem>,
    pub unresolved: Vec<LinkItem>,
}
