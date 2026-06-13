use crate::services::index::{mark_note_deleted_by_path, reindex_from_path};
use crate::state::AppState;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

fn is_local_conflict_path(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".local-conflict.md"))
}

pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
}

/// Start file watching. Watches <root>/notes/ directory, 500ms debounce,
/// reindexes changed files and emits "note:index_updated" event.
pub fn start_watching(root: PathBuf, app_handle: AppHandle) -> Result<WatcherHandle, String> {
    let notes_dir = root.join("notes");
    if !notes_dir.exists() {
        return Err(format!("notes dir not found: {}", notes_dir.display()));
    }

    let debounce: Arc<Mutex<HashMap<PathBuf, Instant>>> = Arc::new(Mutex::new(HashMap::new()));
    let debounce_clone = debounce.clone();
    let app_clone = app_handle.clone();
    let root_clone = root.clone();

    let (tx, rx) = std::sync::mpsc::channel::<Result<Event, notify::Error>>();

    std::thread::spawn(move || {
        let debounce_ms = Duration::from_millis(500);
        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(event)) => {
                    let should_process = matches!(
                        event.kind,
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                    );
                    let paths: Vec<PathBuf> = event
                        .paths
                        .into_iter()
                        .filter(|p| p.extension().map(|e| e == "md").unwrap_or(false))
                        .filter(|p| !is_local_conflict_path(p))
                        .collect();
                    if paths.is_empty() || !should_process {
                        continue;
                    }
                    let mut map = debounce_clone.lock().unwrap();
                    for path in paths {
                        map.insert(path, Instant::now());
                    }
                }
                Ok(Err(e)) => eprintln!("[watcher] error: {:?}", e),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }

            // Process debounced events
            let now = Instant::now();
            let mut to_process: Vec<PathBuf> = Vec::new();
            {
                let mut map = debounce_clone.lock().unwrap();
                map.retain(|path, last_event| {
                    if now.duration_since(*last_event) >= debounce_ms {
                        to_process.push(path.clone());
                        false
                    } else {
                        true
                    }
                });
            }

            for abs_path in to_process {
                if let Ok(rel) = abs_path.strip_prefix(&root_clone) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    let state = app_clone.state::<AppState>();
                    let db_guard = state.db.lock().unwrap();
                    if let Some(conn) = db_guard.as_ref() {
                        let result = if abs_path.exists() {
                            reindex_from_path(conn, &root_clone, &rel_str).map(|_| ())
                        } else {
                            mark_note_deleted_by_path(conn, &rel_str)
                        };
                        match result {
                            Ok(_) => {
                                let _ = app_clone.emit("note:index_updated", &rel_str);
                            }
                            Err(e) => eprintln!("[watcher] sync error {}: {:?}", rel_str, e),
                        }
                    }
                }
            }
        }
    });

    let mut watcher =
        RecommendedWatcher::new(tx, Config::default()).map_err(|e| e.to_string())?;
    watcher
        .watch(&notes_dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    Ok(WatcherHandle { _watcher: watcher })
}
