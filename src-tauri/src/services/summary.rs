use crate::domain::note::Note;
use crate::error::{AppError, AppResult};
use crate::infrastructure::fs::{atomic_write, resolve_kb_path};
use crate::infrastructure::markdown::{
    parse_front_matter, parse_note, remove_lookback_summary_block, render_note, split_front_matter,
    upsert_lookback_summary_block, FrontMatter,
};
use crate::services::index::index_note_full;
use rusqlite::Connection;
use std::path::Path;

pub fn build_summary_candidate(content: &str, fallback_title: &str) -> AppResult<String> {
    let parsed = parse_note(content, fallback_title)?;
    let body_without_summary = remove_lookback_summary_block(&parsed.body);

    let intro = body_without_summary
        .split("\n\n")
        .map(str::trim)
        .find(|segment| {
            !segment.is_empty()
                && !segment.starts_with('#')
                && !segment.starts_with('-')
                && !segment.starts_with('*')
                && !segment.starts_with('>')
        })
        .unwrap_or("");

    let headings = body_without_summary
        .lines()
        .filter_map(|line| line.trim().strip_prefix("## ").map(str::trim))
        .filter(|heading| !heading.is_empty())
        .take(2)
        .collect::<Vec<_>>()
        .join("，");

    let mut candidate = intro.to_string();
    if !headings.is_empty() {
        if !candidate.is_empty() {
            candidate.push('；');
        }
        candidate.push_str("重点包括");
        candidate.push_str(&headings);
    }

    let normalized = candidate.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        Ok(parsed.title)
    } else {
        Ok(normalized)
    }
}

