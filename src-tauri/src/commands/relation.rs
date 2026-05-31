use crate::domain::relation::{NoteRelations, Relation};
use crate::error::AppError;
use crate::services::relation::{create_relation_in_conn, delete_relation_in_conn, list_relations_in_conn};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn create_relation(
    state: State<'_, AppState>,
    source_note_id: String,
    target_note_id: String,
    relation_type: String,
    description: Option<String>,
) -> Result<Relation, AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    create_relation_in_conn(conn, &source_note_id, &target_note_id, &relation_type, description)
}

#[tauri::command]
pub async fn delete_relation(
    state: State<'_, AppState>,
    relation_id: String,
) -> Result<(), AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    delete_relation_in_conn(conn, &relation_id)
}

#[tauri::command]
pub async fn list_relations(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<NoteRelations, AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    list_relations_in_conn(conn, &note_id)
}