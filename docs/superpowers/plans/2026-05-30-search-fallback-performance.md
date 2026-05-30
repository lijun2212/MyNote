# Search Fallback Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove large-text `%term%` fallback scans from search while preserving FTS full-text search and title/path substring fallback.

**Architecture:** Keep `search_notes_in_conn()` as the single backend search query entry point. Add regression tests first, then change the fallback CTE from `summary/body/title/path` scanning to metadata-only `title/path` scanning. No frontend API, database schema, or indexing flow changes are required.

**Tech Stack:** Rust, Tauri command handlers, rusqlite, SQLite FTS5, cargo test, Vite/TypeScript build.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义搜索 fallback 性能风险的实现计划。 |

## 目录

- [1. Scope](#1-scope)
- [2. File Structure](#2-file-structure)
- [3. Execution Setup](#3-execution-setup)
- [4. Tasks](#4-tasks)
- [5. Final Verification](#5-final-verification)
- [6. Self-Review](#6-self-review)

## 1. Scope

Implement the approved design in [Search Fallback Performance Design](../specs/2026-05-30-search-fallback-performance-design.md).

In scope:

- Add tests proving title/path fallback remains available.
- Add tests proving `summary/body` arbitrary substring fallback is removed.
- Keep FTS body/summary/title token or prefix search working.
- Remove `LEFT JOIN note_fts` from the fallback CTE.
- Rename `like_matches` to `metadata_matches` to match the new behavior.
- Update the baseline after implementation and verification.

Out of scope:

- Frontend UI changes.
- `SearchResult` type changes.
- SQLite schema migration.
- Trigram tokenizer or any new index table.
- Time-threshold performance assertions.

## 2. File Structure

- Modify: `src-tauri/src/commands/search.rs`
  - Owns Tauri search command and the internal `search_notes_in_conn()` query.
  - Existing test module already has an in-memory SQLite FTS5 fixture.
- Modify: `docs/superpowers/baseline-2026-05-30.md`
  - Mark the P2 search fallback risk as completed after implementation passes review and verification.

No new Rust modules are needed. Keeping the change in one command file is simpler and matches the current codebase shape.

## 3. Execution Setup

Run implementation in an isolated worktree from `main`:

```bash
cd /Users/lijun/mynote
git worktree add .worktrees/search-fallback-performance -b feature/search-fallback-performance main
cd .worktrees/search-fallback-performance
```

Expected result:

- New branch: `feature/search-fallback-performance`
- Worktree path: `/Users/lijun/mynote/.worktrees/search-fallback-performance`
- Starting commit includes `docs: add search fallback performance design` and this plan.

## 4. Tasks

### Task 1: Add Search Fallback Regression Tests

**Files:**
- Modify: `src-tauri/src/commands/search.rs`

- [ ] **Step 1: Add failing tests for the approved search behavior**

In `src-tauri/src/commands/search.rs`, append these tests inside the existing `#[cfg(test)] mod tests` block, after `search_notes_treats_like_wildcards_as_literals()`:

```rust
    #[test]
    fn search_notes_matches_body_fts_prefix() {
        let conn = setup_search_db();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["n1", "notes/performance.md", "Performance Notes"],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
            rusqlite::params!["n1", "Performance Notes", "sqlite performance tuning"],
        ).unwrap();

        let results = search_notes_in_conn(&conn, "perform").unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].note_id, "n1");
    }

    #[test]
    fn search_notes_does_not_scan_body_substrings_in_fallback() {
        let conn = setup_search_db();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["n1", "notes/neutral.md", "Neutral Note"],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
            rusqlite::params!["n1", "Neutral Note", "bodyonlysubstring"],
        ).unwrap();

        let results = search_notes_in_conn(&conn, "onlysub").unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn search_notes_does_not_scan_summary_substrings_in_fallback() {
        let conn = setup_search_db();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["n1", "notes/neutral.md", "Neutral Note"],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, ?3, '')",
            rusqlite::params!["n1", "Neutral Note", "summarycontainsneedle"],
        ).unwrap();

        let results = search_notes_in_conn(&conn, "needle").unwrap();

        assert!(results.is_empty());
    }
```

- [ ] **Step 2: Run the search tests and verify the new regression tests fail**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/search-fallback-performance/src-tauri
cargo test commands::search::tests
```

Expected result:

- `search_notes_matches_body_fts_prefix` passes.
- `search_notes_does_not_scan_body_substrings_in_fallback` fails because current fallback scans `note_fts.body`.
- `search_notes_does_not_scan_summary_substrings_in_fallback` fails because current fallback scans `note_fts.summary`.

- [ ] **Step 3: Commit failing tests**

```bash
cd /Users/lijun/mynote/.worktrees/search-fallback-performance
git add src-tauri/src/commands/search.rs
git commit -m "test(search): cover metadata-only fallback"
```

### Task 2: Restrict Fallback to Title and Path

**Files:**
- Modify: `src-tauri/src/commands/search.rs`

- [ ] **Step 1: Replace the search SQL fallback CTE**

In `search_notes_in_conn()`, replace the full `conn.prepare(...)` SQL string with this SQL. The Rust code before and after `conn.prepare(...)` stays the same.

```rust
    let mut stmt = conn.prepare(
        "WITH fts_matches AS (
             SELECT n.id, n.title, n.path,
                    snippet(note_fts, 2, '<mark>', '</mark>', '...', 20) AS snippet,
                    rank,
                    0 AS source_order
             FROM note_fts
             JOIN notes n ON note_fts.note_id = n.id AND n.deleted_at IS NULL
             WHERE note_fts MATCH ?1
         ),
         metadata_matches AS (
             SELECT n.id, n.title, n.path,
                    n.title AS snippet,
                    0.0 AS rank,
                    1 AS source_order
             FROM notes n
             WHERE n.deleted_at IS NULL
               AND (
                   n.title LIKE ?2 ESCAPE '\\'
                   OR n.path LIKE ?2 ESCAPE '\\'
               )
               AND n.id NOT IN (SELECT id FROM fts_matches)
         )
         SELECT id, title, path, snippet
         FROM (
             SELECT * FROM fts_matches
             UNION ALL
             SELECT * FROM metadata_matches
         )
         ORDER BY source_order, rank
         LIMIT 20",
    )?;
```

- [ ] **Step 2: Run the focused search tests and verify they pass**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/search-fallback-performance/src-tauri
cargo test commands::search::tests
```

Expected result:

- All search tests pass.
- Existing wildcard and imported filename tests still pass.

- [ ] **Step 3: Run the full Rust test suite**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/search-fallback-performance/src-tauri
cargo test
```

Expected result:

- All Rust tests pass.

- [ ] **Step 4: Commit the query change**

```bash
cd /Users/lijun/mynote/.worktrees/search-fallback-performance
git add src-tauri/src/commands/search.rs
git commit -m "fix(search): limit fallback to title and path"
```

### Task 3: Final Verification and Baseline Update

**Files:**
- Modify: `docs/superpowers/baseline-2026-05-30.md`

- [ ] **Step 1: Run final worktree verification**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/search-fallback-performance/src-tauri
cargo test
cd /Users/lijun/mynote/.worktrees/search-fallback-performance
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm build
```

Expected result:

- `cargo test` passes.
- `pnpm build` passes. Existing Vite chunk-size warning is acceptable if unchanged.

- [ ] **Step 2: Update the baseline risk row**

In `docs/superpowers/baseline-2026-05-30.md`, replace this row:

```markdown
| P2 | 待处理 | 搜索 fallback 对 `summary/body` 做 `%term%` 可能在大知识库中变慢。 | 做搜索性能测试；必要时限制 fallback 范围或异步化。 |
```

with:

```markdown
| P2 | 已完成 | 搜索 fallback 对 `summary/body` 做 `%term%` 可能在大知识库中变慢。 | 已将 fallback 收敛为 title/path metadata 子串匹配，正文和摘要继续走 FTS5，并增加回归测试覆盖。 |
```

In `## 8. 下一步建议`, replace:

```markdown
P1 风险已处理完成，P2 Tauri 安全面和 SQLite migration safety 已处理完成。下一步建议按 P2 顺序继续：

1. 搜索 fallback 性能风险。
2. 前端测试框架和交互测试。
```

with:

```markdown
P1 风险已处理完成，P2 Tauri 安全面、SQLite migration safety 和搜索 fallback 性能风险已处理完成。下一步建议继续：

1. 前端测试框架和交互测试。
```

- [ ] **Step 3: Commit the baseline update**

```bash
cd /Users/lijun/mynote/.worktrees/search-fallback-performance
git add docs/superpowers/baseline-2026-05-30.md
git commit -m "docs: update baseline after search fallback fix"
```

- [ ] **Step 4: Request code review before merge**

Use the `code-reviewer` agent with this review focus:

```text
Review the search fallback performance implementation against docs/superpowers/specs/2026-05-30-search-fallback-performance-design.md and docs/superpowers/plans/2026-05-30-search-fallback-performance.md.

Focus on:
- Whether summary/body LIKE fallback was fully removed from production search.
- Whether FTS title/summary/body search still works.
- Whether title/path substring fallback still works.
- Whether wildcard escaping behavior remains correct.
- Whether tests prove the intended behavior without brittle timing assertions.
```

Expected result:

- No Critical or Important findings before merge.
- If review finds Critical or Important issues, fix them before proceeding.

## 5. Final Verification

After review is clean, merge locally back to `main` and verify the merged result:

```bash
cd /Users/lijun/mynote
git merge --no-ff feature/search-fallback-performance -m "merge: search fallback performance"
cd /Users/lijun/mynote/src-tauri
cargo test
cd /Users/lijun/mynote
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm build
git worktree remove .worktrees/search-fallback-performance
git branch -d feature/search-fallback-performance
git status --short
git log --oneline --decorate -8
```

Expected result:

- Merge succeeds without conflicts.
- `cargo test` passes.
- `pnpm build` passes with only the known chunk-size warning if unchanged.
- Worktree and feature branch are removed.
- `git status --short` is clean.

## 6. Self-Review

- Spec coverage: Task 1 and Task 2 cover metadata-only fallback, FTS preservation, wildcard escaping, and removal of `summary/body` scans. Task 3 covers baseline update and final verification.
- Placeholder scan: No placeholder markers or unspecified implementation steps remain.
- Type consistency: No public Rust or TypeScript types change. `SearchResult` remains `note_id/title/path/snippet`.
- Scope check: This plan touches one Rust command file and one baseline doc. It does not add schema, frontend, or indexing changes.