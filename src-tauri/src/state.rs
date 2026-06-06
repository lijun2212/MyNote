// src-tauri/src/state.rs
use crate::services::watcher::WatcherHandle;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

fn lock_or_recover<'a, T>(mutex: &'a Mutex<T>, name: &str) -> MutexGuard<'a, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("[mynote] recovering poisoned mutex: {name}");
            poisoned.into_inner()
        }
    }
}

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

    pub fn kb_root_guard(&self) -> MutexGuard<'_, Option<PathBuf>> {
        lock_or_recover(&self.kb_root, "kb_root")
    }

    pub fn db_guard(&self) -> MutexGuard<'_, Option<Connection>> {
        lock_or_recover(&self.db, "db")
    }

    pub fn watcher_guard(&self) -> MutexGuard<'_, Option<WatcherHandle>> {
        lock_or_recover(&self.watcher, "watcher")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::panic::{catch_unwind, AssertUnwindSafe};

    #[test]
    fn kb_root_guard_recovers_after_poison() {
        let state = AppState {
            kb_root: Mutex::new(Some(PathBuf::from("/tmp/demo"))),
            db: Mutex::new(None),
            watcher: Mutex::new(None),
        };

        let _ = catch_unwind(AssertUnwindSafe(|| {
            let _guard = state.kb_root.lock().unwrap();
            panic!("poison kb_root");
        }));

        let guard = state.kb_root_guard();
        assert_eq!(guard.as_deref(), Some(PathBuf::from("/tmp/demo").as_path()));
    }

    #[test]
    fn db_guard_recovers_after_poison() {
        let state = AppState {
            kb_root: Mutex::new(None),
            db: Mutex::new(Some(Connection::open_in_memory().unwrap())),
            watcher: Mutex::new(None),
        };

        let _ = catch_unwind(AssertUnwindSafe(|| {
            let _guard = state.db.lock().unwrap();
            panic!("poison db");
        }));

        let guard = state.db_guard();
        assert!(guard.is_some());
    }
}
