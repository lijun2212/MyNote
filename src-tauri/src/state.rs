// src-tauri/src/state.rs
use crate::services::watcher::WatcherHandle;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub kb_root: Mutex<Option<PathBuf>>,
    pub db: Mutex<Option<Connection>>,
    pub watcher: Mutex<Option<WatcherHandle>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            kb_root: Mutex::new(None),
            db: Mutex::new(None),
            watcher: Mutex::new(None),
        }
    }
}