pub fn save_note_summary_in_conn(
    conn: &Connection,
    root: &Path,
    rel_path: &str,
    summary: &str,
) -> AppResult<Note> {
    let abs = resolve_kb_path(root, rel_path)?;
    let original_content = std::fs::read_to_string(&abs)
        .map_err(|_| AppError::NotFound(format!("File not found: {}", rel_path)))?;
    let (front_matter_raw, body) = split_front_matter(&original_content);

    let mut front_matter = if let Some(raw) = front_matter_raw {
        parse_front_matter(raw)?
    } else {
        FrontMatter::default()
    };

    let trimmed_summary = summary.trim();
    front_matter.summary = None;

    let next_body = if trimmed_summary.is_empty() {
        remove_lookback_summary_block(body)
    } else {
        upsert_lookback_summary_block(body, trimmed_summary)
    };

    let rendered = render_note(&front_matter, &next_body)?;
    atomic_write(&abs, &rendered)?;

    match index_note_full(conn, root, rel_path, &rendered) {
        Ok(note) => Ok(note),
        Err(index_err) => {
            atomic_write(&abs, &original_content).map_err(|restore_err| {
                AppError::Conflict(format!(
                    "Failed to reindex note summary and failed to restore file content: {}; restore error: {}",
                    index_err, restore_err
                ))
            })?;
            Err(index_err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{build_summary_candidate, save_note_summary_in_conn};
    use crate::infrastructure::db::open_and_migrate;
    use rusqlite::params;
    use tempfile::tempdir;

    fn seed_note(conn: &rusqlite::Connection, path: &str, title: &str, body: &str) {
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at, deleted_at)
             VALUES ('note-1', ?1, ?2, NULL, 'hash', 120, '{}', '2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z', '2026-06-05T00:00:00Z', NULL)",
            rusqlite::params![path, title],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES ('note-1', ?1, '', ?2)",
            rusqlite::params![title, body],
        )
        .unwrap();
    }

    #[test]
    fn builds_candidate_from_heading_and_intro() {
        let content = "---\ntitle: Demo\n---\n\n# Demo\n\n这是一段用于测试的首段内容。\n\n## 要点\n\n- 第一条\n- 第二条";
        let candidate = build_summary_candidate(content, "Demo").unwrap();
        assert!(candidate.contains("这是一段用于测试的首段内容"));
        assert!(candidate.contains("要点"));
    }

    #[test]
    fn builds_candidate_from_parsed_title_when_note_is_title_only() {
        let content = "---\ntitle: Front Matter Title\n---\n\n# Heading Title\n";

        let candidate = build_summary_candidate(content, "filename-stem").unwrap();

        assert_eq!(candidate, "Front Matter Title");
    }

    #[test]
    fn builds_candidate_from_parsed_title_when_note_is_empty() {
        let candidate = build_summary_candidate("", "filename-stem").unwrap();

        assert_eq!(candidate, "filename-stem");
    }

    #[test]
    fn builds_candidate_keeps_longer_rule_summary() {
        let content = format!("# Demo\n\n{}", "这是一段很长的正文。".repeat(80));

        let candidate = build_summary_candidate(&content, "Demo").unwrap();

        assert!(candidate.chars().count() > 200);
    }

    #[test]
    fn build_summary_candidate_does_not_hard_truncate_rule_summary() {
        let content = format!("# Demo\n\n{}", "这是一段很长的正文。".repeat(80));

        let candidate = build_summary_candidate(&content, "Demo").unwrap();

        assert!(candidate.chars().count() > 200);
    }

    #[test]
    fn save_note_summary_updates_front_matter_and_note_index() {
        let root = tempdir().unwrap();
        let notes_dir = root.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        let note_path = notes_dir.join("demo.md");
        std::fs::write(&note_path, "---\ntitle: Demo\n---\n\n# Demo\n\nBody").unwrap();

        let db_dir = tempdir().unwrap();
        let conn = open_and_migrate(&db_dir.path().join("test.sqlite")).unwrap();
        seed_note(&conn, "notes/demo.md", "Demo", "Body");

        let note = save_note_summary_in_conn(&conn, root.path(), "notes/demo.md", "新的回看摘要").unwrap();
        assert_eq!(note.summary.as_deref(), Some("新的回看摘要"));

        let saved = std::fs::read_to_string(&note_path).unwrap();
        assert!(!saved.contains("summary:"));
        assert!(saved.contains("> 摘要：新的回看摘要"));
    }

    #[test]
    fn save_note_summary_creates_minimal_front_matter_for_note_without_existing_front_matter() {
        let root = tempdir().unwrap();
        let notes_dir = root.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        let note_path = notes_dir.join("demo.md");
        std::fs::write(&note_path, "# Demo\n\nBody").unwrap();

        let db_dir = tempdir().unwrap();
        let conn = open_and_migrate(&db_dir.path().join("test.sqlite")).unwrap();
        seed_note(&conn, "notes/demo.md", "Demo", "Body");

        let note = save_note_summary_in_conn(&conn, root.path(), "notes/demo.md", "新的回看摘要").unwrap();

        assert_eq!(note.summary.as_deref(), Some("新的回看摘要"));

        let saved = std::fs::read_to_string(&note_path).unwrap();
        assert_eq!(
            saved,
            "# Demo\n\n> 摘要：新的回看摘要\n\nBody"
        );
        assert!(!saved.contains("null"));
    }

    #[test]
    fn save_note_summary_clears_blank_input_across_file_and_indexes() {
        let root = tempdir().unwrap();
        let notes_dir = root.path().join("notes");
        std::fs::create_dir_all(&notes_dir).unwrap();
        let note_path = notes_dir.join("demo.md");
        std::fs::write(
            &note_path,
            "---\ntitle: Demo\nsummary: 旧摘要\n---\n\n# Demo\n\nBody",
        )
        .unwrap();

        let db_dir = tempdir().unwrap();
        let conn = open_and_migrate(&db_dir.path().join("test.sqlite")).unwrap();
        seed_note(&conn, "notes/demo.md", "Demo", "Body");

        let note = save_note_summary_in_conn(&conn, root.path(), "notes/demo.md", "   ").unwrap();

        assert_eq!(note.summary, None);

        let saved = std::fs::read_to_string(&note_path).unwrap();
        assert_eq!(saved, "---\ntitle: Demo\n---\n\n# Demo\n\nBody");
        assert!(!saved.contains("summary:"));

        let notes_summary: Option<String> = conn
            .query_row(
                "SELECT summary FROM notes WHERE path = ?1",
                params!["notes/demo.md"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(notes_summary, None);

        let fts_summary: String = conn
            .query_row(
                "SELECT summary FROM note_fts WHERE note_id = 'note-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fts_summary, "");

        let fts_matches: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM note_fts WHERE note_fts MATCH ?1",
                params!["旧摘要"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fts_matches, 0);
    }

    #[test]
    fn save_note_summary_rolls_back_file_when_reindex_fails() {
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

        let err = save_note_summary_in_conn(&conn, root.path(), "notes/demo.md", "新的回看摘要")
            .unwrap_err();

        assert!(matches!(err, crate::error::AppError::Database(_)));
        let restored = std::fs::read_to_string(&note_path).unwrap();
        assert_eq!(restored, original_content);

        let summary: Option<String> = conn
            .query_row(
                "SELECT summary FROM notes WHERE path = ?1",
                params!["notes/demo.md"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(summary, None);
    }
}