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
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::knowledge_base::create_knowledge_base,
            commands::knowledge_base::open_knowledge_base,
            commands::note::create_note,
            commands::note::get_note_by_path,
            commands::note::save_note,
            commands::note::get_note_tree,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
