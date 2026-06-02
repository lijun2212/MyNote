use crate::domain::note::{CreateNoteInput, CreateNotebookInput, Note, NoteDetail, NoteTreeNode, SaveNoteInput, SaveNoteResult};
use crate::error::AppError;
use crate::services::note::{create_note_service, create_notebook_service, get_note_by_path_service, get_note_tree_service, import_note_service, move_note_in_root, save_note_service};
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
pub async fn create_notebook(
    state: State<'_, AppState>,
    name: String,
) -> Result<String, AppError> {
    create_notebook_service(&state, CreateNotebookInput { name })
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

#[tauri::command]
pub async fn import_note(
    state: State<'_, AppState>,
    src_path: String,
    dest_directory: String,
) -> Result<crate::domain::note::Note, AppError> {
    import_note_service(&state, &src_path, &dest_directory)
}

#[tauri::command]
pub async fn move_note(
    state: State<'_, AppState>,
    source_path: String,
    target_directory: String,
) -> Result<Note, AppError> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    move_note_in_root(conn, &root, &source_path, &target_directory)
}
