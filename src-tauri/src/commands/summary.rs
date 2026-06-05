use crate::domain::note::Note;
use crate::error::AppError;
use crate::infrastructure::fs::resolve_kb_path;
use crate::services::summary::{build_summary_candidate, save_note_summary_in_conn};
use crate::state::AppState;
use rusqlite::Connection;
use std::path::Path;
use tauri::State;

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
    let root_guard = state.kb_root.lock().unwrap();
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
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    save_note_summary_for_root(conn, root, &path, &summary)
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