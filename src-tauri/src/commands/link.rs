use crate::domain::link::{LinkItem, NoteLinks};
use crate::domain::note::Note;
use crate::error::AppError;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_note_links(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<NoteLinks, AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let mut outgoing_stmt = conn.prepare(
        "SELECT l.id, l.target_note_id, n.title, n.path, l.display_text, l.target_raw, l.link_type, l.resolved
         FROM links l
         LEFT JOIN notes n ON n.id = l.target_note_id AND n.deleted_at IS NULL
         WHERE l.source_note_id = ?1
         ORDER BY l.resolved DESC, n.title, l.target_raw",
    )?;
    let outgoing = outgoing_stmt
        .query_map([&note_id], |row| {
            Ok(LinkItem {
                id: row.get(0)?,
                note_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                note_title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                note_path: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                link_text: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                link_url: row.get(5)?,
                link_type: row.get(6)?,
                resolved: row.get::<_, i64>(7)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut incoming_stmt = conn.prepare(
        "SELECT l.id, l.source_note_id, n.title, n.path, l.display_text, l.target_raw, l.link_type, l.resolved
         FROM links l
         JOIN notes n ON n.id = l.source_note_id AND n.deleted_at IS NULL
         WHERE l.target_note_id = ?1
         ORDER BY n.title",
    )?;
    let incoming = incoming_stmt
        .query_map([&note_id], |row| {
            Ok(LinkItem {
                id: row.get(0)?,
                note_id: row.get(1)?,
                note_title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                note_path: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                link_text: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                link_url: row.get(5)?,
                link_type: row.get(6)?,
                resolved: row.get::<_, i64>(7)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(NoteLinks { outgoing, incoming })
}

#[tauri::command]
pub async fn get_note_by_title(
    state: State<'_, AppState>,
    title: String,
) -> Result<Option<Note>, AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let mut stmt = conn.prepare(
        "SELECT id, path, title, summary, content_hash, word_count, created_at, updated_at, indexed_at, deleted_at
         FROM notes
         WHERE title = ?1 AND deleted_at IS NULL
         LIMIT 1",
    )?;

    let result = stmt
        .query_map([&title], |row| {
            Ok(Note {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                summary: row.get(3)?,
                content_hash: row.get(4)?,
                word_count: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                indexed_at: row.get(8)?,
                deleted_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(result.into_iter().next())
}
