# SQLite Migration Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden SQLite schema migrations with checksum/name validation, compatible metadata upgrades, transaction-backed execution, and failure recovery tests.

**Architecture:** Keep the migration system in `src-tauri/src/infrastructure/db.rs`. Replace tuple migrations with a small `Migration` struct, compute deterministic checksums with the existing `sha256_str`, upgrade old `schema_migrations` tables in place, validate all applied records before applying pending migrations, and run each pending migration in its own SQLite transaction.

**Tech Stack:** Rust, rusqlite, SQLite, sha2/hex through existing `infrastructure::hash`, Tauri backend tests.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义 SQLite migration safety 的实施步骤。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 实施任务](#2-实施任务)
- [3. 自检清单](#3-自检清单)
- [4. 验证命令](#4-验证命令)

## 1. 文件结构

- Modify: `src-tauri/src/infrastructure/db.rs`
  - Change `open_and_migrate` to use `let mut conn`.
  - Change `run_migrations` to accept `&mut Connection` and `&[Migration]`.
  - Add `Migration` and `AppliedMigration` structs.
  - Add checksum, schema metadata upgrade, validation, and transaction-backed apply helpers.
  - Extend tests for metadata compatibility, mismatch detection, invalid status, version gaps, unknown versions, and rollback behavior.
- Verify only: `src-tauri/src/infrastructure/hash.rs`
  - Reuse `sha256_str`; do not change it.
- Verify only: `src-tauri/src/services/knowledge_base.rs`
  - Existing `open_and_migrate` callers keep the same public function signature.
- No frontend files should change.
- No SQL table changes outside `schema_migrations` should change.

## 2. 实施任务

### Task 1: Migration Struct And Checksum Helper

**Files:**
- Modify: `src-tauri/src/infrastructure/db.rs`
- Verify only: `src-tauri/src/infrastructure/hash.rs`

- [ ] **Step 1: Add failing checksum unit tests**

In the existing `#[cfg(test)] mod tests` in `src-tauri/src/infrastructure/db.rs`, add these tests before `test_open_and_migrate_creates_tables`:

```rust
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
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db::tests::test_migration_checksum -- --nocapture
```

Expected: compilation fails because `Migration` and `migration_checksum` do not exist yet.

- [ ] **Step 3: Add migration structs and checksum helper**

At the top of `src-tauri/src/infrastructure/db.rs`, change imports from:

```rust
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, params};
use std::path::Path;
```

to:

```rust
use crate::error::{AppError, AppResult};
use crate::infrastructure::hash::sha256_str;
use rusqlite::{Connection, params};
use std::path::Path;
```

Below the imports, add:

```rust
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
```

- [ ] **Step 4: Convert `MIGRATIONS` to `Migration` structs**

Change:

```rust
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "create_knowledge_base_meta",
        "CREATE TABLE IF NOT EXISTS knowledge_base_meta (...);",
    ),
];
```

to:

```rust
const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "create_knowledge_base_meta",
        sql: "CREATE TABLE IF NOT EXISTS knowledge_base_meta (...);",
    },
];
```

Apply that mechanical conversion to all existing migration entries 1 through 8. Preserve every SQL string byte-for-byte; only replace tuple fields with named struct fields.

- [ ] **Step 5: Update the temporary migration loop to compile**

In `run_migrations`, temporarily change the loop from:

```rust
    for (version, name, sql) in MIGRATIONS {
        if *version > applied {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, datetime('now'))",
                params![version, name],
            )?;
        }
    }
```

to:

```rust
    for migration in MIGRATIONS {
        if migration.version > applied {
            conn.execute_batch(migration.sql)?;
            conn.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, datetime('now'))",
                params![migration.version, migration.name],
            )?;
        }
    }
```

Task 2 will replace this temporary loop with the full safe runner.

- [ ] **Step 6: Run checksum tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db::tests::test_migration_checksum -- --nocapture
```

Expected: both checksum tests pass.

- [ ] **Step 7: Run all backend tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

Expected: all existing tests pass.

- [ ] **Step 8: Commit Task 1**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/infrastructure/db.rs
git commit -m "refactor(db): model migrations with checksums"
```

### Task 2: Schema Metadata Upgrade And Backfill

**Files:**
- Modify: `src-tauri/src/infrastructure/db.rs`

- [ ] **Step 1: Add failing compatibility tests**

Add these helper functions inside the `tests` module:

```rust
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
```

Update `test_open_and_migrate_creates_tables` after `assert_eq!(count, 8);`:

```rust
        let rows = migration_rows(&conn);
        assert_eq!(rows.len(), 8);
        assert!(rows.iter().all(|(_, _, checksum, _)| checksum.len() == 64));
        assert!(rows.iter().all(|(_, _, _, status)| status == "applied"));
```

Add this new test:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db::tests::test_legacy_migrations_backfill_checksum_and_status -- --nocapture
```

Expected: failure because `checksum` and `status` columns do not exist.

- [ ] **Step 3: Change `open_and_migrate` and `run_migrations` signatures**

Change `open_and_migrate` to use a mutable connection:

```rust
pub fn open_and_migrate(db_path: &Path) -> AppResult<Connection> {
    let mut conn = Connection::open(db_path).map_err(|e| AppError::Database(e.to_string()))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    run_migrations(&mut conn, MIGRATIONS)?;
    Ok(conn)
}
```

Change the `run_migrations` signature to:

```rust
fn run_migrations(conn: &mut Connection, migrations: &[Migration]) -> AppResult<()> {
```

- [ ] **Step 4: Add schema metadata helpers**

Add these helpers before `run_migrations`:

```rust
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
        conn.execute_batch("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT NOT NULL DEFAULT '';")?;
    }

    if !has_schema_migration_column(conn, "status")? {
        conn.execute_batch("ALTER TABLE schema_migrations ADD COLUMN status TEXT NOT NULL DEFAULT 'applied';")?;
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

fn migration_by_version<'a>(migrations: &'a [Migration], version: i64) -> Option<&'a Migration> {
    migrations.iter().find(|migration| migration.version == version)
}
```

- [ ] **Step 5: Add legacy checksum backfill**

Add this helper after `migration_by_version`:

```rust
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
```

- [ ] **Step 6: Wire schema upgrade into `run_migrations`**

Replace the initial table creation block in `run_migrations` with:

```rust
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
```

Task 3 will remove the remaining `MAX(version)` decision path.

- [ ] **Step 7: Run compatibility tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db::tests::test_legacy_migrations_backfill_checksum_and_status -- --nocapture
```

Expected: test passes.

- [ ] **Step 8: Run backend tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 2**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/infrastructure/db.rs
git commit -m "feat(db): backfill migration metadata"
```

### Task 3: Applied Migration Validation

**Files:**
- Modify: `src-tauri/src/infrastructure/db.rs`

- [ ] **Step 1: Add failing validation tests**

Add these helper functions inside the `tests` module:

```rust
    fn migration_error_message(result: AppResult<Connection>) -> String {
        match result {
            Ok(_) => panic!("expected migration error"),
            Err(error) => error.to_string(),
        }
    }
```

Add these tests:

```rust
    #[test]
    fn test_migration_name_mismatch_fails() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("name-mismatch.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        conn.execute(
            "UPDATE schema_migrations SET name = 'create_setting' WHERE version = 3",
            [],
        )
        .unwrap();
        drop(conn);

        let message = migration_error_message(open_and_migrate(&db_path));
        assert!(message.contains("Migration 3 name mismatch"));
    }

    #[test]
    fn test_migration_checksum_mismatch_fails() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("checksum-mismatch.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        conn.execute(
            "UPDATE schema_migrations SET checksum = 'bad-checksum' WHERE version = 4",
            [],
        )
        .unwrap();
        drop(conn);

        let message = migration_error_message(open_and_migrate(&db_path));
        assert!(message.contains("Migration 4 checksum mismatch"));
    }

    #[test]
    fn test_unknown_migration_version_fails() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("unknown-version.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name, checksum, status, applied_at) VALUES (999, 'future', 'abc', 'applied', datetime('now'))",
            [],
        )
        .unwrap();
        drop(conn);

        let message = migration_error_message(open_and_migrate(&db_path));
        assert!(message.contains("Migration 999 exists in database but not in current code"));
    }

    #[test]
    fn test_migration_version_gap_fails() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("gap.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
                version    INTEGER PRIMARY KEY,
                name       TEXT    NOT NULL,
                checksum   TEXT    NOT NULL DEFAULT '',
                status     TEXT    NOT NULL DEFAULT 'applied',
                applied_at TEXT    NOT NULL
            );",
        )
        .unwrap();

        let migration_1 = migration_by_version(MIGRATIONS, 1).unwrap();
        let migration_3 = migration_by_version(MIGRATIONS, 3).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name, checksum, status, applied_at) VALUES (?1, ?2, ?3, 'applied', datetime('now'))",
            params![migration_1.version, migration_1.name, migration_checksum(migration_1)],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name, checksum, status, applied_at) VALUES (?1, ?2, ?3, 'applied', datetime('now'))",
            params![migration_3.version, migration_3.name, migration_checksum(migration_3)],
        )
        .unwrap();
        drop(conn);

        let message = migration_error_message(open_and_migrate(&db_path));
        assert!(message.contains("Migration version gap: expected 2 but found 3"));
    }

    #[test]
    fn test_invalid_migration_status_fails() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("invalid-status.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        conn.execute(
            "UPDATE schema_migrations SET status = 'failed' WHERE version = 5",
            [],
        )
        .unwrap();
        drop(conn);

        let message = migration_error_message(open_and_migrate(&db_path));
        assert!(message.contains("Migration 5 has invalid status 'failed'"));
    }
