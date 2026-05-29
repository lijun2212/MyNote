use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkItem {
    pub id: String,
    pub note_id: String,
    pub note_title: String,
    pub note_path: String,
    pub link_text: String,
    pub link_url: String,
    pub link_type: String,
    pub resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteLinks {
    pub outgoing: Vec<LinkItem>,
    pub incoming: Vec<LinkItem>,
}
