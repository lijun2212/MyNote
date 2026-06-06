use crate::domain::note::{
    CreateNoteInput, CreateNotebookInput, Note, NoteDetail, NoteTreeNode,
    RenameNotebookResult, SaveNoteInput, SaveNoteResult,
};
use crate::error::AppError;
use crate::services::note::{
    create_note_service, create_notebook_service, delete_notebook_service,
    get_note_by_path_service, get_note_tree_service, import_note_service, move_note_in_root,
    rename_notebook_service, reorder_notebooks_service, save_note_service,
    update_notebook_visual_service,
};
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
    icon: String,
    color: String,
) -> Result<String, AppError> {
    create_notebook_service(&state, CreateNotebookInput { name, icon, color })
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
    println!(
        "[mynote:note-drag] command move_note source_path={} target_directory={}",
        source_path, target_directory
    );

    let root_guard = state.kb_root_guard();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    move_note_in_root(conn, &root, &source_path, &target_directory)
}

#[tauri::command]
pub async fn rename_notebook(
    state: State<'_, AppState>,
    old_path: String,
    new_name: String,
) -> Result<RenameNotebookResult, AppError> {
    rename_notebook_service(&state, &old_path, &new_name)
}

#[tauri::command]
pub async fn update_notebook_visual(
    state: State<'_, AppState>,
    notebook_path: String,
    icon: String,
    color: String,
) -> Result<(), AppError> {
    update_notebook_visual_service(&state, &notebook_path, &icon, &color)
}

#[tauri::command]
pub async fn delete_notebook(
    state: State<'_, AppState>,
    notebook_path: String,
) -> Result<(), AppError> {
    delete_notebook_service(&state, &notebook_path)
}

#[tauri::command]
pub async fn reorder_notebooks(
    state: State<'_, AppState>,
    ordered_paths: Vec<String>,
) -> Result<(), AppError> {
    reorder_notebooks_service(&state, &ordered_paths)
}
