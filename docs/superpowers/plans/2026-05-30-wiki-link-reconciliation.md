# Wiki Link Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Wiki link `resolved` state and backlinks consistent when target notes are created, renamed, deleted, or reconciled in bulk.

**Architecture:** Refactor link target resolution in `src-tauri/src/services/index.rs` into shared helpers, then run reconciliation inside the existing `index_note_full()` transaction. Keep the implementation in `index.rs` for now to match the current service boundary and avoid a premature module split.

**Tech Stack:** Rust, rusqlite, SQLite FTS5 schema already present, existing `cargo test` unit tests.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 创建 Wiki link reconciliation 实施计划。 |

## 目录

- [Task 1: Add Failing Tests For Link Reconciliation](#task-1-add-failing-tests-for-link-reconciliation)
- [Task 2: Extract Shared Link Target Resolution](#task-2-extract-shared-link-target-resolution)
- [Task 3: Reconcile Links For Indexed Notes](#task-3-reconcile-links-for-indexed-notes)
- [Task 4: Add Full Link Reconciliation Helper](#task-4-add-full-link-reconciliation-helper)
- [Task 5: Final Verification And Review](#task-5-final-verification-and-review)

## File Structure

- Modify: `src-tauri/src/services/index.rs`
  - Add tests for delayed target resolution, title rename reconciliation, and full reconciliation.
  - Extract `resolve_link_target()` from current inline SQL.
  - Add `reconcile_links_for_note()` and `reconcile_all_links()`.
  - Call `reconcile_links_for_note()` inside `index_note_full()` before transaction commit.
- No frontend files are changed.
- No DB migration is required.

## Task 1: Add Failing Tests For Link Reconciliation

**Files:**
- Modify: `src-tauri/src/services/index.rs`

- [ ] **Step 1: Import `index_note_full` in the existing tests module**

In `src-tauri/src/services/index.rs`, replace the first line inside `#[cfg(test)] mod tests`:

```rust
use super::mark_note_deleted_by_path;
```

with:

```rust
use super::{index_note_full, mark_note_deleted_by_path, reconcile_all_links};
```

This intentionally references functions that are not all implemented yet, so later tests can prove the missing behavior.

- [ ] **Step 2: Add helper functions to the tests module**

Append these helpers near the top of the existing `tests` module, before `mark_note_deleted_clears_derived_indexes`:

```rust
fn setup_index_db() -> (TempDir, rusqlite::Connection) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.sqlite");
    let conn = open_and_migrate(&db_path).unwrap();
    (dir, conn)
}

fn link_state(conn: &rusqlite::Connection, source_title: &str, target_raw: &str) -> (Option<String>, i64) {
    conn.query_row(
        "SELECT l.target_note_id, l.resolved
         FROM links l
         JOIN notes n ON n.id = l.source_note_id
         WHERE n.title = ?1 AND l.target_raw = ?2",
        rusqlite::params![source_title, target_raw],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

fn note_id_by_title(conn: &rusqlite::Connection, title: &str) -> String {
    conn.query_row(
        "SELECT id FROM notes WHERE title = ?1 AND deleted_at IS NULL",
        rusqlite::params![title],
        |row| row.get(0),
    )
    .unwrap()
}
```

- [ ] **Step 3: Add delayed target resolution failing test**

Append this test to the same `tests` module:

```rust
#[test]
fn indexing_later_target_resolves_existing_unresolved_wiki_link() {
    let (root, conn) = setup_index_db();

    index_note_full(&conn, root.path(), "notes/a.md", "# A\n\n[[B]]").unwrap();
    assert_eq!(link_state(&conn, "A", "B"), (None, 0));

    let b = index_note_full(&conn, root.path(), "notes/b.md", "# B\n\n").unwrap();

    assert_eq!(link_state(&conn, "A", "B"), (Some(b.id), 1));
}
```

- [ ] **Step 4: Add title rename failing test**

Append this test to the same `tests` module:

```rust
#[test]
fn renaming_target_unresolves_old_title_and_resolves_new_title() {
    let (root, conn) = setup_index_db();

    index_note_full(&conn, root.path(), "notes/a.md", "# A\n\n[[B]]").unwrap();
    index_note_full(&conn, root.path(), "notes/c.md", "# C Source\n\n[[C]]").unwrap();
    let target = index_note_full(&conn, root.path(), "notes/target.md", "# B\n\n").unwrap();

    assert_eq!(link_state(&conn, "A", "B"), (Some(target.id.clone()), 1));
    assert_eq!(link_state(&conn, "C Source", "C"), (None, 0));

    let renamed = index_note_full(&conn, root.path(), "notes/target.md", "# C\n\n").unwrap();

    assert_eq!(renamed.id, target.id);
    assert_eq!(link_state(&conn, "A", "B"), (None, 0));
    assert_eq!(link_state(&conn, "C Source", "C"), (Some(renamed.id), 1));
}
```

- [ ] **Step 5: Add full reconciliation failing test**

Append this test to the same `tests` module:

```rust
#[test]
fn reconcile_all_links_recomputes_links_from_current_notes() {
    let (root, conn) = setup_index_db();

    index_note_full(&conn, root.path(), "notes/source.md", "# Source\n\n[[Target]]").unwrap();
    let target = index_note_full(&conn, root.path(), "notes/target.md", "# Target\n\n").unwrap();

    conn.execute(
        "UPDATE links SET target_note_id = NULL, resolved = 0 WHERE target_raw = 'Target'",
        [],
    )
    .unwrap();
    assert_eq!(link_state(&conn, "Source", "Target"), (None, 0));

    reconcile_all_links(&conn).unwrap();

    assert_eq!(link_state(&conn, "Source", "Target"), (Some(target.id), 1));
}
```

- [ ] **Step 6: Run targeted tests and verify RED**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test services::index -- --nocapture
```

Expected result: test compilation fails because `reconcile_all_links` does not exist, or the delayed/rename tests fail because reconciliation is not implemented yet. This is the expected RED state.

## Task 2: Extract Shared Link Target Resolution

**Files:**
- Modify: `src-tauri/src/services/index.rs`

- [ ] **Step 1: Add `resolve_link_target` helper**

Insert this function after `index_note_full()` and before `upsert_tag_and_link()`:

```rust
fn resolve_link_target(
    tx: &rusqlite::Transaction,
    target_raw: &str,
) -> AppResult<Option<String>> {
    let exact = tx
        .query_row(
            "SELECT id FROM notes WHERE title = ?1 AND deleted_at IS NULL LIMIT 1",
            params![target_raw],
            |row| row.get(0),
        )
        .optional()?;

    if exact.is_some() {
        return Ok(exact);
    }

    tx.query_row(
        "SELECT id FROM notes WHERE lower(title) = lower(?1) AND deleted_at IS NULL LIMIT 1",
        params![target_raw],
        |row| row.get(0),
    )
    .optional()
    .map_err(AppError::from)
}
```

- [ ] **Step 2: Replace inline target resolution in `index_note_full()`**

Find this block in the link insertion loop:

```rust
let target_note_id: Option<String> = tx
    .query_row(
        "SELECT id FROM notes WHERE title = ?1 AND deleted_at IS NULL LIMIT 1",
        params![raw.target_raw],
        |r| r.get(0),
    )
    .ok()
    .or_else(|| {
        tx.query_row(
            "SELECT id FROM notes WHERE lower(title) = lower(?1) AND deleted_at IS NULL LIMIT 1",
            params![raw.target_raw],
            |r| r.get(0),
        ).ok()
    });
```

Replace it with:

```rust
let target_note_id = resolve_link_target(&tx, &raw.target_raw)?;
```

- [ ] **Step 3: Run targeted tests and verify failures remain behavior-related**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test services::index -- --nocapture
```

Expected result: compilation succeeds for `resolve_link_target`, but tests that need reconciliation still fail until Task 3 and Task 4 are implemented.

## Task 3: Reconcile Links For Indexed Notes

**Files:**
- Modify: `src-tauri/src/services/index.rs`

- [ ] **Step 1: Add `reconcile_links_for_note` helper**

Insert this function after `resolve_link_target()`:

```rust
fn reconcile_links_for_note(
    tx: &rusqlite::Transaction,
    note_id: &str,
    now: &str,
) -> AppResult<()> {
    tx.execute(
        "UPDATE links
         SET target_note_id = NULL, resolved = 0, updated_at = ?1
         WHERE target_note_id = ?2
           AND NOT EXISTS (
             SELECT 1
             FROM notes n
             WHERE n.id = ?2
               AND n.deleted_at IS NULL
               AND (n.title = links.target_raw OR lower(n.title) = lower(links.target_raw))
           )",
        params![now, note_id],
    )?;

    let targets = {
        let mut stmt = tx.prepare(
            "SELECT id, target_raw
             FROM links
             WHERE resolved = 0 OR target_note_id IS NULL OR target_note_id = ?1",
        )?;
        stmt.query_map(params![note_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?
    };

    for (link_id, target_raw) in targets {
        let target_note_id = resolve_link_target(tx, &target_raw)?;
        let resolved = if target_note_id.is_some() { 1 } else { 0 };
        tx.execute(
            "UPDATE links
             SET target_note_id = ?1, resolved = ?2, updated_at = ?3
             WHERE id = ?4",
            params![target_note_id, resolved, now, link_id],
        )?;
    }

    Ok(())
}
```

- [ ] **Step 2: Call `reconcile_links_for_note()` inside `index_note_full()`**

Find the FTS insert block:

```rust
tx.execute(
    "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, ?3, ?4)",
    params![actual_id, title, summary.as_deref().unwrap_or(""), parsed.body],
)?;

tx.commit()?;
```

Replace it with:

```rust
tx.execute(
    "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, ?3, ?4)",
    params![actual_id, title, summary.as_deref().unwrap_or(""), parsed.body],
)?;

reconcile_links_for_note(&tx, &actual_id, &now)?;

tx.commit()?;
```

- [ ] **Step 3: Run targeted tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test services::index -- --nocapture
```

Expected result: delayed target and rename tests pass; full reconciliation test still fails until Task 4 if `reconcile_all_links()` has not been implemented.

## Task 4: Add Full Link Reconciliation Helper

**Files:**
- Modify: `src-tauri/src/services/index.rs`

- [ ] **Step 1: Add `reconcile_all_links()`**

Insert this public function after `mark_note_deleted_by_path()`:

```rust
pub fn reconcile_all_links(conn: &Connection) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;

    let links = {
        let mut stmt = tx.prepare("SELECT id, target_raw FROM links ORDER BY id")?;
        stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?
    };

    for (link_id, target_raw) in links {
        let target_note_id = resolve_link_target(&tx, &target_raw)?;
        let resolved = if target_note_id.is_some() { 1 } else { 0 };
        tx.execute(
            "UPDATE links
             SET target_note_id = ?1, resolved = ?2, updated_at = ?3
             WHERE id = ?4",
            params![target_note_id, resolved, now, link_id],
        )?;
    }

    tx.commit()?;
    Ok(())
}
```

- [ ] **Step 2: Run targeted tests and verify GREEN**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test services::index -- --nocapture
```

Expected result: all `services::index` tests pass, including:

```text
indexing_later_target_resolves_existing_unresolved_wiki_link ... ok
renaming_target_unresolves_old_title_and_resolves_new_title ... ok
reconcile_all_links_recomputes_links_from_current_notes ... ok
mark_note_deleted_clears_derived_indexes ... ok
```

- [ ] **Step 3: Run full Rust tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

Expected result: all Rust tests pass.

- [ ] **Step 4: Commit implementation**

Run:

```bash
cd /Users/lijun/mynote
git add src-tauri/src/services/index.rs
git commit -m "fix: reconcile wiki link targets"
```

## Task 5: Final Verification And Review

**Files:**
- Modify: `docs/superpowers/baseline-2026-05-30.md` only if the user wants the P1 queue updated in this same change. If `baseline-2026-05-30.md` has unrelated user edits, do not touch it.

- [ ] **Step 1: Run final verification**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
cd /Users/lijun/mynote && corepack pnpm build
```

Expected result:

```text
Rust tests: all passed
Frontend build: passed; Vite chunk size warning is acceptable
```

- [ ] **Step 2: Check git status**

Run:

```bash
cd /Users/lijun/mynote && git --no-pager status --short
```

Expected result: only user-owned unrelated changes may remain, such as an existing edit to `docs/superpowers/baseline-2026-05-30.md`. The implementation commit should not leave unstaged changes in `src-tauri/src/services/index.rs`.

- [ ] **Step 3: Request code review**

Use the `code-reviewer` subagent with this context:

```text
Review /Users/lijun/mynote changes for Wiki link reconciliation.
Scope: implementation after docs/superpowers/specs/2026-05-30-wiki-link-reconciliation-design.md.
Focus: link resolution correctness, transaction safety, stale resolved links after title changes, behavior after deleted notes, test coverage, and unintended changes outside src-tauri/src/services/index.rs.
```

- [ ] **Step 4: Address review findings**

If the review finds Critical or Important issues, fix them with TDD and commit follow-up fixes before proceeding to the next P1 item.

- [ ] **Step 5: Mark P1 queue item complete in baseline only with user approval**

If the user wants the baseline risk queue updated, edit `docs/superpowers/baseline-2026-05-30.md` to move `Wiki link reconciliation` from active P1 to completed/fixed notes. Do not overwrite user edits in that file.
