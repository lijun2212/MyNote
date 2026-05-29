use crate::domain::knowledge_base::KnowledgeBase;
use crate::error::{AppError, AppResult};
use crate::infrastructure::db::open_and_migrate;
use crate::state::AppState;
use rusqlite::params;
use std::path::Path;
use tauri::State;
use ulid::Ulid;

pub fn create_knowledge_base_service(
    state: &State<AppState>,
    root_path: &str,
    name: &str,
) -> AppResult<KnowledgeBase> {
    let root = Path::new(root_path);
    if !root.exists() {
        std::fs::create_dir_all(root)?;
    }

    // Create directory structure
    std::fs::create_dir_all(root.join("notes"))?;
    std::fs::create_dir_all(root.join("assets"))?;
    let mynote_dir = root.join(".mynote");
    std::fs::create_dir_all(mynote_dir.join("backups"))?;
    std::fs::create_dir_all(mynote_dir.join("logs"))?;
    std::fs::create_dir_all(mynote_dir.join("tmp"))?;
    std::fs::create_dir_all(mynote_dir.join("trash"))?;

    let db_path = mynote_dir.join("index.sqlite");
    let conn = open_and_migrate(&db_path)?;

    let id = Ulid::new().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT OR IGNORE INTO knowledge_base_meta (id, name, root_path, schema_version, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?5)",
        params![id, name, root_path, now, now],
    )?;

    let kb = KnowledgeBase {
        id,
        name: name.to_string(),
        root_path: root_path.to_string(),
        created_at: now.clone(),
        updated_at: now,
    };

    *state.kb_root.lock().unwrap() = Some(root.to_path_buf());
    *state.db.lock().unwrap() = Some(conn);

    Ok(kb)
}

pub fn open_knowledge_base_service(
    state: &State<AppState>,
    root_path: &str,
) -> AppResult<KnowledgeBase> {
    let root = Path::new(root_path);
    let db_path = root.join(".mynote").join("index.sqlite");

    if !db_path.exists() {
        return Err(AppError::NotFound(format!(
            "Not a knowledge base: {}",
            root_path
        )));
    }

    let conn = open_and_migrate(&db_path)?;

    let kb = conn.query_row(
        "SELECT id, name, root_path, created_at, updated_at FROM knowledge_base_meta LIMIT 1",
        [],
        |row| {
            Ok(KnowledgeBase {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    ).map_err(|_| AppError::NotFound("No knowledge base metadata found".into()))?;

    *state.kb_root.lock().unwrap() = Some(root.to_path_buf());
    *state.db.lock().unwrap() = Some(conn);

    Ok(kb)
}
