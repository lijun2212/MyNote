use crate::domain::knowledge_base::KnowledgeBase;
use crate::error::AppError;
use crate::services::knowledge_base::{create_knowledge_base_service, open_knowledge_base_service};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn create_knowledge_base(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    root_path: String,
    name: String,
) -> Result<KnowledgeBase, AppError> {
    let kb = create_knowledge_base_service(&state, &root_path, &name)?;
    // Start file watcher
    {
        let root_guard = state.kb_root.lock().unwrap();
        if let Some(root) = root_guard.as_ref() {
            match crate::services::watcher::start_watching(root.clone(), app_handle.clone()) {
                Ok(handle) => {
                    let mut w = state.watcher.lock().unwrap();
                    *w = Some(handle);
                }
                Err(e) => eprintln!("[watcher] failed to start: {}", e),
            }
        }
    }
    Ok(kb)
}

#[tauri::command]
pub async fn open_knowledge_base(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    root_path: String,
) -> Result<KnowledgeBase, AppError> {
    let kb = open_knowledge_base_service(&state, &root_path)?;
    // Start file watcher
    {
        let root_guard = state.kb_root.lock().unwrap();
        if let Some(root) = root_guard.as_ref() {
            match crate::services::watcher::start_watching(root.clone(), app_handle.clone()) {
                Ok(handle) => {
                    let mut w = state.watcher.lock().unwrap();
                    *w = Some(handle);
                }
                Err(e) => eprintln!("[watcher] failed to start: {}", e),
            }
        }
    }
    Ok(kb)
}
