use crate::domain::knowledge_base::KnowledgeBase;
use crate::error::AppError;
use crate::services::knowledge_base::{create_knowledge_base_service, open_knowledge_base_service};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn create_knowledge_base(
    state: State<'_, AppState>,
    root_path: String,
    name: String,
) -> Result<KnowledgeBase, AppError> {
    create_knowledge_base_service(&state, &root_path, &name)
}

#[tauri::command]
pub async fn open_knowledge_base(
    state: State<'_, AppState>,
    root_path: String,
) -> Result<KnowledgeBase, AppError> {
    open_knowledge_base_service(&state, &root_path)
}
