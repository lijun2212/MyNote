// src-tauri/src/infrastructure/db.rs
use crate::error::{AppError, AppResult};
use crate::infrastructure::hash::sha256_str;
use rusqlite::{Connection, params};
use std::path::Path;

#[derive(Debug, Clone, Copy)]
struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

#[derive(Debug)]
struct AppliedMigration {
    version: i64,
    name: String,
    checksum: String,
    status: String,
}

fn migration_checksum(migration: &Migration) -> String {
    sha256_str(&format!(
        "{}\n{}\n{}",
        migration.version, migration.name, migration.sql
    ))
}

fn migration_error(message: impl Into<String>) -> AppError {
    AppError::Database(message.into())
}

/// 打开 SQLite 数据库并执行所有 schema 迁移
pub fn open_and_migrate(db_path: &Path) -> AppResult<Connection> {
    let mut conn = Connection::open(db_path).map_err(|e| AppError::Database(e.to_string()))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    run_migrations(&mut conn, MIGRATIONS)?;
    Ok(conn)
}

fn ensure_schema_migrations_table(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT    NOT NULL,
            checksum   TEXT    NOT NULL DEFAULT '',
            status     TEXT    NOT NULL DEFAULT 'applied',
            applied_at TEXT    NOT NULL
        );",
    )?;
    Ok(())
}

fn has_schema_migration_column(conn: &Connection, column_name: &str) -> AppResult<bool> {
    let mut stmt = conn.prepare("PRAGMA table_info(schema_migrations)")?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;

    for column in columns {
        if column? == column_name {
            return Ok(true);
        }
    }

    Ok(false)
}

fn ensure_schema_migrations_columns(conn: &Connection) -> AppResult<()> {
    if !has_schema_migration_column(conn, "checksum")? {
        conn.execute_batch(
            "ALTER TABLE schema_migrations ADD COLUMN checksum TEXT NOT NULL DEFAULT '';",
        )?;
    }

    if !has_schema_migration_column(conn, "status")? {
        conn.execute_batch(
            "ALTER TABLE schema_migrations ADD COLUMN status TEXT NOT NULL DEFAULT 'applied';",
        )?;
    }

    Ok(())
}

fn load_applied_migrations(conn: &Connection) -> AppResult<Vec<AppliedMigration>> {
    let mut stmt = conn.prepare(
        "SELECT version, name, checksum, status FROM schema_migrations ORDER BY version",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AppliedMigration {
            version: row.get(0)?,
            name: row.get(1)?,
            checksum: row.get(2)?,
            status: row.get(3)?,
        })
    })?;

    let mut applied = Vec::new();
    for row in rows {
        applied.push(row?);
    }

    Ok(applied)
}

fn migration_by_version(migrations: &[Migration], version: i64) -> Option<&Migration> {
    migrations
        .iter()
        .find(|migration| migration.version == version)
}

fn backfill_legacy_migration_checksums(
    conn: &Connection,
    migrations: &[Migration],
) -> AppResult<()> {
    for applied in load_applied_migrations(conn)? {
        let migration = migration_by_version(migrations, applied.version).ok_or_else(|| {
            migration_error(format!(
                "Migration {} exists in database but not in current code",
                applied.version
            ))
        })?;

        if applied.name != migration.name {
            return Err(migration_error(format!(
                "Migration {} name mismatch: database has '{}', code has '{}'",
                applied.version, applied.name, migration.name
            )));
        }

        if applied.status != "applied" {
            return Err(migration_error(format!(
                "Migration {} has invalid status '{}'",
                applied.version, applied.status
            )));
        }

        if applied.checksum.is_empty() {
            conn.execute(
                "UPDATE schema_migrations SET checksum = ?1 WHERE version = ?2",
                params![migration_checksum(migration), applied.version],
            )?;
        }
    }

    Ok(())
}

