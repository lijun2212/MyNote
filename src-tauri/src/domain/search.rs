use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchResultSource {
    Title,
    Body,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub path: String,
    pub snippet: String,
    pub line_start: i64,
    pub line_end: i64,
    pub occurrence_order: i64,
    pub match_text: String,
    pub source: SearchResultSource,
    pub score: f64,
}
