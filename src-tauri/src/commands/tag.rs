use crate::domain::tag::TagSummary;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> Result<Vec<TagSummary>, String> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or("No database open")?;

    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, COUNT(nt.note_id) as note_count
             FROM tags t
             LEFT JOIN note_tags nt ON nt.tag_id = t.id
             LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
             GROUP BY t.id
             ORDER BY note_count DESC, t.name ASC",
        )
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], |row| {
            Ok(TagSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                note_count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tags)
}

#[tauri::command]
pub fn list_notes_by_tag(
    tag_ids: Vec<String>,
    state: State<AppState>,
) -> Result<Vec<crate::domain::note::Note>, String> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or("No database open")?;

    if tag_ids.is_empty() {
        return Ok(vec![]);
    }

    // AND filter: note must have ALL specified tags
    let placeholders = tag_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "SELECT n.id, n.path, n.title, n.summary, n.content_hash, n.word_count,
                n.created_at, n.updated_at, n.indexed_at, n.deleted_at
         FROM notes n
         WHERE n.deleted_at IS NULL
           AND (SELECT COUNT(DISTINCT nt.tag_id) FROM note_tags nt
                WHERE nt.note_id = n.id AND nt.tag_id IN ({placeholders})) = {count}
         ORDER BY n.path",
        placeholders = placeholders,
        count = tag_ids.len()
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = tag_ids
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let notes = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(crate::domain::note::Note {
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
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(notes)
}
