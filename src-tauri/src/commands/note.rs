use crate::domain::note::{
    CreateNoteInput, CreateNotebookInput, MarkdownImportRequest, MarkdownImportResult, Note,
    NoteDetail, NoteOutlineItem, NoteTreeNode, RenameNotebookResult, SaveNoteInput,
    SaveNoteResult, InsertImageResult,
};
use crate::error::AppError;
use crate::services::note::{
    create_note_service, create_notebook_service, delete_note_service, delete_notebook_service,
    get_note_by_path_service, get_note_outline_service, get_note_tree_service,
    import_markdown_sources_service, import_note_service, insert_image_for_note_from_selected_path,
    insert_pasted_image_for_note_from_bytes, insert_pasted_image_for_note_from_native_clipboard,
    move_note_in_root, read_clipboard_text_for_paste_in_root, rename_note_service, rewrite_pasted_remote_images_in_text,
    rename_notebook_service,
    reorder_notebooks_service, save_note_service,
    update_notebook_visual_service,
};
use crate::state::AppState;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;
use ulid::Ulid;

#[derive(serde::Serialize)]
pub struct RewritePastedRemoteImagesResult {
    text: String,
}

async fn pick_image_file(app: &AppHandle) -> Result<Option<std::path::PathBuf>, AppError> {
    let (sender, receiver) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"])
        .pick_file(move |file_path| {
            let result = file_path.map(|value| {
                value.into_path().map_err(|error| {
                    AppError::InvalidInput(format!("Invalid selected image path: {}", error))
                })
            });
            let _ = sender.send(result);
        });

    match receiver.await {
        Ok(Some(Ok(path))) => Ok(Some(path)),
        Ok(Some(Err(error))) => Err(error),
        Ok(None) => Ok(None),
        Err(_) => Err(AppError::Io("Image picker did not return a selection".into())),
    }
}

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
pub async fn get_note_outline(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<NoteOutlineItem>, AppError> {
    get_note_outline_service(&state, &path)
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
pub async fn import_markdown_sources(
    state: State<'_, AppState>,
    request: MarkdownImportRequest,
) -> Result<MarkdownImportResult, AppError> {
    import_markdown_sources_service(&state, request)
}

#[tauri::command]
pub async fn insert_image_for_note(
    state: State<'_, AppState>,
    app: AppHandle,
    note_path: String,
) -> Result<Option<InsertImageResult>, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let selected_path = pick_image_file(&app).await?;
    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let random_source = Ulid::new().to_string().to_ascii_lowercase();
    let random_suffix = random_source.chars().take(6).collect::<String>();

    insert_image_for_note_from_selected_path(
        &root,
        &note_path,
        selected_path.as_deref(),
        &timestamp,
        &random_suffix,
    )
}

#[tauri::command]
pub async fn insert_pasted_image_for_note(
    state: State<'_, AppState>,
    note_path: String,
    mime_type: String,
    image_bytes: Vec<u8>,
) -> Result<InsertImageResult, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let random_source = Ulid::new().to_string().to_ascii_lowercase();
    let random_suffix = random_source.chars().take(6).collect::<String>();

    insert_pasted_image_for_note_from_bytes(
        &root,
        &note_path,
        &mime_type,
        &image_bytes,
        &timestamp,
        &random_suffix,
    )
}

#[tauri::command]
pub async fn insert_pasted_image_from_clipboard_for_note(
    state: State<'_, AppState>,
    note_path: String,
) -> Result<Option<InsertImageResult>, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let random_source = Ulid::new().to_string().to_ascii_lowercase();
    let random_suffix = random_source.chars().take(6).collect::<String>();

    let result = insert_pasted_image_for_note_from_native_clipboard(
        &root,
        &note_path,
        &timestamp,
        &random_suffix,
    )?;

    Ok(result)
}

#[tauri::command]
pub async fn rewrite_pasted_remote_images(
    state: State<'_, AppState>,
    note_path: String,
    text: String,
) -> Result<RewritePastedRemoteImagesResult, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let random_source = Ulid::new().to_string().to_ascii_lowercase();
    let random_suffix = random_source.chars().take(6).collect::<String>();

    let rewritten = rewrite_pasted_remote_images_in_text(
        &root,
        &note_path,
        &text,
        &timestamp,
        &random_suffix,
    ).await?;

    Ok(RewritePastedRemoteImagesResult { text: rewritten })
}

#[tauri::command]
pub async fn read_clipboard_text_for_paste(
    state: State<'_, AppState>,
    note_path: String,
) -> Result<Option<RewritePastedRemoteImagesResult>, AppError> {
    let root = {
        let root_guard = state.kb_root_guard();
        root_guard
            .as_ref()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
            .clone()
    };

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let random_source = Ulid::new().to_string().to_ascii_lowercase();
    let random_suffix = random_source.chars().take(6).collect::<String>();

    let text = read_clipboard_text_for_paste_in_root(
        &root,
        &note_path,
        &timestamp,
        &random_suffix,
    ).await?;

    Ok(text.map(|text| RewritePastedRemoteImagesResult { text }))
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
pub async fn rename_note(
    state: State<'_, AppState>,
    note_path: String,
    new_name: String,
) -> Result<Note, AppError> {
    rename_note_service(&state, &note_path, &new_name)
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
pub async fn delete_note(
    state: State<'_, AppState>,
    note_path: String,
) -> Result<(), AppError> {
    delete_note_service(&state, &note_path)
}

#[tauri::command]
pub async fn reorder_notebooks(
    state: State<'_, AppState>,
    ordered_paths: Vec<String>,
) -> Result<(), AppError> {
    reorder_notebooks_service(&state, &ordered_paths)
}
