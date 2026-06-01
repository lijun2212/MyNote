# Phase 3B Manual Relations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement manual relation CRUD for the current note, expose it through Tauri commands, and render it inside the existing 右侧“链接”页签 without widening scope into graph rendering.

**Architecture:** Keep the current Tauri 2 + Rust + React split. Rust owns the new `relations` schema, validation, and query grouping; React only consumes typed commands and adds a focused manual-relation UI under the existing links panel. The plan deliberately fixes the 3C graph contract indirectly by making relation records stable and graph-ready, but it does not implement graph APIs or graph UI.

**Tech Stack:** Rust, rusqlite, Tauri commands, React 19, TypeScript, Zustand, Vitest/React Testing Library.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-31 | v1.0 | 根据已批准的 Phase 3B/3C spec 创建 3B 手动关系 implementation plan。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 执行前准备](#2-执行前准备)
- [3. Task 1: 新增 relations schema 与领域模型](#3-task-1-新增-relations-schema-与领域模型)
- [4. Task 2: 实现 RelationService 与 Tauri commands](#4-task-2-实现-relationservice-与-tauri-commands)
- [5. Task 3: 前端类型与 API 接线](#5-task-3-前端类型与-api-接线)
- [6. Task 4: 手动关系面板 UI](#6-task-4-手动关系面板-ui)
- [7. Task 5: 链接页签集成与回归验证](#7-task-5-链接页签集成与回归验证)
- [8. Task 6: 总验证](#8-task-6-总验证)
- [9. 计划自检](#9-计划自检)

## 1. 文件结构

### Rust 修改

- Modify: `src-tauri/src/infrastructure/db.rs` - 新增 `relations` migration 和 migration test。
- Create: `src-tauri/src/domain/relation.rs` - 关系领域模型、关系类型枚举、UI 返回 DTO。
- Modify: `src-tauri/src/domain/mod.rs` - 暴露 `relation` module。
- Create: `src-tauri/src/services/relation.rs` - create/list/delete 逻辑、校验、去重、按 outgoing/incoming 分组。
- Modify: `src-tauri/src/services/mod.rs` - 暴露 `relation` service。
- Create: `src-tauri/src/commands/relation.rs` - Tauri command 包装层。
- Modify: `src-tauri/src/commands/mod.rs` - 暴露 `relation` commands。
- Modify: `src-tauri/src/lib.rs` - 注册 relation commands。

### 前端修改

- Modify: `src/types/index.ts` - 新增 `Relation`, `RelationItem`, `NoteRelations`, `RelationType`。
- Modify: `src/api/commands.ts` - 新增 `createRelation`, `deleteRelation`, `listRelations`。
- Create: `src/components/RightSidebar/ManualRelationsPanel.tsx` - 手动关系列表、创建、删除。
- Modify: `src/components/RightSidebar/BacklinksPanel.tsx` - 保留自动链接 section，并在底部挂载手动关系面板。

### 测试修改

- Modify: `src-tauri/src/infrastructure/db.rs` - relations migration 测试。
- Create: `src-tauri/src/services/relation.rs` tests - create/list/delete/self/duplicate 覆盖。
- Create: `src/components/RightSidebar/ManualRelationsPanel.test.tsx` - 关系创建、重复错误、删除、空态。
- Create: `src/components/RightSidebar/BacklinksPanel.test.tsx` - links + manual relations 共存渲染。

## 2. 执行前准备

Implementation should happen in an isolated worktree.

- [ ] **Step 1: Create the implementation worktree**

Run from the main repository:

```bash
cd /Users/lijun/mynote
git status --short
git worktree add .worktrees/phase3b-manual-relations -b feature/phase3b-manual-relations
cd .worktrees/phase3b-manual-relations
```

Expected: `git status --short` is empty or only shows user-approved non-conflicting files; the new worktree is created on `feature/phase3b-manual-relations`.

- [ ] **Step 2: Verify the baseline before changes**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run
pnpm build
cd src-tauri
cargo test
```

Expected: current frontend tests pass, frontend build exits 0, and Rust tests pass before relation work begins.

## 3. Task 1: 新增 relations schema 与领域模型

**Files:**
- Modify: `src-tauri/src/infrastructure/db.rs`
- Create: `src-tauri/src/domain/relation.rs`
- Modify: `src-tauri/src/domain/mod.rs`

- [ ] **Step 1: Write the failing migration test**

In `src-tauri/src/infrastructure/db.rs`, add this test inside the existing `#[cfg(test)] mod tests`:

```rust
#[test]
fn test_open_and_migrate_creates_relations_table_and_unique_index() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("index.sqlite");

    let conn = open_and_migrate(&db_path).unwrap();

    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'relations'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1);

    let unique_index_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_relations_unique_triplet'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(unique_index_exists, 1);
}
```

- [ ] **Step 2: Run the migration test and confirm it fails**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations/src-tauri
cargo test infrastructure::db::tests::test_open_and_migrate_creates_relations_table_and_unique_index
```

Expected: FAIL because the `relations` table and unique index do not exist yet.

- [ ] **Step 3: Add the migration**

In `src-tauri/src/infrastructure/db.rs`, append this migration after `create_file_events`:

```rust
Migration {
    version: 9,
    name: "create_relations",
    sql: "CREATE TABLE IF NOT EXISTS relations (
        id             TEXT PRIMARY KEY,
        source_note_id TEXT NOT NULL,
        target_note_id TEXT NOT NULL,
        relation_type  TEXT NOT NULL,
        description    TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_note_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_note_id);
    CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_unique_triplet
    ON relations(source_note_id, target_note_id, relation_type);",
},
```

- [ ] **Step 4: Add the relation domain models**

Create `src-tauri/src/domain/relation.rs` with this content:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationType {
    Related,
    Prerequisite,
    Extension,
    Opposes,
    Supports,
    Similar,
}

impl RelationType {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "related" => Some(Self::Related),
            "prerequisite" => Some(Self::Prerequisite),
            "extension" => Some(Self::Extension),
            "opposes" => Some(Self::Opposes),
            "supports" => Some(Self::Supports),
            "similar" => Some(Self::Similar),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Related => "related",
            Self::Prerequisite => "prerequisite",
            Self::Extension => "extension",
            Self::Opposes => "opposes",
            Self::Supports => "supports",
            Self::Similar => "similar",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relation {
    pub id: String,
    pub source_note_id: String,
    pub target_note_id: String,
    pub relation_type: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationItem {
    pub id: String,
    pub relation_type: String,
    pub description: Option<String>,
    pub note_id: String,
    pub note_title: String,
    pub note_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteRelations {
    pub outgoing: Vec<RelationItem>,
    pub incoming: Vec<RelationItem>,
}
```

Then expose it from `src-tauri/src/domain/mod.rs`:

```rust
pub mod relation;
```

- [ ] **Step 5: Run the migration test again**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations/src-tauri
cargo test infrastructure::db::tests::test_open_and_migrate_creates_relations_table_and_unique_index
```

Expected: PASS.

- [ ] **Step 6: Commit the schema slice**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
git add src-tauri/src/infrastructure/db.rs src-tauri/src/domain/mod.rs src-tauri/src/domain/relation.rs
git commit -m "feat(relation): add relation schema and domain models"
```

## 4. Task 2: 实现 RelationService 与 Tauri commands

**Files:**
- Create: `src-tauri/src/services/relation.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Create: `src-tauri/src/commands/relation.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing service tests**

Create `src-tauri/src/services/relation.rs` with the tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db::open_and_migrate;
    use rusqlite::params;
    use tempfile::TempDir;

    fn setup_db() -> (TempDir, rusqlite::Connection) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("index.sqlite");
        let conn = open_and_migrate(&db_path).unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at, deleted_at)
             VALUES (?1, ?2, ?3, NULL, 'hash', 0, '{}', datetime('now'), datetime('now'), datetime('now'), NULL)",
            params!["n1", "notes/a.md", "A"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at, deleted_at)
             VALUES (?1, ?2, ?3, NULL, 'hash', 0, '{}', datetime('now'), datetime('now'), datetime('now'), NULL)",
            params!["n2", "notes/b.md", "B"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at, deleted_at)
             VALUES (?1, ?2, ?3, NULL, 'hash', 0, '{}', datetime('now'), datetime('now'), datetime('now'), NULL)",
            params!["n3", "notes/c.md", "C"],
        )
        .unwrap();
        (temp_dir, conn)
    }

    #[test]
    fn create_relation_rejects_self_relation() {
        let (_temp_dir, conn) = setup_db();
        let error = create_relation_in_conn(&conn, "n1", "n1", "related", None).unwrap_err();
        assert!(error.to_string().contains("self relation"));
    }

    #[test]
    fn create_relation_rejects_duplicates() {
        let (_temp_dir, conn) = setup_db();
        create_relation_in_conn(&conn, "n1", "n2", "related", None).unwrap();
        let error = create_relation_in_conn(&conn, "n1", "n2", "related", Some("again".into())).unwrap_err();
        assert!(error.to_string().contains("already exists"));
    }

    #[test]
    fn list_relations_groups_outgoing_and_incoming() {
        let (_temp_dir, conn) = setup_db();
        create_relation_in_conn(&conn, "n1", "n2", "related", None).unwrap();
        create_relation_in_conn(&conn, "n3", "n1", "supports", Some("evidence".into())).unwrap();

        let relations = list_relations_in_conn(&conn, "n1").unwrap();
        assert_eq!(relations.outgoing.len(), 1);
        assert_eq!(relations.incoming.len(), 1);
        assert_eq!(relations.outgoing[0].note_id, "n2");
        assert_eq!(relations.incoming[0].note_id, "n3");
    }

    #[test]
    fn delete_relation_removes_row() {
        let (_temp_dir, conn) = setup_db();
        let relation = create_relation_in_conn(&conn, "n1", "n2", "related", None).unwrap();
        delete_relation_in_conn(&conn, &relation.id).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM relations WHERE id = ?1", [&relation.id], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
```

- [ ] **Step 2: Run the service tests and confirm they fail**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations/src-tauri
cargo test services::relation::tests
```

Expected: FAIL because the functions do not exist yet.

- [ ] **Step 3: Implement the service**

Replace `src-tauri/src/services/relation.rs` with this implementation under the tests:

```rust
use crate::domain::relation::{NoteRelations, Relation, RelationItem, RelationType};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use ulid::Ulid;

fn ensure_note_exists(conn: &Connection, note_id: &str) -> AppResult<()> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM notes WHERE id = ?1 AND deleted_at IS NULL",
        [note_id],
        |row| row.get(0),
    )?;

    if exists == 0 {
        return Err(AppError::NotFound(format!("note not found: {note_id}")));
    }

    Ok(())
}

pub fn create_relation_in_conn(
    conn: &Connection,
    source_note_id: &str,
    target_note_id: &str,
    relation_type: &str,
    description: Option<String>,
) -> AppResult<Relation> {
    if source_note_id == target_note_id {
        return Err(AppError::InvalidInput("self relation is not allowed".into()));
    }
    let relation_type = RelationType::parse(relation_type)
        .ok_or_else(|| AppError::InvalidInput(format!("invalid relation type: {relation_type}")))?;

    ensure_note_exists(conn, source_note_id)?;
    ensure_note_exists(conn, target_note_id)?;

    let duplicate_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM relations WHERE source_note_id = ?1 AND target_note_id = ?2 AND relation_type = ?3",
        params![source_note_id, target_note_id, relation_type.as_str()],
        |row| row.get(0),
    )?;
    if duplicate_count > 0 {
        return Err(AppError::AlreadyExists("relation already exists".into()));
    }

    let id = Ulid::new().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO relations (id, source_note_id, target_note_id, relation_type, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, source_note_id, target_note_id, relation_type.as_str(), description, now, now],
    )?;

    Ok(Relation {
        id,
        source_note_id: source_note_id.to_string(),
        target_note_id: target_note_id.to_string(),
        relation_type: relation_type.as_str().to_string(),
        description,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn delete_relation_in_conn(conn: &Connection, relation_id: &str) -> AppResult<()> {
    let rows = conn.execute("DELETE FROM relations WHERE id = ?1", [relation_id])?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("relation not found: {relation_id}")));
    }
    Ok(())
}

pub fn list_relations_in_conn(conn: &Connection, note_id: &str) -> AppResult<NoteRelations> {
    ensure_note_exists(conn, note_id)?;

    let mut outgoing_stmt = conn.prepare(
        "SELECT r.id, r.relation_type, r.description, n.id, n.title, n.path, r.created_at, r.updated_at
         FROM relations r
         JOIN notes n ON n.id = r.target_note_id AND n.deleted_at IS NULL
         WHERE r.source_note_id = ?1
         ORDER BY n.title",
    )?;
    let outgoing = outgoing_stmt
        .query_map([note_id], |row| {
            Ok(RelationItem {
                id: row.get(0)?,
                relation_type: row.get(1)?,
                description: row.get(2)?,
                note_id: row.get(3)?,
                note_title: row.get(4)?,
                note_path: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut incoming_stmt = conn.prepare(
        "SELECT r.id, r.relation_type, r.description, n.id, n.title, n.path, r.created_at, r.updated_at
         FROM relations r
         JOIN notes n ON n.id = r.source_note_id AND n.deleted_at IS NULL
         WHERE r.target_note_id = ?1
         ORDER BY n.title",
    )?;
    let incoming = incoming_stmt
        .query_map([note_id], |row| {
            Ok(RelationItem {
                id: row.get(0)?,
                relation_type: row.get(1)?,
                description: row.get(2)?,
                note_id: row.get(3)?,
                note_title: row.get(4)?,
                note_path: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(NoteRelations { outgoing, incoming })
}
```

Expose the module from `src-tauri/src/services/mod.rs`:

```rust
pub mod relation;
```

- [ ] **Step 4: Add the Tauri commands**

Create `src-tauri/src/commands/relation.rs`:

```rust
use crate::domain::relation::{NoteRelations, Relation};
use crate::error::AppError;
use crate::services::relation::{create_relation_in_conn, delete_relation_in_conn, list_relations_in_conn};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn create_relation(
    state: State<'_, AppState>,
    source_note_id: String,
    target_note_id: String,
    relation_type: String,
    description: Option<String>,
) -> Result<Relation, AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    create_relation_in_conn(conn, &source_note_id, &target_note_id, &relation_type, description)
}

#[tauri::command]
pub async fn delete_relation(state: State<'_, AppState>, relation_id: String) -> Result<(), AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    delete_relation_in_conn(conn, &relation_id)
}

#[tauri::command]
pub async fn list_relations(state: State<'_, AppState>, note_id: String) -> Result<NoteRelations, AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    list_relations_in_conn(conn, &note_id)
}
```

Then expose and register them:

In `src-tauri/src/commands/mod.rs`:

```rust
pub mod relation;
```

In `src-tauri/src/lib.rs` add:

```rust
commands::relation::create_relation,
commands::relation::delete_relation,
commands::relation::list_relations,
```
```

- [ ] **Step 5: Run the focused Rust tests**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations/src-tauri
cargo test services::relation::tests infrastructure::db::tests::test_open_and_migrate_creates_relations_table_and_unique_index
```

Expected: PASS.

- [ ] **Step 6: Commit the backend relation slice**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
git add src-tauri/src/services/relation.rs src-tauri/src/services/mod.rs src-tauri/src/commands/relation.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(relation): add relation service and commands"
```

## 5. Task 3: 前端类型与 API 接线

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`

- [ ] **Step 1: Add the frontend relation types**

In `src/types/index.ts`, append these types after `NoteLinks`:

```ts
export type RelationType =
  | "related"
  | "prerequisite"
  | "extension"
  | "opposes"
  | "supports"
  | "similar";

export interface Relation {
  id: string;
  source_note_id: string;
  target_note_id: string;
  relation_type: RelationType;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface RelationItem {
  id: string;
  relation_type: RelationType;
  description: string | null;
  note_id: string;
  note_title: string;
  note_path: string;
  created_at: string;
  updated_at: string;
}

export interface NoteRelations {
  outgoing: RelationItem[];
  incoming: RelationItem[];
}
```

- [ ] **Step 2: Add the Tauri API helpers**

In `src/api/commands.ts`, update the imports and append these methods:

```ts
import type {
  KnowledgeBase,
  LinkItem,
  Note,
  NoteDetail,
  NoteLinks,
  NoteRelations,
  NoteTreeNode,
  Relation,
  RelationType,
  SaveNoteResult,
  SearchResult,
  Tag,
} from "../types";
```

```ts
  listRelations: (noteId: string) =>
    invoke<NoteRelations>("list_relations", { noteId }),

  createRelation: (
    sourceNoteId: string,
    targetNoteId: string,
    relationType: RelationType,
    description?: string,
  ) =>
    invoke<Relation>("create_relation", {
      sourceNoteId,
      targetNoteId,
      relationType,
      description: description?.trim() ? description.trim() : null,
    }),

  deleteRelation: (relationId: string) =>
    invoke<void>("delete_relation", { relationId }),
```

- [ ] **Step 3: Run a narrow type check via the existing build**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm build
```

Expected: the build still fails later because the new UI files are not implemented yet, but `src/types/index.ts` and `src/api/commands.ts` should be type-correct.

- [ ] **Step 4: Commit the frontend contract slice**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
git add src/types/index.ts src/api/commands.ts
git commit -m "feat(relation): add frontend relation contracts"
```

## 6. Task 4: 手动关系面板 UI

**Files:**
- Create: `src/components/RightSidebar/ManualRelationsPanel.tsx`
- Create: `src/components/RightSidebar/ManualRelationsPanel.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `src/components/RightSidebar/ManualRelationsPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualRelationsPanel } from "./ManualRelationsPanel";

const apiMocks = vi.hoisted(() => ({
  listRelations: vi.fn(),
  createRelation: vi.fn(),
  deleteRelation: vi.fn(),
  searchNotes: vi.fn(),
}));

vi.mock("../../api/commands", () => ({
  api: apiMocks,
}));

vi.mock("../../store/useAppStore", () => ({
  useAppStore: (selector: (state: { kb: { id: string } | null }) => unknown) =>
    selector({ kb: { id: "kb-1" } }),
}));

describe("ManualRelationsPanel", () => {
  beforeEach(() => {
    apiMocks.listRelations.mockResolvedValue({ outgoing: [], incoming: [] });
    apiMocks.createRelation.mockResolvedValue(undefined);
    apiMocks.deleteRelation.mockResolvedValue(undefined);
    apiMocks.searchNotes.mockResolvedValue([
      { note_id: "note-2", title: "Target", path: "notes/target.md", snippet: "" },
    ]);
  });

  it("shows the empty state and loads relations", async () => {
    render(<ManualRelationsPanel noteId="note-1" />);
    await waitFor(() => expect(apiMocks.listRelations).toHaveBeenCalledWith("note-1"));
    expect(screen.getByText("暂无手动关系")).toBeInTheDocument();
  });

  it("creates a relation and refreshes the list", async () => {
    const user = userEvent.setup();
    render(<ManualRelationsPanel noteId="note-1" />);

    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "Target");
    await user.click(await screen.findByText("Target"));
    await user.selectOptions(screen.getByLabelText("关系类型"), "related");
    await user.type(screen.getByLabelText("说明"), "Useful link");
    await user.click(screen.getByRole("button", { name: "保存关系" }));

    await waitFor(() => {
      expect(apiMocks.createRelation).toHaveBeenCalledWith("note-1", "note-2", "related", "Useful link");
      expect(apiMocks.listRelations).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces duplicate relation errors", async () => {
    const user = userEvent.setup();
    apiMocks.createRelation.mockRejectedValueOnce(new Error("Already exists: relation already exists"));
    render(<ManualRelationsPanel noteId="note-1" />);

    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.type(screen.getByPlaceholderText("搜索目标笔记"), "Target");
    await user.click(await screen.findByText("Target"));
    await user.click(screen.getByRole("button", { name: "保存关系" }));

    expect(await screen.findByText("该关系已存在")).toBeInTheDocument();
  });

  it("deletes an outgoing relation", async () => {
    const user = userEvent.setup();
    apiMocks.listRelations.mockResolvedValueOnce({
      outgoing: [
        {
          id: "rel-1",
          relation_type: "related",
          description: null,
          note_id: "note-2",
          note_title: "Target",
          note_path: "notes/target.md",
          created_at: "2026-05-31T00:00:00Z",
          updated_at: "2026-05-31T00:00:00Z",
        },
      ],
      incoming: [],
    });

    render(<ManualRelationsPanel noteId="note-1" />);
    await user.click(await screen.findByRole("button", { name: "删除 Target 关系" }));

    await waitFor(() => expect(apiMocks.deleteRelation).toHaveBeenCalledWith("rel-1"));
  });
});
```

- [ ] **Step 2: Run the component tests and confirm they fail**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/RightSidebar/ManualRelationsPanel.test.tsx
```

Expected: FAIL because `ManualRelationsPanel` does not exist yet.

- [ ] **Step 3: Implement the component**

Create `src/components/RightSidebar/ManualRelationsPanel.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/commands";
import { useAppStore } from "../../store/useAppStore";
import type { NoteRelations, RelationItem, RelationType, SearchResult } from "../../types";

const RELATION_LABELS: Record<RelationType, string> = {
  related: "相关",
  prerequisite: "前置知识",
  extension: "延伸阅读",
  opposes: "反驳",
  supports: "支撑",
  similar: "同义或相似",
};

export function ManualRelationsPanel({ noteId }: { noteId: string | null }) {
  const kb = useAppStore((s) => s.kb);
  const [relations, setRelations] = useState<NoteRelations | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [target, setTarget] = useState<SearchResult | null>(null);
  const [relationType, setRelationType] = useState<RelationType>("related");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const filteredResults = useMemo(
    () => searchResults.filter((item) => item.note_id !== noteId),
    [searchResults, noteId],
  );

  async function loadRelations() {
    if (!noteId) {
      setRelations(null);
      return;
    }
    setLoading(true);
    try {
      setRelations(await api.listRelations(noteId));
    } catch {
      setRelations({ outgoing: [], incoming: [] });
      setError("关系加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRelations();
  }, [noteId]);

  useEffect(() => {
    if (!kb || !query.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    api.searchNotes(query.trim(), kb.id)
      .then((results) => {
        if (!cancelled) setSearchResults(results);
      })
      .catch(() => {
        if (!cancelled) setSearchResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kb, query]);

  async function handleCreate() {
    if (!noteId || !target) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createRelation(noteId, target.note_id, relationType, description || undefined);
      setShowForm(false);
      setQuery("");
      setSearchResults([]);
      setTarget(null);
      setDescription("");
      await loadRelations();
    } catch (e) {
      const message = String(e);
      setError(message.includes("Already exists") ? "该关系已存在" : "保存关系失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: RelationItem) {
    await api.deleteRelation(item.id);
    await loadRelations();
  }

  if (!noteId) {
    return <div style={{ padding: "8px 0", fontSize: 12, color: "#999" }}>选择笔记后查看关系</div>;
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#666" }}>手动关系</div>
        <button onClick={() => setShowForm((value) => !value)}>{showForm ? "收起" : "添加关系"}</button>
      </div>
      {showForm && (
        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <input placeholder="搜索目标笔记" value={query} onChange={(e) => setQuery(e.target.value)} />
          {target ? <div>已选择：{target.title}</div> : null}
          {filteredResults.map((item) => (
            <button key={item.note_id} type="button" onClick={() => setTarget(item)}>
              {item.title}
            </button>
          ))}
          <label>
            关系类型
            <select aria-label="关系类型" value={relationType} onChange={(e) => setRelationType(e.target.value as RelationType)}>
              {Object.entries(RELATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            说明
            <input aria-label="说明" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {error ? <div>{error}</div> : null}
          <button type="button" disabled={!target || submitting} onClick={handleCreate}>保存关系</button>
        </div>
      )}
      {loading ? <div>加载中...</div> : null}
      {!loading && relations && relations.outgoing.length === 0 && relations.incoming.length === 0 ? (
        <div>暂无手动关系</div>
      ) : null}
      {relations?.outgoing.map((item) => (
        <div key={item.id}>
          <span>{RELATION_LABELS[item.relation_type]} · {item.note_title}</span>
          <button type="button" aria-label={`删除 ${item.note_title} 关系`} onClick={() => void handleDelete(item)}>删除</button>
        </div>
      ))}
      {relations?.incoming.map((item) => (
        <div key={item.id}>
          <span>{item.note_title} · {RELATION_LABELS[item.relation_type]}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the component tests again**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/RightSidebar/ManualRelationsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the manual relation panel slice**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
git add src/components/RightSidebar/ManualRelationsPanel.tsx src/components/RightSidebar/ManualRelationsPanel.test.tsx
git commit -m "feat(relation): add manual relations sidebar panel"
```

## 7. Task 5: 链接页签集成与回归验证

**Files:**
- Modify: `src/components/RightSidebar/BacklinksPanel.tsx`
- Create: `src/components/RightSidebar/BacklinksPanel.test.tsx`

- [ ] **Step 1: Write the failing integration test for the links tab**

Create `src/components/RightSidebar/BacklinksPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BacklinksPanel } from "./BacklinksPanel";

const apiMocks = vi.hoisted(() => ({
  getNoteLinks: vi.fn(),
}));

vi.mock("../../api/commands", () => ({
  api: {
    ...apiMocks,
  },
}));

vi.mock("./ManualRelationsPanel", () => ({
  ManualRelationsPanel: ({ noteId }: { noteId: string | null }) => <div>Manual panel for {noteId}</div>,
}));

vi.mock("../../hooks/useOpenNote", () => ({
  useOpenNote: () => ({ openNote: vi.fn() }),
}));

describe("BacklinksPanel", () => {
  beforeEach(() => {
    apiMocks.getNoteLinks.mockResolvedValue({ outgoing: [], incoming: [] });
  });

  it("renders link sections and the manual relations panel together", async () => {
    render(<BacklinksPanel noteId="note-1" />);

    await waitFor(() => expect(apiMocks.getNoteLinks).toHaveBeenCalledWith("note-1"));
    expect(screen.getByText("传出链接")).toBeInTheDocument();
    expect(screen.getByText("反向链接 (backlinks)")).toBeInTheDocument();
    expect(screen.getByText("Manual panel for note-1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the integration test and confirm it fails**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/RightSidebar/BacklinksPanel.test.tsx
```

Expected: FAIL because `BacklinksPanel` does not render `ManualRelationsPanel` yet.

- [ ] **Step 3: Integrate the manual relations panel**

In `src/components/RightSidebar/BacklinksPanel.tsx`, import and render the new component near the end of the return block:

```tsx
import { ManualRelationsPanel } from "./ManualRelationsPanel";
```

```tsx
      <div style={sectionStyle}>
        <ManualRelationsPanel noteId={noteId} />
      </div>
```

Keep the existing auto-link opening behavior unchanged. Do not move this work into `RightSidebar.tsx`; the `links` tab already points to `BacklinksPanel`, and this keeps the relation feature co-located with automatic link rendering.

- [ ] **Step 4: Run the focused frontend tests**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/RightSidebar/ManualRelationsPanel.test.tsx src/components/RightSidebar/BacklinksPanel.test.tsx src/components/SearchOverlay.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected: PASS. Existing `SearchOverlay` and `MarkdownPreview` tests should continue to pass untouched.

- [ ] **Step 5: Commit the links-tab integration slice**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
git add src/components/RightSidebar/BacklinksPanel.tsx src/components/RightSidebar/BacklinksPanel.test.tsx
git commit -m "feat(relation): integrate manual relations into links tab"
```

## 8. Task 6: 总验证

**Files:**
- No code changes required unless validation finds a local defect.

- [ ] **Step 1: Run the full frontend test suite**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run the frontend build**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm build
```

Expected: build exits 0. Existing chunk-size warning is acceptable if nothing new regresses.

- [ ] **Step 3: Run the full Rust test suite**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations/src-tauri
cargo test
```

Expected: all Rust tests pass, including new relation tests and migration coverage.

- [ ] **Step 4: Run diff hygiene check**

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
git diff --check
```

Expected: no output.

- [ ] **Step 5: Final commit or fix-forward**

If any validation fails, fix the specific slice and rerun the same command before proceeding. If all commands pass, create the final feature commit:

```bash
cd /Users/lijun/mynote/.worktrees/phase3b-manual-relations
git status --short
git add src-tauri/src/infrastructure/db.rs src-tauri/src/domain/mod.rs src-tauri/src/domain/relation.rs src-tauri/src/services/relation.rs src-tauri/src/services/mod.rs src-tauri/src/commands/relation.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/types/index.ts src/api/commands.ts src/components/RightSidebar/ManualRelationsPanel.tsx src/components/RightSidebar/ManualRelationsPanel.test.tsx src/components/RightSidebar/BacklinksPanel.tsx src/components/RightSidebar/BacklinksPanel.test.tsx
git commit -m "feat(relation): add manual relations management"
```

Expected: clean working tree except for intentionally uncommitted documentation updates.

## 9. 计划自检

### 9.1 Spec coverage

- `relations` schema、唯一 triplet 去重、自关联禁止：Task 1 和 Task 2 覆盖。
- `create_relation` / `delete_relation` / `list_relations`：Task 2 覆盖。
- 右侧栏 links 页签内新增手动关系区域：Task 4 和 Task 5 覆盖。
- 目标笔记选择、关系类型、说明、重复错误、删除：Task 4 覆盖。
- 3C 不实现但保持 graph-ready：通过固定 relation schema 和 NoteRelations / RelationItem 契约，在 Task 1-3 中落实。

结论：当前 plan 覆盖了 3B spec 的实现范围，没有把 3C 的 graph API 或 UI 混入本轮任务。

### 9.2 Placeholder scan

- 未使用 `TODO`、`TBD`、`implement later` 等占位描述。
- 每个任务都给出实际文件路径、代码片段和验证命令。

### 9.3 Type consistency

- 后端统一使用 `Relation`, `RelationItem`, `NoteRelations`。
- 前端统一使用 `RelationType`, `Relation`, `RelationItem`, `NoteRelations`。
- Tauri command 名称统一为 `create_relation`, `delete_relation`, `list_relations`，对应前端 `createRelation`, `deleteRelation`, `listRelations`。