```

- [ ] **Step 2: Run tests to verify at least checksum mismatch fails incorrectly**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db::tests::test_migration_checksum_mismatch_fails -- --nocapture
```

Expected: test fails because existing code still does not validate non-empty checksum values.

- [ ] **Step 3: Add migration definition validation**

Add this helper before `ensure_schema_migrations_table`:

```rust
fn validate_migration_definitions(migrations: &[Migration]) -> AppResult<()> {
    let mut expected_version = 1;
    for migration in migrations {
        if migration.version != expected_version {
            return Err(migration_error(format!(
                "Migration definition gap: expected {} but found {}",
                expected_version, migration.version
            )));
        }
        expected_version += 1;
    }
    Ok(())
}
```

- [ ] **Step 4: Add applied migration validation**

Add this helper after `backfill_legacy_migration_checksums`:

```rust
fn validate_applied_migrations(conn: &Connection, migrations: &[Migration]) -> AppResult<Vec<i64>> {
    let applied = load_applied_migrations(conn)?;
    let mut applied_versions = Vec::with_capacity(applied.len());
    let mut expected_version = 1;

    for applied_migration in applied {
        let migration = migration_by_version(migrations, applied_migration.version).ok_or_else(|| {
            migration_error(format!(
                "Migration {} exists in database but not in current code",
                applied_migration.version
            ))
        })?;

        if applied_migration.version != expected_version {
            return Err(migration_error(format!(
                "Migration version gap: expected {} but found {}",
                expected_version, applied_migration.version
            )));
        }

        if applied_migration.name != migration.name {
            return Err(migration_error(format!(
                "Migration {} name mismatch: database has '{}', code has '{}'",
                applied_migration.version, applied_migration.name, migration.name
            )));
        }

        if applied_migration.status != "applied" {
            return Err(migration_error(format!(
                "Migration {} has invalid status '{}'",
                applied_migration.version, applied_migration.status
            )));
        }

        let expected_checksum = migration_checksum(migration);
        if applied_migration.checksum != expected_checksum {
            return Err(migration_error(format!(
                "Migration {} checksum mismatch for '{}'",
                applied_migration.version, migration.name
            )));
        }

        applied_versions.push(applied_migration.version);
        expected_version += 1;
    }

    Ok(applied_versions)
}
```

