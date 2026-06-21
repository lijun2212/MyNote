pub mod commands;
pub mod domain;
pub mod error;
pub mod infrastructure;
pub mod services;
pub mod state;

use state::AppState;
use tauri::Manager;

const MAIN_WINDOW_LABEL: &str = "main";
const PROJECTION_WINDOW_LABEL: &str = "projection-preview";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ManagedWindowLifecycleEvent {
    CloseRequested,
    Destroyed,
    Other,
}

fn classify_window_lifecycle_event(event: &tauri::WindowEvent) -> ManagedWindowLifecycleEvent {
    match event {
        tauri::WindowEvent::CloseRequested { .. } => ManagedWindowLifecycleEvent::CloseRequested,
        tauri::WindowEvent::Destroyed => ManagedWindowLifecycleEvent::Destroyed,
        _ => ManagedWindowLifecycleEvent::Other,
    }
}

fn should_close_projection_with_main_window(
    window_label: &str,
    event: ManagedWindowLifecycleEvent,
) -> bool {
    window_label == MAIN_WINDOW_LABEL
        && matches!(
            event,
            ManagedWindowLifecycleEvent::CloseRequested | ManagedWindowLifecycleEvent::Destroyed
        )
}

fn close_projection_with_main_window<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    if !should_close_projection_with_main_window(
        window.label(),
        classify_window_lifecycle_event(event),
    ) {
        return;
    }

    if let Some(projection_window) = window.app_handle().get_webview_window(PROJECTION_WINDOW_LABEL)
    {
        let _ = projection_window.close();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::knowledge_base::create_knowledge_base,
            commands::knowledge_base::open_knowledge_base,
            commands::ai::get_ai_settings,
            commands::ai::upsert_ai_profile,
            commands::ai::save_ai_settings,
            commands::ai::set_ai_profile_secret,
            commands::ai::has_ai_profile_secret,
            commands::ai::test_ai_profile,
            commands::ai::test_ai_profile_input,
            commands::graph::get_note_graph_analysis,
            commands::graph::get_note_graph_candidates,
            commands::graph::generate_note_graph_candidates,
            commands::graph::accept_graph_candidate,
            commands::graph::ignore_graph_candidate,
            commands::note::create_note,
            commands::note::create_notebook,
            commands::note::get_note_by_path,
            commands::note::get_note_outline,
            commands::note::save_note,
            commands::note::get_note_tree,
            commands::note::import_note,
            commands::note::import_markdown_sources,
            commands::note::beautify_markdown,
            commands::note::beautify_markdown_stream,
            commands::note::insert_image_for_note,
            commands::note::insert_pasted_image_for_note,
            commands::note::insert_pasted_image_from_clipboard_for_note,
            commands::note::rewrite_pasted_remote_images,
            commands::note::read_clipboard_text_for_paste,
            commands::note::move_note,
            commands::note::rename_note,
            commands::note::rename_notebook,
            commands::note::update_notebook_visual,
            commands::note::delete_notebook,
            commands::note::delete_note,
            commands::note::reorder_notebooks,
            commands::tag::list_tags,
            commands::tag::list_notes_by_tag,
            commands::tag::delete_tag,
            commands::tag::get_tag_context,
            commands::link::get_note_links,
            commands::link::get_note_by_title,
            commands::relation::create_relation,
            commands::relation::delete_relation,
            commands::relation::list_relations,
            commands::search::search_notes,
            commands::summary::generate_summary_candidate,
            commands::summary::generate_summary_candidate_with_ai,
            commands::summary::generate_summary_candidate_with_ai_stream,
            commands::summary::save_note_summary,
        ])
        .on_window_event(close_projection_with_main_window)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{should_close_projection_with_main_window, ManagedWindowLifecycleEvent};

    #[test]
    fn closes_projection_when_main_window_close_is_requested() {
        assert!(should_close_projection_with_main_window(
            "main",
            ManagedWindowLifecycleEvent::CloseRequested,
        ));
    }

    #[test]
    fn closes_projection_when_main_window_is_destroyed() {
        assert!(should_close_projection_with_main_window(
            "main",
            ManagedWindowLifecycleEvent::Destroyed,
        ));
    }

    #[test]
    fn does_not_close_projection_for_other_main_window_events() {
        assert!(!should_close_projection_with_main_window(
            "main",
            ManagedWindowLifecycleEvent::Other,
        ));
    }

    #[test]
    fn does_not_close_projection_when_projection_window_closes_itself() {
        assert!(!should_close_projection_with_main_window(
            "projection-preview",
            ManagedWindowLifecycleEvent::CloseRequested,
        ));
    }
}
