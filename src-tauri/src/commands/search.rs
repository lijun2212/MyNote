use crate::domain::search::SearchResult;
use crate::error::AppError;
use crate::state::AppState;
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

    let fts_query = format!("{}*", query);

    let mut stmt = conn.prepare(
        "SELECT n.id, n.title, n.path, snippet(note_fts, 2, '<mark>', '</mark>', '...', 20) as snippet
         FROM note_fts
         JOIN notes n ON note_fts.note_id = n.id AND n.deleted_at IS NULL AND n.kb_id = ?2
         WHERE note_fts MATCH ?1
         ORDER BY rank
         LIMIT 20",
    )?;

    let results = stmt
        .query_map(rusqlite::params![fts_query, kb_id], |row| {
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