- [ ] **Step 5: Wire validation into `run_migrations`**

Change the start of `run_migrations` to:

```rust
fn run_migrations(conn: &mut Connection, migrations: &[Migration]) -> AppResult<()> {
    validate_migration_definitions(migrations)?;
    ensure_schema_migrations_table(conn)?;
    ensure_schema_migrations_columns(conn)?;
    backfill_legacy_migration_checksums(conn, migrations)?;
    let applied_versions = validate_applied_migrations(conn, migrations)?;
```

Then replace the old `MAX(version)` query and loop condition with:

```rust
    for migration in migrations {
        if !applied_versions.contains(&migration.version) {
            conn.execute_batch(migration.sql)?;
            conn.execute(
                "INSERT INTO schema_migrations (version, name, checksum, status, applied_at) VALUES (?1, ?2, ?3, 'applied', datetime('now'))",
                params![migration.version, migration.name, migration_checksum(migration)],
            )?;
        }
    }
    Ok(())
}
```

Task 4 will make this loop transactional.

- [ ] **Step 6: Run validation tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db::tests::test_migration_ -- --nocapture
```

Expected: checksum mismatch, name mismatch, gap, status, and checksum helper tests pass.

Run the unknown version test separately because its name does not start with `test_migration_`:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db::tests::test_unknown_migration_version_fails -- --nocapture
```

