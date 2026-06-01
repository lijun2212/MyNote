use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagSummary {
    pub id: String,
    pub name: String,
    pub note_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagContextItem {
    pub note_id: String,
    pub note_path: String,
    pub note_title: String,
    pub note_updated_at: String,
    pub source: String,
    pub occurrence_order: i64,
    pub line_start: i64,
    pub line_end: i64,
    pub heading_context: Option<String>,
    pub context_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagContext {
    pub tag_id: String,
    pub tag_name: String,
    pub total_notes: i64,
    pub visible_count: i64,
    pub has_more: bool,
    pub items: Vec<TagContextItem>,
}
