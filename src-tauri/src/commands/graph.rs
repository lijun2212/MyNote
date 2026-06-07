use crate::domain::graph::{GraphCandidateRelation, NoteGraphAnalysis};
use crate::domain::relation::Relation;
use crate::error::AppError;
use crate::services::graph::{
    accept_graph_candidate_in_conn, analyze_note_graph_in_conn, generate_graph_candidates,
    ignore_graph_candidate_in_conn, list_graph_candidates_in_conn,
};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_note_graph_analysis(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<NoteGraphAnalysis, AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    analyze_note_graph_in_conn(conn, &note_id)
}

#[tauri::command]
pub async fn get_note_graph_candidates(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<Vec<GraphCandidateRelation>, AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    list_graph_candidates_in_conn(conn, &note_id)
}

#[tauri::command]
pub async fn generate_note_graph_candidates(
    state: State<'_, AppState>,
    note_id: String,
    profile_id: Option<String>,
) -> Result<Vec<GraphCandidateRelation>, AppError> {
    generate_graph_candidates(&state, &note_id, profile_id.as_deref()).await
}

#[tauri::command]
pub async fn accept_graph_candidate(
    state: State<'_, AppState>,
    candidate_id: String,
    relation_type: Option<String>,
    description: Option<String>,
) -> Result<Relation, AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    accept_graph_candidate_in_conn(conn, &candidate_id, relation_type, description)
}

#[tauri::command]
pub async fn ignore_graph_candidate(
    state: State<'_, AppState>,
    candidate_id: String,
) -> Result<(), AppError> {
    let db_guard = state.db_guard();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    ignore_graph_candidate_in_conn(conn, &candidate_id)
}