Expected: test passes.

- [ ] **Step 7: Run backend tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

Expected: all tests pass.

- [ ] **Step 8: Commit Task 3**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/infrastructure/db.rs
git commit -m "feat(db): validate applied migrations"
```

### Task 4: Transactional Apply And Failure Recovery

**Files:**
- Modify: `src-tauri/src/infrastructure/db.rs`

- [ ] **Step 1: Add failing rollback test**

Add this test inside the `tests` module:

```rust
    #[test]
    fn test_failed_migration_rolls_back_record() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("failed-migration.sqlite");
        let mut conn = Connection::open(&db_path).unwrap();

        let failing_migrations = &[
            Migration {
                version: 1,
                name: "create_first",
                sql: "CREATE TABLE first_table (id TEXT PRIMARY KEY);",
            },
            Migration {
                version: 2,
                name: "create_second_bad",
                sql: "CREATE TABLE second_table (id TEXT PRIMARY KEY); CREATE TABLE second_table (id TEXT PRIMARY KEY);",
            },
        ];

        let result = run_migrations(&mut conn, failing_migrations);
        assert!(result.is_err());

        let rows = migration_rows(&conn);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, 1);
        assert_eq!(rows[0].1, "create_first");

        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'second_table'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 0);

        assert!(rows.iter().all(|(version, _, _, _)| *version != 2));
    }
```

This test proves the failed migration did not leave the second table and did not record version 2 as applied.

Add a second test for retrying the same definition after an external transient failure is simulated by fixing SQL under the same version only before the first successful record exists:

```rust
    #[test]
    fn test_failed_pending_migration_can_be_retried_with_same_identity_before_recorded() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("retry-pending.sqlite");
        let mut conn = Connection::open(&db_path).unwrap();

        let failing_migrations = &[
            Migration {
                version: 1,
                name: "create_first",
                sql: "CREATE TABLE first_table (id TEXT PRIMARY KEY);",
            },
            Migration {
                version: 2,
                name: "create_second",
                sql: "CREATE TABLE second_table (id TEXT PRIMARY KEY); CREATE TABLE second_table (id TEXT PRIMARY KEY);",
            },
        ];
        assert!(run_migrations(&mut conn, failing_migrations).is_err());
        assert_eq!(migration_rows(&conn).len(), 1);

        let retry_migrations = &[
            Migration {
                version: 1,
                name: "create_first",
                sql: "CREATE TABLE first_table (id TEXT PRIMARY KEY);",
            },
            Migration {
                version: 2,
                name: "create_second",
                sql: "CREATE TABLE second_table (id TEXT PRIMARY KEY);",
            },
        ];
        run_migrations(&mut conn, retry_migrations).unwrap();

        let rows = migration_rows(&conn);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].0, 2);
        assert_eq!(rows[1].1, "create_second");
        assert_eq!(rows[1].3, "applied");
    }
```

- [ ] **Step 2: Run rollback tests to verify the retry test fails before transaction implementation**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db::tests::test_failed_ -- --nocapture
```

Expected: at least `test_failed_pending_migration_can_be_retried_with_same_identity_before_recorded` fails because the failed `CREATE TABLE` can leave `second_table` behind without a transaction.

- [ ] **Step 3: Add transactional pending apply helper**

Add this helper after `validate_applied_migrations`:

```rust
fn apply_pending_migrations(
    conn: &mut Connection,
    migrations: &[Migration],
    applied_versions: &[i64],
) -> AppResult<()> {
    for migration in migrations {
        if applied_versions.contains(&migration.version) {
            continue;
        }

        let tx = conn.transaction()?;
        tx.execute_batch(migration.sql)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, name, checksum, status, applied_at) VALUES (?1, ?2, ?3, 'applied', datetime('now'))",
            params![migration.version, migration.name, migration_checksum(migration)],
        )?;
        tx.commit()?;
    }

    Ok(())
}
```

- [ ] **Step 4: Replace the pending apply loop in `run_migrations`**

Change the end of `run_migrations` to:

```rust
    let applied_versions = validate_applied_migrations(conn, migrations)?;
    apply_pending_migrations(conn, migrations, &applied_versions)?;
    Ok(())
}
```

Remove the old direct `for migration in migrations` loop from `run_migrations`.

- [ ] **Step 5: Run rollback tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db::tests::test_failed_ -- --nocapture
```

Expected: both failure recovery tests pass.

- [ ] **Step 6: Run all migration tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db::tests -- --nocapture
```

