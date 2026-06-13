use crate::domain::knowledge_base::KnowledgeBase;
use crate::error::{AppError, AppResult};
use crate::infrastructure::db::open_and_migrate;
use crate::services::note::migrate_local_conflict_files_in_root;
use crate::state::AppState;
use rusqlite::params;
use std::path::Path;
use tauri::State;
use ulid::Ulid;

fn open_knowledge_base_in_root(root: &Path) -> AppResult<(KnowledgeBase, rusqlite::Connection)> {
    let db_path = root.join(".mynote").join("index.sqlite");

    if !db_path.exists() {
        return Err(AppError::NotFound(format!(
            "Not a knowledge base: {}",
            root.display()
        )));
    }

    let conn = open_and_migrate(&db_path)?;
    let _ = migrate_local_conflict_files_in_root(&conn, root);

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

    Ok((kb, conn))
}

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
    let (kb, conn) = open_knowledge_base_in_root(root)?;

    *state.kb_root.lock().unwrap() = Some(root.to_path_buf());
    *state.db.lock().unwrap() = Some(conn);

    Ok(kb)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::index::index_note_full;
    use tempfile::TempDir;

    #[test]
    fn open_knowledge_base_service_migrates_legacy_local_conflict_files() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join("notes/work")).unwrap();
        std::fs::create_dir_all(root.path().join("assets")).unwrap();
        std::fs::create_dir_all(root.path().join(".mynote/backups")).unwrap();
        std::fs::create_dir_all(root.path().join(".mynote/logs")).unwrap();
        std::fs::create_dir_all(root.path().join(".mynote/tmp")).unwrap();
        std::fs::create_dir_all(root.path().join(".mynote/trash")).unwrap();

        let db_path = root.path().join(".mynote/index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        conn.execute(
            "INSERT INTO knowledge_base_meta (id, name, root_path, schema_version, created_at, updated_at)
             VALUES (?1, ?2, ?3, 1, 'now', 'now')",
            params!["kb-1", "Demo KB", root.path().to_string_lossy().to_string()],
        )
        .unwrap();

        let note_rel = "notes/work/demo.local-conflict.md";
        let note_content = "# conflict draft\n";
        std::fs::write(root.path().join(note_rel), note_content).unwrap();
        index_note_full(&conn, root.path(), note_rel, note_content).unwrap();
        drop(conn);

        let (kb, migrated_conn) = open_knowledge_base_in_root(root.path()).unwrap();

        assert_eq!(kb.name, "Demo KB");
        assert!(!root.path().join(note_rel).exists());

        let conflict_dir = root.path().join(".mynote/conflicts");
        let entries = std::fs::read_dir(&conflict_dir)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(std::fs::read_to_string(entries[0].path()).unwrap(), note_content);

        let visible_count: i64 = migrated_conn
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE path = ?1 AND deleted_at IS NULL",
                params![note_rel],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(visible_count, 0);
    }
}
