// src-tauri/src/infrastructure/db.rs
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, params};
use std::path::Path;

/// 打开 SQLite 数据库并执行所有 schema 迁移
pub fn open_and_migrate(db_path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(db_path).map_err(|e| AppError::Database(e.to_string()))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn run_migrations(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT    NOT NULL,
            applied_at TEXT    NOT NULL
        );",
    )?;

    let applied: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |r| r.get(0),
    )?;

    for (version, name, sql) in MIGRATIONS {
        if *version > applied {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, datetime('now'))",
                params![version, name],
            )?;
        }
    }
    Ok(())
}

const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "create_knowledge_base_meta",
        "CREATE TABLE IF NOT EXISTS knowledge_base_meta (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            root_path  TEXT NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    ),
    (
        2,
        "create_notes",
        "CREATE TABLE IF NOT EXISTS notes (
            id               TEXT PRIMARY KEY,
            path             TEXT NOT NULL UNIQUE,
            title            TEXT NOT NULL,
            summary          TEXT,
            content_hash     TEXT NOT NULL,
            word_count       INTEGER NOT NULL DEFAULT 0,
            front_matter_json TEXT NOT NULL DEFAULT '{}',
            created_at       TEXT NOT NULL,
            updated_at       TEXT NOT NULL,
            indexed_at       TEXT NOT NULL,
            deleted_at       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_notes_path ON notes(path);
        CREATE INDEX IF NOT EXISTS idx_notes_title ON notes(title);
        CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at);",
    ),
    (
        3,
        "create_settings",
        "CREATE TABLE IF NOT EXISTS settings (
            scope      TEXT NOT NULL,
            key        TEXT NOT NULL,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (scope, key)
        );",
    ),
    (
        4,
        "create_note_fts",
        "CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
            note_id UNINDEXED,
            title,
            summary,
            body,
            tokenize = 'unicode61'
        );",
    ),
];

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_open_and_migrate_creates_tables() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("test.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 4);

        conn.execute_batch("INSERT INTO notes (id,path,title,content_hash,word_count,front_matter_json,created_at,updated_at,indexed_at) VALUES ('x','a.md','T','h',0,'{}','2024','2024','2024')").unwrap();
    }

    #[test]
    fn test_migrations_are_idempotent() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("idem.sqlite");
        open_and_migrate(&db_path).unwrap();
        open_and_migrate(&db_path).unwrap();
    }
}