Expected: all `infrastructure::db` tests pass.

- [ ] **Step 7: Run backend tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

Expected: all Rust tests pass.

- [ ] **Step 8: Commit Task 4**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/infrastructure/db.rs
git commit -m "feat(db): apply migrations transactionally"
```

### Task 5: Final Verification And Baseline Update

**Files:**
- Modify: `docs/superpowers/baseline-2026-05-30.md`
- Verify: `src-tauri/src/infrastructure/db.rs`

- [ ] **Step 1: Static implementation checklist**

Confirm in `src-tauri/src/infrastructure/db.rs`:

- `open_and_migrate` still has public signature `pub fn open_and_migrate(db_path: &Path) -> AppResult<Connection>`.
- `schema_migrations` table creation includes `checksum` and `status`.
- Old metadata tables get missing columns through `PRAGMA table_info` plus `ALTER TABLE`.
- `migration_checksum` uses `sha256_str` with version, name, and SQL.
- Applied migration validation checks unknown version, version gap, name mismatch, invalid status, and checksum mismatch.
- Pending migrations are applied through `conn.transaction()`.
- Failed pending migrations do not insert an `applied` record.
- Existing callers in `services/knowledge_base.rs` do not need changes.

- [ ] **Step 2: Run targeted grep checks**

Run:

```bash
cd /Users/lijun/mynote && rg -n "MAX\(version\)|INSERT INTO schema_migrations \(version, name, applied_at\)|checksum|status|transaction\(\)" src-tauri/src/infrastructure/db.rs
```

Expected:

- No old insert statement with only `(version, name, applied_at)` remains.
- `MAX(version)` no longer drives pending migration decisions.
- `checksum`, `status`, and `transaction()` are present.

- [ ] **Step 3: Run backend verification**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

Expected: all Rust tests pass.

- [ ] **Step 4: Run frontend build smoke verification**

Run:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: TypeScript and Vite build pass. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 5: Optional Tauri debug build**

Run if time is acceptable in the environment:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri build --debug
```

Expected: debug build succeeds. If skipped because the previous two commands already cover this backend-only change, record that decision in the final summary.

- [ ] **Step 6: Request code review**

Request `code-reviewer` with:

```text
WHAT_WAS_IMPLEMENTED:
SQLite migration safety hardening: checksum/name/status metadata, legacy metadata backfill, applied migration validation, transactional pending migration execution, and regression tests.

PLAN_OR_REQUIREMENTS:
docs/superpowers/specs/2026-05-30-sqlite-migration-safety-design.md and docs/superpowers/plans/2026-05-30-sqlite-migration-safety.md.

REVIEW FOCUS:
- Backward compatibility with existing schema_migrations tables.
- Correctness of checksum/name/status validation.
- Whether transaction boundaries really prevent failed pending migrations from being recorded.
- Whether tests cover mismatch, gap, unknown version, invalid status, legacy backfill, and retry behavior.
```

Fix Critical and Important findings before proceeding.

- [ ] **Step 7: Update baseline after review**

In `docs/superpowers/baseline-2026-05-30.md`, change the SQLite migration P2 row from:

```markdown
| P2 | 待处理 | SQLite migration 只用 `MAX(version)`，缺少 checksum/name 校验和失败恢复测试。 | 增加迁移 checksum、事务包裹和失败重开测试。 |
```

to:

```markdown
| P2 | 已完成 | SQLite migration 只用 `MAX(version)`，缺少 checksum/name 校验和失败恢复测试。 | 已增加 migration checksum/name/status 校验、旧库 metadata 回填、事务化执行和失败恢复测试。 |
```

In section `## 8. 下一步建议`, remove SQLite migration from the next-action list so search fallback performance becomes the next P2 item.

- [ ] **Step 8: Commit baseline update**

```bash
cd /Users/lijun/mynote
git add docs/superpowers/baseline-2026-05-30.md
git commit -m "docs: update baseline after migration safety"
```

## 3. 自检清单

- Spec coverage: Tasks cover checksum, name validation, metadata upgrade, status validation, version continuity, transactional apply, failure retry behavior, and baseline update.
- Scope check: Plan changes only `db.rs` plus baseline docs after implementation. No frontend behavior changes are included.
- Compatibility check: Existing `open_and_migrate` public signature remains unchanged.
- Test check: Each risk in the approved spec has a named Rust test.

## 4. 验证命令

Run before merge:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Optional final package verification:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri build --debug
```
