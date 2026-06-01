# Tag Context Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade tags from a simple filter into a navigation entry that shows tag context in the lower tag sidebar, lists the 5 most recently updated matching notes, and jumps both editor and preview to the selected tag occurrence.

**Architecture:** Keep Markdown files as the source of truth and extend the existing SQLite-derived index with a `tag_occurrences` layer for per-note tag positions. Rust owns occurrence extraction, persistence, and the new `get_tag_context` query; React consumes typed commands, stores an active tag context plus one-shot navigation target, and uses the existing source-line sync primitives to align editor and preview on the same occurrence.

**Tech Stack:** Rust, rusqlite, Tauri commands, React 19, TypeScript, Zustand, CodeMirror 6, markdown-it, Vitest/React Testing Library, Playwright.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-01 | v1.0 | 根据已批准的标签上下文导航设计创建 implementation plan。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 执行前准备](#2-执行前准备)
- [3. Task 1: 新增标签命中索引与 Rust 提取能力](#3-task-1-新增标签命中索引与-rust-提取能力)
- [4. Task 2: 实现标签上下文查询接口](#4-task-2-实现标签上下文查询接口)
- [5. Task 3: 前端类型、API 与全局状态接线](#5-task-3-前端类型api-与全局状态接线)
- [6. Task 4: 标签栏上下文区 UI](#6-task-4-标签栏上下文区-ui)
- [7. Task 5: 编辑区与预览区标签导航](#7-task-5-编辑区与预览区标签导航)
- [8. Task 6: 总验证](#8-task-6-总验证)
- [9. 计划自检](#9-计划自检)

## 1. 文件结构

### Rust 修改

- Modify: `/Users/lijun/mynote/src-tauri/src/infrastructure/db.rs` - 新增 `tag_occurrences` migration 和 migration test。
- Modify: `/Users/lijun/mynote/src-tauri/src/infrastructure/markdown.rs` - 新增 inline tag occurrence 抽取与测试。
- Modify: `/Users/lijun/mynote/src-tauri/src/domain/tag.rs` - 新增 `TagContextItem`, `TagContext` DTO。
- Modify: `/Users/lijun/mynote/src-tauri/src/services/index.rs` - 索引阶段重建 `tag_occurrences`。
- Modify: `/Users/lijun/mynote/src-tauri/src/services/tag.rs` - 新增 `get_tag_context_in_conn` / `get_tag_context_service`。
- Modify: `/Users/lijun/mynote/src-tauri/src/commands/tag.rs` - 暴露 `get_tag_context` command。
- Modify: `/Users/lijun/mynote/src-tauri/src/lib.rs` - 注册 `get_tag_context`。

### 前端修改

- Modify: `/Users/lijun/mynote/src/types/index.ts` - 新增 `TagContextItem`, `TagContext`, `TagNavigationTarget`。
- Modify: `/Users/lijun/mynote/src/api/commands.ts` - 新增 `getTagContext(tagId)`。
- Modify: `/Users/lijun/mynote/src/store/useAppStore.ts` - 新增 active tag context 状态。
- Modify: `/Users/lijun/mynote/src/store/useEditorStore.ts` - 新增一次性标签导航目标状态。
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/TagPanel.tsx` - 渲染下部标签上下文区并触发导航。
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx` - 继续消费 `selectedTagIds`，无需改职责，但需要验证与 active context 共存。
- Modify: `/Users/lijun/mynote/src/components/EditorWorkspace/EditorWorkspace.tsx` - 连接导航目标到 editor/preview。
- Modify: `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownEditor.tsx` - 基于 `line_start` 导航并高亮目标 tag。
- Modify: `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownPreview.tsx` - 基于 `line_start` 导航并高亮目标 tag chip。

### 测试修改

- Modify: `/Users/lijun/mynote/src-tauri/src/infrastructure/db.rs` - `tag_occurrences` migration test。
- Modify: `/Users/lijun/mynote/src-tauri/src/infrastructure/markdown.rs` - occurrence 抽取测试。
- Modify: `/Users/lijun/mynote/src-tauri/src/services/tag.rs` - `get_tag_context_in_conn` 排序/代表命中/`has_more` 测试。
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/TagPanel.test.tsx` - 标签上下文区渲染、最多 5 条、点击导航。
- Modify: `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownEditor.test.tsx` - 消费标签导航目标后定位与高亮。
- Modify: `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownPreview.test.tsx` - 消费标签导航目标后定位与高亮。

## 2. 执行前准备

Implementation should happen in an isolated worktree.

- [ ] **Step 1: Create the implementation worktree**

```bash
cd /Users/lijun/mynote
git status --short
git worktree add .worktrees/tag-context-navigation -b feature/tag-context-navigation
cd .worktrees/tag-context-navigation
```

Expected: `git status --short` shows only user-approved existing changes or an otherwise understood baseline, and the new worktree is created on `feature/tag-context-navigation`.

- [ ] **Step 2: Verify the baseline before changes**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run
pnpm build
pnpm test:e2e
cd src-tauri
cargo test
```

Expected: frontend tests pass, build exits 0, Playwright smoke test passes, and Rust tests pass before tag-context work begins.

## 3. Task 1: 新增标签命中索引与 Rust 提取能力

**Files:**
- Modify: `/Users/lijun/mynote/src-tauri/src/infrastructure/db.rs`
- Modify: `/Users/lijun/mynote/src-tauri/src/infrastructure/markdown.rs`
- Modify: `/Users/lijun/mynote/src-tauri/src/domain/tag.rs`
- Modify: `/Users/lijun/mynote/src-tauri/src/services/index.rs`

- [ ] **Step 1: Write the failing migration test for `tag_occurrences`**

In `/Users/lijun/mynote/src-tauri/src/infrastructure/db.rs`, add this test inside the existing `#[cfg(test)] mod tests`:

```rust
#[test]
fn test_open_and_migrate_creates_tag_occurrences_table() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("index.sqlite");

    let conn = open_and_migrate(&db_path).unwrap();

    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tag_occurrences'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1);

    let index_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_tag_occurrences_note_tag_order'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(index_exists, 1);
}
```

- [ ] **Step 2: Run the migration test and confirm it fails**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation/src-tauri
cargo test infrastructure::db::tests::test_open_and_migrate_creates_tag_occurrences_table
```

Expected: FAIL because `tag_occurrences` does not exist yet.

- [ ] **Step 3: Add the `tag_occurrences` migration**

In `/Users/lijun/mynote/src-tauri/src/infrastructure/db.rs`, append a new migration after version 9:

```rust
Migration {
    version: 10,
    name: "create_tag_occurrences",
    sql: "CREATE TABLE IF NOT EXISTS tag_occurrences (
        id               TEXT PRIMARY KEY,
        note_id          TEXT NOT NULL,
        tag_id           TEXT NOT NULL,
        source           TEXT NOT NULL,
        line_start       INTEGER NOT NULL,
        line_end         INTEGER NOT NULL,
        heading_context  TEXT,
        context_snippet  TEXT NOT NULL,
        occurrence_order INTEGER NOT NULL,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tag_occurrences_note_tag_order
    ON tag_occurrences(note_id, tag_id, occurrence_order);
    CREATE INDEX IF NOT EXISTS idx_tag_occurrences_tag_note
    ON tag_occurrences(tag_id, note_id);",
},
```

- [ ] **Step 4: Write the failing occurrence extraction test**

In `/Users/lijun/mynote/src-tauri/src/infrastructure/markdown.rs`, add this test:

```rust
#[test]
fn test_extract_inline_tag_occurrences_returns_lines_and_context() {
    let body = [
        "# Title",
        "",
        "Alpha #项目报告 here.",
        "## Section",
        "Beta #项目报告 again.",
    ]
    .join("\n");

    let occurrences = extract_inline_tag_occurrences(&body);

    assert_eq!(occurrences.len(), 2);
    assert_eq!(occurrences[0].tag_name, "项目报告");
    assert_eq!(occurrences[0].line_start, 3);
    assert_eq!(occurrences[0].heading_context.as_deref(), Some("Title"));
    assert_eq!(occurrences[1].heading_context.as_deref(), Some("Section"));
}
```

- [ ] **Step 5: Run the markdown occurrence test and confirm it fails**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation/src-tauri
cargo test infrastructure::markdown::tests::test_extract_inline_tag_occurrences_returns_lines_and_context
```

Expected: FAIL because `extract_inline_tag_occurrences` does not exist yet.

- [ ] **Step 6: Add occurrence structs and extraction logic**

In `/Users/lijun/mynote/src-tauri/src/infrastructure/markdown.rs`, add these types and function near the existing inline tag extraction helpers:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineTagOccurrence {
    pub tag_name: String,
    pub line_start: i64,
    pub line_end: i64,
    pub heading_context: Option<String>,
    pub context_snippet: String,
}

pub fn extract_inline_tag_occurrences(body: &str) -> Vec<InlineTagOccurrence> {
    let mut occurrences = Vec::new();
    let mut in_code_block = false;
    let mut current_heading: Option<String> = None;

    for (index, line) in body.lines().enumerate() {
        let line_number = (index + 1) as i64;
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("# ") {
            current_heading = Some(rest.trim().to_string());
        } else if let Some(rest) = trimmed.strip_prefix("## ") {
            current_heading = Some(rest.trim().to_string());
        }

        for matched in extract_inline_tags(line) {
            occurrences.push(InlineTagOccurrence {
                tag_name: matched,
                line_start: line_number,
                line_end: line_number,
                heading_context: current_heading.clone(),
                context_snippet: line.trim().to_string(),
            });
        }
    }

    occurrences
}
```

Also extend `/Users/lijun/mynote/src-tauri/src/domain/tag.rs` with DTOs:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagContextItem {
    pub note_id: String,
    pub note_path: String,
    pub note_title: String,
    pub note_updated_at: String,
    pub source: String,
    pub line_start: i64,
    pub line_end: i64,
    pub heading_context: Option<String>,
    pub context_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagContext {
    pub tag_id: String,
    pub tag_name: String,
    pub total_notes: i64,
    pub visible_count: i64,
    pub has_more: bool,
    pub items: Vec<TagContextItem>,
}
```

- [ ] **Step 7: Rebuild `tag_occurrences` during note indexing**

In `/Users/lijun/mynote/src-tauri/src/services/index.rs`, import `extract_inline_tag_occurrences`, delete old occurrences for the note, and insert new rows after `note_tags` is rebuilt:

```rust
let inline_occurrences = extract_inline_tag_occurrences(&parsed.body);

tx.execute("DELETE FROM tag_occurrences WHERE note_id = ?1", params![actual_id.clone()])?;
for (index, occurrence) in inline_occurrences.iter().enumerate() {
    let tag_id: String = tx.query_row(
        "SELECT id FROM tags WHERE normalized_name = ?1",
        params![occurrence.tag_name.to_lowercase()],
        |row| row.get(0),
    )?;

    tx.execute(
        "INSERT INTO tag_occurrences (id, note_id, tag_id, source, line_start, line_end, heading_context, context_snippet, occurrence_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            Ulid::new().to_string(),
            actual_id.clone(),
            tag_id,
            "inline",
            occurrence.line_start,
            occurrence.line_end,
            occurrence.heading_context,
            occurrence.context_snippet,
            index as i64,
            now,
            now,
        ],
    )?;
}
```

- [ ] **Step 8: Run the focused Rust tests and confirm they pass**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation/src-tauri
cargo test infrastructure::db::tests::test_open_and_migrate_creates_tag_occurrences_table
cargo test infrastructure::markdown::tests::test_extract_inline_tag_occurrences_returns_lines_and_context
```

Expected: PASS.

- [ ] **Step 9: Commit the indexing slice**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
git add src-tauri/src/infrastructure/db.rs src-tauri/src/infrastructure/markdown.rs src-tauri/src/domain/tag.rs src-tauri/src/services/index.rs
git commit -m "feat(tags): index tag occurrences"
```

## 4. Task 2: 实现标签上下文查询接口

**Files:**
- Modify: `/Users/lijun/mynote/src-tauri/src/services/tag.rs`
- Modify: `/Users/lijun/mynote/src-tauri/src/commands/tag.rs`
- Modify: `/Users/lijun/mynote/src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing service test for `get_tag_context_in_conn`**

In `/Users/lijun/mynote/src-tauri/src/services/tag.rs`, add this test:

```rust
#[test]
fn get_tag_context_in_conn_returns_latest_five_notes_with_representative_occurrence() {
    let (root, conn) = setup_tag_delete_db();

    for i in 0..6 {
        let path = format!("notes/n-{i}.md");
        let content = format!("# Note {i}\n\nbody #项目报告");
        std::fs::write(root.path().join(&path), &content).unwrap();
        index_note_full(&conn, root.path(), &path, &content).unwrap();
        conn.execute(
            "UPDATE notes SET updated_at = ?1 WHERE path = ?2",
            rusqlite::params![format!("2026-06-0{}T00:00:00Z", i + 1), path],
        )
        .unwrap();
    }

    let tag_id: String = conn
        .query_row("SELECT id FROM tags WHERE normalized_name = '项目报告'", [], |row| row.get(0))
        .unwrap();

    let context = get_tag_context_in_conn(&conn, &tag_id).unwrap();

    assert_eq!(context.total_notes, 6);
    assert_eq!(context.visible_count, 5);
    assert!(context.has_more);
    assert_eq!(context.items[0].note_path, "notes/n-5.md");
    assert_eq!(context.items[4].note_path, "notes/n-1.md");
    assert_eq!(context.items[0].source, "inline");
}
```

- [ ] **Step 2: Run the service test and confirm it fails**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation/src-tauri
cargo test services::tag::tests::get_tag_context_in_conn_returns_latest_five_notes_with_representative_occurrence
```

Expected: FAIL because `get_tag_context_in_conn` does not exist yet.

- [ ] **Step 3: Implement `get_tag_context_in_conn` and `get_tag_context_service`**

In `/Users/lijun/mynote/src-tauri/src/services/tag.rs`, add:

```rust
pub fn get_tag_context_in_conn(conn: &Connection, tag_id: &str) -> AppResult<TagContext> {
    let (tag_name, total_notes): (String, i64) = conn.query_row(
        "SELECT t.name, COUNT(DISTINCT nt.note_id)
         FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id
         LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
         WHERE t.id = ?1
         GROUP BY t.id",
        [tag_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let mut stmt = conn.prepare(
        "SELECT n.id, n.path, n.title, n.updated_at,
                o.source, o.line_start, o.line_end, o.heading_context, o.context_snippet
         FROM notes n
         JOIN note_tags nt ON nt.note_id = n.id
         LEFT JOIN tag_occurrences o
           ON o.id = (
             SELECT o2.id
             FROM tag_occurrences o2
             WHERE o2.note_id = n.id AND o2.tag_id = nt.tag_id
             ORDER BY o2.occurrence_order ASC
             LIMIT 1
           )
         WHERE nt.tag_id = ?1 AND n.deleted_at IS NULL
         ORDER BY n.updated_at DESC
         LIMIT 5",
    )?;

    let items = stmt
        .query_map([tag_id], |row| {
            Ok(TagContextItem {
                note_id: row.get(0)?,
                note_path: row.get(1)?,
                note_title: row.get(2)?,
                note_updated_at: row.get(3)?,
                source: row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "front_matter".into()),
                line_start: row.get::<_, Option<i64>>(5)?.unwrap_or(1),
                line_end: row.get::<_, Option<i64>>(6)?.unwrap_or(1),
                heading_context: row.get(7)?,
                context_snippet: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "Front Matter 标签".into()),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(TagContext {
        tag_id: tag_id.to_string(),
        tag_name,
        total_notes,
        visible_count: items.len() as i64,
        has_more: total_notes > 5,
        items,
    })
}

pub fn get_tag_context_service(state: &State<AppState>, tag_id: &str) -> AppResult<TagContext> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    get_tag_context_in_conn(conn, tag_id)
}
```

- [ ] **Step 4: Expose the Tauri command**

In `/Users/lijun/mynote/src-tauri/src/commands/tag.rs`, add:

```rust
#[tauri::command]
pub fn get_tag_context(tag_id: String, state: State<AppState>) -> Result<crate::domain::tag::TagContext, String> {
    get_tag_context_service(&state, &tag_id).map_err(|e| e.to_string())
}
```

Import `get_tag_context_service`, and register the command in `/Users/lijun/mynote/src-tauri/src/lib.rs`:

```rust
commands::tag::get_tag_context,
```

- [ ] **Step 5: Run the focused service test and confirm it passes**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation/src-tauri
cargo test services::tag::tests::get_tag_context_in_conn_returns_latest_five_notes_with_representative_occurrence
```

Expected: PASS.

- [ ] **Step 6: Commit the tag-context API slice**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
git add src-tauri/src/services/tag.rs src-tauri/src/commands/tag.rs src-tauri/src/lib.rs
git commit -m "feat(tags): add tag context query"
```

## 5. Task 3: 前端类型、API 与全局状态接线

**Files:**
- Modify: `/Users/lijun/mynote/src/types/index.ts`
- Modify: `/Users/lijun/mynote/src/api/commands.ts`
- Modify: `/Users/lijun/mynote/src/store/useAppStore.ts`
- Modify: `/Users/lijun/mynote/src/store/useEditorStore.ts`

- [ ] **Step 1: Write the failing store-oriented UI test**

In `/Users/lijun/mynote/src/components/LeftSidebar/TagPanel.test.tsx`, add this test before implementation:

```tsx
it("loads tag context after clicking a tag and stores the active tag state", async () => {
  const user = userEvent.setup();
  apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 6 }]);
  apiMocks.getTagContext.mockResolvedValue({
    tag_id: "tag-1",
    tag_name: "项目报告",
    total_notes: 6,
    visible_count: 1,
    has_more: true,
    items: [],
  });

  render(<TagPanel />);
  await user.click(await screen.findByRole("button", { name: "标签 项目报告 6" }));

  await waitFor(() => expect(apiMocks.getTagContext).toHaveBeenCalledWith("tag-1"));
  expect(useAppStore.getState().activeTagContext?.tag_id).toBe("tag-1");
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
corepack pnpm vitest run src/components/LeftSidebar/TagPanel.test.tsx -t "loads tag context after clicking a tag and stores the active tag state"
```

Expected: FAIL because `getTagContext` and `activeTagContext` do not exist yet.

- [ ] **Step 3: Add frontend types and API methods**

In `/Users/lijun/mynote/src/types/index.ts`, append:

```ts
export interface TagContextItem {
  note_id: string;
  note_path: string;
  note_title: string;
  note_updated_at: string;
  source: "inline" | "front_matter";
  line_start: number;
  line_end: number;
  heading_context: string | null;
  context_snippet: string;
}

export interface TagContext {
  tag_id: string;
  tag_name: string;
  total_notes: number;
  visible_count: number;
  has_more: boolean;
  items: TagContextItem[];
}

export interface TagNavigationTarget extends TagContextItem {
  tag_name: string;
  revision: number;
}
```

In `/Users/lijun/mynote/src/api/commands.ts`, add:

```ts
getTagContext: (tagId: string) =>
  invoke<TagContext>("get_tag_context", { tagId }),
```

- [ ] **Step 4: Add app/editor store state**

In `/Users/lijun/mynote/src/store/useAppStore.ts`, add:

```ts
activeTagContext: TagContext | null;
setActiveTagContext: (context: TagContext | null) => void;
```

and initialize it with:

```ts
activeTagContext: null,
setActiveTagContext: (context) => set({ activeTagContext: context }),
```

In `/Users/lijun/mynote/src/store/useEditorStore.ts`, add:

```ts
tagNavigationTarget: TagNavigationTarget | null;
setTagNavigationTarget: (target: TagNavigationTarget | null) => void;
```

and initialize with:

```ts
tagNavigationTarget: null,
setTagNavigationTarget: (target) => set({ tagNavigationTarget: target }),
```

- [ ] **Step 5: Re-run the focused TagPanel test to confirm the contract gap is now isolated to UI wiring**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
corepack pnpm vitest run src/components/LeftSidebar/TagPanel.test.tsx -t "loads tag context after clicking a tag and stores the active tag state"
```

Expected: the test can remain red at this point, but the remaining failure should be limited to missing TagPanel behavior. No additional contract/type errors should remain after this task.

- [ ] **Step 6: Commit the front-end contract slice**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
git add src/types/index.ts src/api/commands.ts src/store/useAppStore.ts src/store/useEditorStore.ts
git commit -m "feat(tags): add tag context frontend contracts"
```

## 6. Task 4: 标签栏上下文区 UI

**Files:**
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/TagPanel.tsx`
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/TagPanel.test.tsx`

- [ ] **Step 1: Write the failing UI tests for the context panel**

In `/Users/lijun/mynote/src/components/LeftSidebar/TagPanel.test.tsx`, add these tests:

```tsx
it("renders the latest five context items and the overflow indicator", async () => {
  const user = userEvent.setup();
  apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 6 }]);
  apiMocks.getTagContext.mockResolvedValue({
    tag_id: "tag-1",
    tag_name: "项目报告",
    total_notes: 6,
    visible_count: 5,
    has_more: true,
    items: Array.from({ length: 5 }, (_, index) => ({
      note_id: `note-${index}`,
      note_path: `notes/${index}.md`,
      note_title: `笔记 ${index}`,
      note_updated_at: `2026-06-0${index + 1}T00:00:00Z`,
      source: "inline",
      line_start: index + 3,
      line_end: index + 3,
      heading_context: "Section",
      context_snippet: `片段 ${index}`,
    })),
  });

  render(<TagPanel />);
  await user.click(await screen.findByRole("button", { name: "标签 项目报告 6" }));

  expect(await screen.findByText("项目报告 · 6 篇")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /打开标签命中文章/ })).toHaveLength(5);
  expect(screen.getByText("... 还有更多")).toBeInTheDocument();
});

it("dispatches a tag navigation target when clicking a context item", async () => {
  const user = userEvent.setup();
  apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 1 }]);
  apiMocks.getTagContext.mockResolvedValue({
    tag_id: "tag-1",
    tag_name: "项目报告",
    total_notes: 1,
    visible_count: 1,
    has_more: false,
    items: [{
      note_id: "note-1",
      note_path: "notes/target.md",
      note_title: "Target",
      note_updated_at: "2026-06-01T00:00:00Z",
      source: "inline",
      line_start: 12,
      line_end: 12,
      heading_context: "Section",
      context_snippet: "命中片段",
    }],
  });
  apiMocks.getNoteByPath.mockResolvedValue(makeNoteDetail({ note: makeNote({ path: "notes/target.md" }) }));

  render(<TagPanel />);
  await user.click(await screen.findByRole("button", { name: "标签 项目报告 1" }));
  await user.click(await screen.findByRole("button", { name: "打开标签命中文章 Target" }));

  await waitFor(() => expect(apiMocks.getNoteByPath).toHaveBeenCalledWith("notes/target.md"));
  expect(useEditorStore.getState().tagNavigationTarget?.line_start).toBe(12);
});
```

- [ ] **Step 2: Run the TagPanel tests and confirm they fail**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
corepack pnpm vitest run src/components/LeftSidebar/TagPanel.test.tsx
```

Expected: FAIL because the context panel UI and navigation dispatch do not exist yet.

- [ ] **Step 3: Implement the context panel UI and click behavior**

In `/Users/lijun/mynote/src/components/LeftSidebar/TagPanel.tsx`, add:

```tsx
const activeTagContext = useAppStore((s) => s.activeTagContext);
const setActiveTagContext = useAppStore((s) => s.setActiveTagContext);
const setTagNavigationTarget = useEditorStore((s) => s.setTagNavigationTarget);

const activateTag = async (tag: Tag, event: React.MouseEvent) => {
  toggleTag(tag.id, event);
  try {
    const context = await api.getTagContext(tag.id);
    setActiveTagContext(context);
  } catch (error) {
    console.error("Failed to load tag context:", error);
    setActiveTagContext(null);
  }
};

const openTagContextItem = async (item: TagContextItem, tagName: string) => {
  const detail = await api.getNoteByPath(item.note_path);
  setCurrentNote(detail.note);
  setContent(detail.content);
  setTagNavigationTarget({ ...item, tag_name: tagName, revision: Date.now() });
};
```

Render the lower section after the tag list:

```tsx
{activeTagContext ? (
  <div style={{ borderTop: "1px solid #e6e9ef", marginTop: 8, padding: "10px 12px" }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: "#344054", marginBottom: 8 }}>
      {activeTagContext.tag_name} · {activeTagContext.total_notes} 篇
    </div>
    <div style={{ display: "grid", gap: 6 }}>
      {activeTagContext.items.map((item) => (
        <button
          key={`${item.note_id}:${item.line_start}`}
          type="button"
          aria-label={`打开标签命中文章 ${item.note_title}`}
          onClick={() => void openTagContextItem(item, activeTagContext.tag_name)}
        >
          <strong>{item.note_title}</strong>
          <span>{item.note_path}</span>
          <span>{item.heading_context ?? item.context_snippet}</span>
        </button>
      ))}
      {activeTagContext.has_more && <div>... 还有更多</div>}
    </div>
  </div>
) : (
  <div style={{ padding: "10px 12px", fontSize: 12, color: "#98a2b3" }}>
    选择标签以查看相关文章与命中位置
  </div>
)}
```

- [ ] **Step 4: Re-run the TagPanel tests and confirm they pass**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
corepack pnpm vitest run src/components/LeftSidebar/TagPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the sidebar UI slice**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
git add src/components/LeftSidebar/TagPanel.tsx src/components/LeftSidebar/TagPanel.test.tsx
git commit -m "feat(tags): add tag context sidebar panel"
```

## 7. Task 5: 编辑区与预览区标签导航

**Files:**
- Modify: `/Users/lijun/mynote/src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownEditor.tsx`
- Modify: `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownPreview.tsx`
- Modify: `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownEditor.test.tsx`
- Modify: `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownPreview.test.tsx`

- [ ] **Step 1: Write the failing editor and preview tests**

Add this to `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownEditor.test.tsx`:

```tsx
it("scrolls to the requested tag navigation target and decorates the target tag", async () => {
  const onChange = vi.fn();
  render(<MarkdownEditor initialContent={"# Title\n\nBody\n\n#项目报告"} onChange={onChange} tagNavigationTarget={{
    note_id: "note-1",
    note_path: "notes/target.md",
    note_title: "Target",
    note_updated_at: "2026-06-01T00:00:00Z",
    source: "inline",
    line_start: 4,
    line_end: 4,
    heading_context: null,
    context_snippet: "#项目报告",
    tag_name: "项目报告",
    revision: 1,
  }} />);

  expect(await screen.findByText("#项目报告")).toBeInTheDocument();
});
```

Add this to `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownPreview.test.tsx`:

```tsx
it("highlights the requested inline tag chip when a navigation target arrives", () => {
  const { container } = render(
    <MarkdownPreview
      content={"# Title\n\n#项目报告"}
      tagNavigationTarget={{
        note_id: "note-1",
        note_path: "notes/target.md",
        note_title: "Target",
        note_updated_at: "2026-06-01T00:00:00Z",
        source: "inline",
        line_start: 3,
        line_end: 3,
        heading_context: null,
        context_snippet: "#项目报告",
        tag_name: "项目报告",
        revision: 1,
      }}
    />,
  );

  expect(container.querySelector(".inline-tag-chip.is-navigation-target")).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
corepack pnpm vitest run src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected: FAIL because the components do not accept or consume `tagNavigationTarget` yet.

- [ ] **Step 3: Thread `tagNavigationTarget` through the workspace**

In `/Users/lijun/mynote/src/components/EditorWorkspace/EditorWorkspace.tsx`, read the target from the editor store and pass it down:

```tsx
const { currentNote, content, setContent, markDirty, showPreview, togglePreview, tagNavigationTarget } = useEditorStore();
```

Then pass it to both children:

```tsx
<MarkdownEditor
  initialContent={content}
  onChange={handleChange}
  sourceLineSyncSignal={sourceLineSyncSignal}
  onTopVisibleLineChange={(line) => handleSourceLineSync("editor", line)}
  tagNavigationTarget={tagNavigationTarget}
/>

<MarkdownPreview
  content={content}
  sourceLineSyncSignal={sourceLineSyncSignal}
  onTopVisibleLineChange={(line) => handleSourceLineSync("preview", line)}
  tagNavigationTarget={tagNavigationTarget}
/>
```

- [ ] **Step 4: Implement editor-side navigation consumption**

In `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownEditor.tsx`, extend props and add an effect:

```tsx
interface Props {
  initialContent: string;
  onChange: (content: string) => void;
  sourceLineSyncSignal?: SourceLineSyncSignal | null;
  onTopVisibleLineChange?: (line: number) => void;
  tagNavigationTarget?: TagNavigationTarget | null;
}

useEffect(() => {
  const view = viewRef.current;
  if (!view || !tagNavigationTarget) return;
  scrollEditorToSourceLine(view, tagNavigationTarget.line_start);
}, [tagNavigationTarget?.revision]);
```

Add a transient decoration class when the matched tag name equals `tagNavigationTarget?.tag_name` on the target line:

```tsx
const className = match.name === tagNavigationTarget?.tag_name ? "cm-inline-tag-token is-navigation-target" : "cm-inline-tag-token";
```

and style it in the theme:

```tsx
".cm-inline-tag-token.is-navigation-target": {
  backgroundColor: "rgba(26, 115, 232, 0.18)",
  boxShadow: "0 0 0 1px rgba(26, 115, 232, 0.35)",
},
```

- [ ] **Step 5: Implement preview-side navigation consumption**

In `/Users/lijun/mynote/src/components/EditorWorkspace/MarkdownPreview.tsx`, extend props:

```tsx
interface Props {
  content: string;
  sourceLineSyncSignal?: SourceLineSyncSignal | null;
  onTopVisibleLineChange?: (line: number) => void;
  tagNavigationTarget?: TagNavigationTarget | null;
}
```

Add an effect to scroll and mark the target chip:

```tsx
useEffect(() => {
  if (!tagNavigationTarget || !scrollContainerRef.current || !containerRef.current) return;
  scrollPreviewToSourceLine(scrollContainerRef.current, containerRef.current, tagNavigationTarget.line_start);
  containerRef.current
    .querySelectorAll(".inline-tag-chip.is-navigation-target")
    .forEach((node) => node.classList.remove("is-navigation-target"));
  const targetChip = Array.from(containerRef.current.querySelectorAll<HTMLElement>(".inline-tag-chip"))
    .find((node) => node.dataset.tagName === tagNavigationTarget.tag_name);
  targetChip?.classList.add("is-navigation-target");
}, [tagNavigationTarget?.revision]);
```

and add style:

```tsx
.markdown-preview-content .inline-tag-chip.is-navigation-target {
  background: #dbe8ff;
  box-shadow: 0 0 0 1px rgba(45, 91, 206, 0.32);
}
```

- [ ] **Step 6: Run the focused editor/preview tests and confirm they pass**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
corepack pnpm vitest run src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the navigation slice**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
git add src/components/EditorWorkspace/EditorWorkspace.tsx src/components/EditorWorkspace/MarkdownEditor.tsx src/components/EditorWorkspace/MarkdownPreview.tsx src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
git commit -m "feat(tags): navigate editor and preview to tag occurrences"
```

## 8. Task 6: 总验证

**Files:**
- Verify only.

- [ ] **Step 1: Run the full frontend suite**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
corepack pnpm test:run
```

Expected: PASS for all frontend tests, including new tag context and navigation coverage.

- [ ] **Step 2: Run the production build**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
corepack pnpm build
```

Expected: Build exits 0. Chunk size warnings are acceptable if they match current baseline.

- [ ] **Step 3: Run the browser smoke test**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm test:e2e
```

Expected: Playwright smoke test passes.

- [ ] **Step 4: Run the full Rust suite**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation/src-tauri
cargo test
```

Expected: PASS, including new migration, markdown extraction, and tag context tests.

- [ ] **Step 5: Inspect the final diff before review**

```bash
cd /Users/lijun/mynote/.worktrees/tag-context-navigation
git status --short
git --no-pager diff --stat
```

Expected: only the planned files changed; no unrelated churn.

## 9. 计划自检

- Spec coverage: the plan covers tag context panel UI, latest-5 sorting, overflow indicator, Rust occurrence indexing, `get_tag_context`, file-tree coexistence, and simultaneous editor/preview navigation.
- Placeholder scan: removed `TODO`-style steps; every task includes concrete files, tests, commands, and code snippets.
- Type consistency: `TagContextItem`, `TagContext`, and `TagNavigationTarget` use the same field names across Rust DTOs, TypeScript types, API contracts, store state, and component props.