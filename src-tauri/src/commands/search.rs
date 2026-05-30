use crate::domain::search::SearchResult;
use crate::error::AppError;
use crate::state::AppState;
use rusqlite::Connection;
use tauri::State;

#[tauri::command]
pub async fn search_notes(
    state: State<'_, AppState>,
    query: String,
    kb_id: String,
) -> Result<Vec<SearchResult>, AppError> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let _ = kb_id;

    search_notes_in_conn(conn, &query)
}

fn search_notes_in_conn(conn: &Connection, query: &str) -> Result<Vec<SearchResult>, AppError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let fts_query = format!("\"{}\"*", trimmed.replace('"', "\"\""));
    let like_query = escape_like_query(trimmed);

    let mut stmt = conn.prepare(
        "WITH fts_matches AS (
             SELECT n.id, n.title, n.path,
                    snippet(note_fts, 2, '<mark>', '</mark>', '...', 20) AS snippet,
                    rank,
                    0 AS source_order
             FROM note_fts
             JOIN notes n ON note_fts.note_id = n.id AND n.deleted_at IS NULL
             WHERE note_fts MATCH ?1
         ),
         metadata_matches AS (
             SELECT n.id, n.title, n.path,
                    n.title AS snippet,
                    0.0 AS rank,
                    1 AS source_order
             FROM notes n
             WHERE n.deleted_at IS NULL
               AND (
                   n.title LIKE ?2 ESCAPE '\\'
                   OR n.path LIKE ?2 ESCAPE '\\'
               )
               AND n.id NOT IN (SELECT id FROM fts_matches)
         )
         SELECT id, title, path, snippet
         FROM (
             SELECT * FROM fts_matches
             UNION ALL
             SELECT * FROM metadata_matches
         )
         ORDER BY source_order, rank
         LIMIT 20",
    )?;

    let results = stmt
        .query_map(rusqlite::params![fts_query, like_query], |row| {
            Ok(SearchResult {
                note_id: row.get(0)?,
                title: row.get(1)?,
                path: row.get(2)?,
                snippet: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(results)
}

fn escape_like_query(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len() + 2);
    escaped.push('%');
    for ch in query.chars() {
        if matches!(ch, '%' | '_' | '\\') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped.push('%');
    escaped
}

#[cfg(test)]
mod tests {
    use super::search_notes_in_conn;
    use rusqlite::Connection;

    fn setup_search_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE notes (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                deleted_at TEXT
            );
            CREATE VIRTUAL TABLE note_fts USING fts5(
                note_id UNINDEXED,
                title,
                summary,
                body,
                tokenize = 'unicode61'
            );",
        ).unwrap();
        conn
    }

    #[test]
    fn search_notes_matches_imported_filename_substrings() {
        let conn = setup_search_db();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["n1", "notes/项目扫描汇总报告-1.md", "项目扫描汇总报告-1"],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
            rusqlite::params!["n1", "项目扫描汇总报告-1", "导入的正文"],
        ).unwrap();

        let results = search_notes_in_conn(&conn, "扫描").unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "notes/项目扫描汇总报告-1.md");
    }

    #[test]
    fn search_notes_treats_like_wildcards_as_literals() {
        let conn = setup_search_db();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["n1", "notes/100-percent.md", "100% Plan"],
        ).unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["n2", "notes/plain.md", "Plain Plan"],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', '')",
            rusqlite::params!["n1", "100% Plan"],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', '')",
            rusqlite::params!["n2", "Plain Plan"],
        ).unwrap();

        let results = search_notes_in_conn(&conn, "%").unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].note_id, "n1");
    }

    #[test]
    fn search_notes_matches_body_fts_prefix() {
        let conn = setup_search_db();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["n1", "notes/neutral.md", "Neutral Note"],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
            rusqlite::params!["n1", "Neutral Note", "sqlite performance tuning"],
        ).unwrap();

        let results = search_notes_in_conn(&conn, "perform").unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].note_id, "n1");
    }

    #[test]
    fn search_notes_does_not_scan_body_substrings_in_fallback() {
        let conn = setup_search_db();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["n1", "notes/neutral.md", "Neutral Note"],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
            rusqlite::params!["n1", "Neutral Note", "bodyonlysubstring"],
        ).unwrap();

        let results = search_notes_in_conn(&conn, "onlysub").unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn search_notes_does_not_scan_summary_substrings_in_fallback() {
        let conn = setup_search_db();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["n1", "notes/neutral.md", "Neutral Note"],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, ?3, '')",
            rusqlite::params!["n1", "Neutral Note", "summarycontainsneedle"],
        ).unwrap();

        let results = search_notes_in_conn(&conn, "needle").unwrap();

        assert!(results.is_empty());
    }
}
