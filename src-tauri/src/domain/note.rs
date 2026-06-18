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
#[serde(rename_all = "camelCase")]
pub struct MarkdownBeautifyOptions {
    pub fix_syntax: bool,
    pub refresh_toc: bool,
    pub normalize_headings: bool,
    pub normalize_code_blocks: bool,
    pub normalize_spacing: bool,
    pub use_ai_assist: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownBeautifyRequest {
    pub note_path: String,
    pub content: String,
    pub options: MarkdownBeautifyOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkdownBeautifySeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkdownBeautifyAiStatus {
    NotRequested,
    Applied,
    Unavailable,
    CandidateRejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownBeautifyIssue {
    pub id: String,
    pub severity: MarkdownBeautifySeverity,
    pub kind: String,
    pub message: String,
    pub line_start: Option<i64>,
    pub line_end: Option<i64>,
    pub auto_fixable: bool,
    pub ai_eligible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownBeautifySummary {
    pub error_count: i64,
    pub warning_count: i64,
    pub auto_fixable_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownBeautifyResult {
    pub original_hash: String,
    pub beautified_content: String,
    pub applied_ai: bool,
    pub ai_status: MarkdownBeautifyAiStatus,
    pub ai_status_detail: Option<String>,
    pub diagnostics: Vec<MarkdownBeautifyIssue>,
    pub summary: MarkdownBeautifySummary,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InsertImageResult {
    pub markdown_path: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MarkdownImportSource {
    File { path: String },
    Directory { path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownImportRequest {
    pub sources: Vec<MarkdownImportSource>,
    pub dest_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownImportItem {
    pub source_path: String,
    pub note: Note,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownImportMessage {
    pub source_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownImportResult {
    pub imported: Vec<MarkdownImportItem>,
    pub warnings: Vec<MarkdownImportMessage>,
    pub failures: Vec<MarkdownImportMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteOutlineItem {
    pub id: String,
    pub text: String,
    pub level: u8,
    pub line_start: i64,
    pub line_end: i64,
    pub anchor: String,
    pub children: Vec<NoteOutlineItem>,
}

#[cfg(test)]
mod tests {
    use super::{MarkdownImportRequest, MarkdownImportSource};

    #[test]
    fn markdown_import_request_accepts_camel_case_dest_directory() {
        let request: MarkdownImportRequest = serde_json::from_str(
            r#"{
                "sources": [{ "kind": "directory", "path": "/tmp/research" }],
                "destDirectory": "notes/work"
            }"#,
        )
        .expect("expected camelCase request to deserialize");

        assert_eq!(request.dest_directory, "notes/work");
        assert!(matches!(
            request.sources.first(),
            Some(MarkdownImportSource::Directory { path }) if path == "/tmp/research"
        ));
    }
}
