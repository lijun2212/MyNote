// src-tauri/src/state.rs
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub kb_root: Mutex<Option<PathBuf>>,
    pub db: Mutex<Option<Connection>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            kb_root: Mutex::new(None),
            db: Mutex::new(None),
        }
    }
}
