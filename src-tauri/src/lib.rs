pub mod commands;
pub mod domain;
pub mod error;
pub mod infrastructure;
pub mod services;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::knowledge_base::create_knowledge_base,
            commands::knowledge_base::open_knowledge_base,
            commands::note::create_note,
            commands::note::create_notebook,
            commands::note::get_note_by_path,
            commands::note::save_note,
            commands::note::get_note_tree,
            commands::note::import_note,
            commands::note::move_note,
            commands::note::rename_notebook,
            commands::note::update_notebook_visual,
            commands::note::delete_notebook,
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
            commands::summary::save_note_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
