use crate::domain::ai::SummaryGenerationResult;
use crate::domain::note::Note;
use crate::error::AppError;
use crate::infrastructure::fs::resolve_kb_path;
use crate::services::summary::{build_summary_candidate, save_note_summary_in_conn};
use crate::services::summary_agent::{
    generate_summary_candidate_with_ai_for_root, generate_summary_candidate_with_ai_stream_for_root,
    prepare_default_summary_agent,
};
use crate::state::AppState;
use rusqlite::Connection;
use std::path::Path;
use tauri::{AppHandle, Emitter, State};

const SUMMARY_STREAM_EVENT: &str = "summary:stream";

#[derive(Clone, serde::Serialize)]
struct SummaryStreamEventPayload {
    request_id: String,
    #[serde(rename = "type")]
    event_type: &'static str,
    chunk: Option<String>,
    summary: Option<String>,
    used_fallback: Option<bool>,
    provider_trace: Option<crate::domain::ai::AiProviderTrace>,
    error: Option<String>,
}

fn generate_summary_candidate_in_root(root: &Path, path: &str) -> Result<String, AppError> {
    let abs = resolve_kb_path(root, path)?;
    let content = std::fs::read_to_string(&abs)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", path)))?;
    let fallback_title = path
        .rsplit('/')
        .next()
        .unwrap_or("Untitled")
        .trim_end_matches(".md");

    build_summary_candidate(&content, fallback_title)
}

fn save_note_summary_for_root(
    conn: &Connection,
    root: &Path,
    path: &str,
    summary: &str,
) -> Result<Note, AppError> {
    save_note_summary_in_conn(conn, root, path, summary)
}

#[tauri::command]
pub async fn generate_summary_candidate(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, AppError> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;

    generate_summary_candidate_in_root(root, &path)
}

#[tauri::command]
pub async fn save_note_summary(
    state: State<'_, AppState>,
    path: String,
    summary: String,
) -> Result<Note, AppError> {
    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    save_note_summary_for_root(conn, root, &path, &summary)
}

#[tauri::command]
pub async fn generate_summary_candidate_with_ai(
    state: State<'_, AppState>,
    path: String,
    profile_id: Option<String>,
) -> Result<SummaryGenerationResult, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let prepared = {
        let db_guard = state.db_guard();
        let conn = db_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
        prepare_default_summary_agent(conn, &root, profile_id.as_deref())
    };

    generate_summary_candidate_with_ai_for_root(&root, &path, prepared).await
}

#[tauri::command]
pub async fn generate_summary_candidate_with_ai_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    request_id: String,
    profile_id: Option<String>,
) -> Result<String, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let prepared = {
        let db_guard = state.db_guard();
        let conn = db_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
        prepare_default_summary_agent(conn, &root, profile_id.as_deref())
    };

    let app_handle = app.clone();
    let stream_request_id = request_id.clone();
    tauri::async_runtime::spawn(async move {
        let mut emit_delta = |chunk: String| {
            app_handle
                .emit(
                    SUMMARY_STREAM_EVENT,
                    SummaryStreamEventPayload {
                        request_id: stream_request_id.clone(),
                        event_type: "delta",
                        chunk: Some(chunk),
                        summary: None,
                        used_fallback: None,
                        provider_trace: None,
                        error: None,
                    },
                )
                .map_err(|error| AppError::Io(format!("Failed to emit summary stream delta: {error}")))
        };

        match generate_summary_candidate_with_ai_stream_for_root(&root, &path, prepared, &mut emit_delta).await {
            Ok(result) => {
                let _ = app_handle.emit(
                    SUMMARY_STREAM_EVENT,
                    SummaryStreamEventPayload {
                        request_id: stream_request_id,
                        event_type: "completed",
                        chunk: None,
                        summary: Some(result.summary),
                        used_fallback: Some(result.used_fallback),
                        provider_trace: result.provider_trace,
                        error: None,
                    },
                );
            }
            Err(error) => {
                let _ = app_handle.emit(
                    SUMMARY_STREAM_EVENT,
                    SummaryStreamEventPayload {
                        request_id: stream_request_id,
                        event_type: "error",
                        chunk: None,
                        summary: None,
                        used_fallback: None,
                        provider_trace: None,
                        error: Some(error.to_string()),
                    },
                );
            }
        }
    });

    Ok(request_id)
}

#[cfg(test)]
mod tests {
    use super::{generate_summary_candidate_in_root, save_note_summary_for_root};
    use crate::error::AppError;
    use crate::infrastructure::db::open_and_migrate;
    use rusqlite::params;
    use tempfile::tempdir;

    fn seed_note(conn: &rusqlite::Connection, path: &str, title: &str, body: &str) {
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at, deleted_at)
             VALUES ('note-1', ?1, ?2, NULL, 'hash', 120, '{}', '2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z', NULL)",
            params![path, title],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES ('note-1', ?1, '', ?2)",
            params![title, body],
        )
        .unwrap();
    }

    #[test]
    fn generate_summary_candidate_in_root_returns_parsed_title_for_title_only_note() {
        let root = tempdir().unwrap();
        let notes_dir = root.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        std::fs::write(
            notes_dir.join("demo.md"),
            "---\ntitle: Front Matter Title\n---\n\n# Heading Title\n",
        )
        .unwrap();

        let candidate = generate_summary_candidate_in_root(root.path(), "notes/demo.md").unwrap();

        assert_eq!(candidate, "Front Matter Title");
    }

    #[test]
    fn generate_summary_candidate_in_root_returns_not_found_for_missing_file() {
        let root = tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("notes")).unwrap();

        let err = generate_summary_candidate_in_root(root.path(), "notes/missing.md").unwrap_err();

        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn save_note_summary_for_root_updates_note_on_success() {
        let root = tempdir().unwrap();
        let notes_dir = root.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        std::fs::write(notes_dir.join("demo.md"), "---\ntitle: Demo\n---\n\n# Demo\n\nBody").unwrap();

        let db_dir = tempdir().unwrap();
        let conn = open_and_migrate(&db_dir.path().join("test.sqlite")).unwrap();
        seed_note(&conn, "notes/demo.md", "Demo", "Body");

        let note = save_note_summary_for_root(&conn, root.path(), "notes/demo.md", "命令层摘要").unwrap();

        assert_eq!(note.summary.as_deref(), Some("命令层摘要"));
    }

    #[test]
    fn save_note_summary_for_root_returns_database_error_when_reindex_fails() {
        let root = tempdir().unwrap();
        let notes_dir = root.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        let note_path = notes_dir.join("demo.md");
        let original_content = "---\ntitle: Demo\n---\n\n# Demo\n\nBody";
        std::fs::write(&note_path, original_content).unwrap();

        let db_dir = tempdir().unwrap();
        let conn = open_and_migrate(&db_dir.path().join("test.sqlite")).unwrap();
        seed_note(&conn, "notes/demo.md", "Demo", "Body");
        conn.execute("DROP TABLE note_fts", []).unwrap();

        let err = save_note_summary_for_root(&conn, root.path(), "notes/demo.md", "命令层摘要")
            .unwrap_err();

        assert!(matches!(err, AppError::Database(_)));
        let restored = std::fs::read_to_string(&note_path).unwrap();
        assert_eq!(restored, original_content);
    }
}