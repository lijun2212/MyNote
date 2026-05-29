use crate::domain::note::{CreateNoteInput, NoteDetail, NoteTreeNode, SaveNoteInput, SaveNoteResult};
use crate::error::AppError;
use crate::services::note::{create_note_service, get_note_by_path_service, get_note_tree_service, save_note_service};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn create_note(
    state: State<'_, AppState>,
    directory: String,
    title: String,
) -> Result<crate::domain::note::Note, AppError> {
    create_note_service(&state, CreateNoteInput { directory, title })
}

#[tauri::command]
pub async fn get_note_by_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<NoteDetail, AppError> {
    get_note_by_path_service(&state, &path)
}

#[tauri::command]
pub async fn save_note(
    state: State<'_, AppState>,
    note_id: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<SaveNoteResult, AppError> {
    save_note_service(&state, SaveNoteInput { note_id, content, expected_hash })
}

#[tauri::command]
pub async fn get_note_tree(
    state: State<'_, AppState>,
) -> Result<Vec<NoteTreeNode>, AppError> {
    get_note_tree_service(&state)
}