fn run_migrations(conn: &mut Connection, migrations: &[Migration]) -> AppResult<()> {
    ensure_schema_migrations_table(conn)?;
    ensure_schema_migrations_columns(conn)?;
    backfill_legacy_migration_checksums(conn, migrations)?;

    let applied: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |r| r.get(0),
    )?;

    for migration in migrations {
        if migration.version > applied {
            conn.execute_batch(migration.sql)?;
            conn.execute(
                "INSERT INTO schema_migrations (version, name, checksum, status, applied_at) VALUES (?1, ?2, ?3, 'applied', datetime('now'))",
                params![migration.version, migration.name, migration_checksum(migration)],
            )?;
        }
    }
    Ok(())
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "create_knowledge_base_meta",
        sql: "CREATE TABLE IF NOT EXISTS knowledge_base_meta (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            root_path  TEXT NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    },
    Migration {
        version: 2,
        name: "create_notes",
        sql: "CREATE TABLE IF NOT EXISTS notes (
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
    },
    Migration {
        version: 3,
        name: "create_settings",
        sql: "CREATE TABLE IF NOT EXISTS settings (
            scope      TEXT NOT NULL,
            key        TEXT NOT NULL,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (scope, key)
        );",
    },
    Migration {
        version: 4,
        name: "create_note_fts",
        sql: "CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
            note_id UNINDEXED,
            title,
            summary,
            body,
            tokenize = 'unicode61'
        );",
    },
    Migration {
        version: 5,
        name: "create_tags",
        sql: "CREATE TABLE IF NOT EXISTS tags (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL UNIQUE,
            normalized_name TEXT NOT NULL UNIQUE,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );",
    },
    Migration {
        version: 6,
        name: "create_note_tags",
        sql: "CREATE TABLE IF NOT EXISTS note_tags (
            note_id TEXT NOT NULL,
            tag_id  TEXT NOT NULL,
            source  TEXT NOT NULL,
            PRIMARY KEY (note_id, tag_id, source),
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id);
        CREATE INDEX IF NOT EXISTS idx_note_tags_tag  ON note_tags(tag_id);",
    },
    Migration {
        version: 7,
        name: "create_links",
        sql: "CREATE TABLE IF NOT EXISTS links (
            id             TEXT PRIMARY KEY,
            source_note_id TEXT NOT NULL,
            target_note_id TEXT,
            target_raw     TEXT NOT NULL,
            display_text   TEXT,
            link_type      TEXT NOT NULL,
            anchor         TEXT,
            resolved       INTEGER NOT NULL DEFAULT 0,
            start_offset   INTEGER,
            end_offset     INTEGER,
            created_at     TEXT NOT NULL,
            updated_at     TEXT NOT NULL,
            FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
            FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_links_source   ON links(source_note_id);
        CREATE INDEX IF NOT EXISTS idx_links_target   ON links(target_note_id);
        CREATE INDEX IF NOT EXISTS idx_links_resolved ON links(resolved);",
    },
    Migration {
        version: 8,
        name: "create_file_events",
        sql: "CREATE TABLE IF NOT EXISTS file_events (
            id           TEXT PRIMARY KEY,
            event_type   TEXT NOT NULL,
            path         TEXT NOT NULL,
            old_path     TEXT,
            content_hash TEXT,
            processed    INTEGER NOT NULL DEFAULT 0,
            error        TEXT,
            created_at   TEXT NOT NULL,
            processed_at TEXT
        );",
    },
];

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn migration_rows(conn: &Connection) -> Vec<(i64, String, String, String)> {
        let mut stmt = conn
            .prepare("SELECT version, name, checksum, status FROM schema_migrations ORDER BY version")
            .unwrap();
        stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    }

    fn schema_migration_columns(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("PRAGMA table_info(schema_migrations)").unwrap();
        stmt.query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn test_migration_checksum_is_stable() {
        let migration = Migration {
            version: 1,
            name: "create_example",
            sql: "CREATE TABLE example (id TEXT PRIMARY KEY);",
        };

        assert_eq!(migration_checksum(&migration), migration_checksum(&migration));
        assert_eq!(migration_checksum(&migration).len(), 64);
    }

    #[test]
    fn test_migration_checksum_changes_when_name_or_sql_changes() {
        let base = Migration {
            version: 1,
            name: "create_example",
            sql: "CREATE TABLE example (id TEXT PRIMARY KEY);",
        };
        let renamed = Migration {
            version: 1,
            name: "create_example_renamed",
            sql: "CREATE TABLE example (id TEXT PRIMARY KEY);",
        };
        let changed_sql = Migration {
            version: 1,
            name: "create_example",
            sql: "CREATE TABLE example (id TEXT PRIMARY KEY, title TEXT);",
        };

        assert_ne!(migration_checksum(&base), migration_checksum(&renamed));
        assert_ne!(migration_checksum(&base), migration_checksum(&changed_sql));
    }

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
        assert_eq!(count, 8);

        let rows = migration_rows(&conn);
        assert_eq!(rows.len(), 8);
        assert!(rows.iter().all(|(_, _, checksum, _)| checksum.len() == 64));
        assert!(rows.iter().all(|(_, _, _, status)| status == "applied"));

        conn.execute_batch("INSERT INTO notes (id,path,title,content_hash,word_count,front_matter_json,created_at,updated_at,indexed_at) VALUES ('x','a.md','T','h',0,'{}','2024','2024','2024')").unwrap();
    }

    #[test]
    fn test_legacy_migrations_backfill_checksum_and_status() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("legacy.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
                version    INTEGER PRIMARY KEY,
                name       TEXT    NOT NULL,
                applied_at TEXT    NOT NULL
            );
            CREATE TABLE IF NOT EXISTS knowledge_base_meta (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                root_path  TEXT NOT NULL,
                schema_version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'create_knowledge_base_meta', datetime('now'))",
            [],
        )
        .unwrap();
        drop(conn);

        let conn = open_and_migrate(&db_path).unwrap();
        let columns = schema_migration_columns(&conn);
        assert!(columns.contains(&"checksum".to_string()));
        assert!(columns.contains(&"status".to_string()));

        let rows = migration_rows(&conn);
        assert_eq!(rows.len(), 8);
        assert!(rows.iter().all(|(_, _, checksum, _)| checksum.len() == 64));
        assert!(rows.iter().all(|(_, _, _, status)| status == "applied"));
        assert_eq!(rows[0].0, 1);
        assert_eq!(rows[0].1, "create_knowledge_base_meta");
    }

    #[test]
    fn test_migrations_are_idempotent() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("idem.sqlite");
        open_and_migrate(&db_path).unwrap();
        open_and_migrate(&db_path).unwrap();
    }
}
