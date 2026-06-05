use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchResultSource {
    Title,
    Link,
    Body,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub path: String,
    pub summary: Option<String>,
    pub snippet: String,
    pub line_start: i64,
    pub line_end: i64,
    pub occurrence_order: i64,
    pub match_text: String,
    pub source: SearchResultSource,
    pub link_target_path: Option<String>,
    pub link_target_title: Option<String>,
    pub link_target_href: Option<String>,
    pub score: f64,
}
