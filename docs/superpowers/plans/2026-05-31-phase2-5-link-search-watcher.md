# Phase 2.5 Link Search Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Phase 2 link model, search entry, and watcher diagnostics into alignment with the approved Phase 2.5 design before Phase 3 feature work begins.

**Architecture:** Keep the existing Tauri 2 + Rust + React architecture and make focused changes around current modules. Rust remains the source of truth for Markdown parsing, link indexing, search, and watcher event recording; React only renders the richer API results and keeps existing keyboard/open-note flows.

**Tech Stack:** Rust, rusqlite, serde_json, notify, Tauri commands, React 19, TypeScript, Zustand, Vitest/React Testing Library, Playwright smoke verification.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-31 | v1.0 | 根据 Phase 2.5 design spec 创建实施计划。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 执行前准备](#2-执行前准备)
- [3. Task 1: 后端链接解析与解析优先级](#3-task-1-后端链接解析与解析优先级)
- [4. Task 2: NoteLinks unresolved 分组](#4-task-2-notelinks-unresolved-分组)
- [5. Task 3: MarkdownPreview Wiki 语法对齐](#5-task-3-markdownpreview-wiki-语法对齐)
- [6. Task 4: 搜索 limit 与最近笔记](#6-task-4-搜索-limit-与最近笔记)
- [7. Task 5: SearchOverlay 空搜索展示最近笔记](#7-task-5-searchoverlay-空搜索展示最近笔记)
- [8. Task 6: Watcher file_events 诊断](#8-task-6-watcher-file_events-诊断)
- [9. Task 7: 总验证与 baseline 更新](#9-task-7-总验证与-baseline-更新)
- [10. 计划自检](#10-计划自检)

## 1. 文件结构

### Rust 修改

- Modify: `src-tauri/src/infrastructure/markdown.rs` - 增加 `[[target#anchor|text]]` 回归测试，确认现有解析行为。
- Modify: `src-tauri/src/services/index.rs` - 保存 `front_matter_json`，扩展 link target 解析，增加路径/ID/alias 测试。
- Modify: `src-tauri/src/domain/link.rs` - `NoteLinks` 增加 `unresolved` 字段。
- Modify: `src-tauri/src/commands/link.rs` - 查询并返回 unresolved links。
- Modify: `src-tauri/src/domain/search.rs` - 如有需要，复用现有 `SearchResult`，最近笔记直接返回 `Note`。
- Modify: `src-tauri/src/commands/search.rs` - `search_notes` 增加 `limit`，新增 `list_recent_notes` command。
- Modify: `src-tauri/src/commands/mod.rs` - 保持 search module 暴露，无新增 module。
- Modify: `src-tauri/src/lib.rs` - 注册 `commands::search::list_recent_notes`。
- Modify: `src-tauri/src/services/watcher.rs` - 写入 `file_events`，抽出可测试的 event recording helper。

### 前端修改

- Modify: `src/types/index.ts` - `NoteLinks` 增加 `unresolved`。
- Modify: `src/api/commands.ts` - `searchNotes` 增加 `limit`，新增 `listRecentNotes`。
- Modify: `src/components/RightSidebar/BacklinksPanel.tsx` - 三段展示 outgoing/incoming/unresolved。
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx` - Wiki link parser/rendering 支持 display text 和 anchor data attributes。
- Modify: `src/components/SearchOverlay.tsx` - 空查询展示最近笔记，搜索查询展示 search results。

### 测试修改

- Modify: `src/components/EditorWorkspace/MarkdownPreview.test.tsx` - 增加 display/anchor 测试。
- Create or Modify: `src/components/RightSidebar/BacklinksPanel.test.tsx` - 覆盖三段展示和点击行为。
- Modify: `src/components/SearchOverlay.test.tsx` - 覆盖空搜索最近笔记。
- Modify: Rust tests in touched backend files.

## 2. 执行前准备

Implementation should happen in an isolated worktree.

- [ ] **Step 1: Create implementation worktree**

Run from the main repository:

```bash
cd /Users/lijun/mynote
git status --short
git check-ignore -q .worktrees
git worktree add .worktrees/phase2-5-link-search-watcher -b feature/phase2-5-link-search-watcher
cd .worktrees/phase2-5-link-search-watcher
```

Expected: `git status --short` is empty before creating the worktree; `git check-ignore -q .worktrees` exits 0; worktree is created on `feature/phase2-5-link-search-watcher`.

- [ ] **Step 2: Verify clean baseline in worktree**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run
pnpm build
cd src-tauri
cargo test
```

Expected: Vitest 17 tests pass; frontend build exits 0 with only the existing chunk-size warning; Rust tests pass.

## 3. Task 1: 后端链接解析与解析优先级

**Files:**
- Modify: `src-tauri/src/infrastructure/markdown.rs`
- Modify: `src-tauri/src/services/index.rs`

- [ ] **Step 1: Add failing tests for Wiki syntax, front_matter_json, ID/path/alias resolution**

In `src-tauri/src/infrastructure/markdown.rs`, add this test to the existing `#[cfg(test)] mod tests`:

```rust
#[test]
fn test_extract_links_wiki_anchor_with_display_text() {
    let body = "See [[目标笔记#第二节|阅读这里]].";
    let links = extract_links(body);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].target_raw, "目标笔记");
    assert_eq!(links[0].anchor, Some("第二节".to_string()));
    assert_eq!(links[0].display_text, Some("阅读这里".to_string()));
    assert_eq!(links[0].link_type, "wiki");
}
```

In `src-tauri/src/services/index.rs`, add tests inside the existing tests module:

```rust
#[test]
fn index_note_full_persists_front_matter_json() {
    let (root, conn) = setup_index_db();
    index_note_full(
        &conn,
        root.path(),
        "notes/target.md",
        "---\nid: stable-id\ntitle: Target\naliases: [Alias One]\nsummary: Summary\n---\n\nBody",
    )
    .unwrap();

    let json: String = conn
        .query_row(
            "SELECT front_matter_json FROM notes WHERE path = 'notes/target.md'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert!(json.contains("stable-id"));
    assert!(json.contains("Alias One"));
    assert!(json.contains("Summary"));
}

#[test]
fn links_resolve_by_id_path_and_alias() {
    let (root, conn) = setup_index_db();
    index_note_full(
        &conn,
        root.path(),
        "notes/folder/target.md",
        "---\nid: stable-id\ntitle: Target Title\naliases: [Alias One]\n---\n\n# Target",
    )
    .unwrap();

    index_note_full(
        &conn,
        root.path(),
        "notes/source.md",
        "# Source\n\n[[stable-id]]\n[By path](notes/folder/target.md)\n[[Alias One]]",
    )
    .unwrap();

    let resolved_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM links WHERE source_note_id = (SELECT id FROM notes WHERE path = 'notes/source.md') AND resolved = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(resolved_count, 3);
}

#[test]
fn markdown_links_resolve_relative_to_source_note_directory() {
    let (root, conn) = setup_index_db();
    index_note_full(&conn, root.path(), "notes/folder/target.md", "# Target").unwrap();
    index_note_full(
        &conn,
        root.path(),
        "notes/folder/source.md",
        "# Source\n\n[Target](target.md)",
    )
    .unwrap();

    assert_eq!(link_state(&conn, "Source", "notes/folder/target.md").1, 1);
}
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher/src-tauri
cargo test infrastructure::markdown::tests::test_extract_links_wiki_anchor_with_display_text services::index::tests::index_note_full_persists_front_matter_json services::index::tests::links_resolve_by_id_path_and_alias services::index::tests::markdown_links_resolve_relative_to_source_note_directory
```

Expected: at least the `front_matter_json`, ID/path/alias, and relative path tests fail before implementation.

- [ ] **Step 3: Implement front_matter_json persistence**

In `src-tauri/src/services/index.rs`, replace the note upsert SQL and params so `front_matter_json` is stored from parsed Front Matter:

```rust
let front_matter_json = serde_json::to_string(&parsed.front_matter)
    .map_err(|e| AppError::Parse(e.to_string()))?;

tx.execute(
    "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(path) DO UPDATE SET
       title=excluded.title,
       summary=excluded.summary,
       content_hash=excluded.content_hash,
       word_count=excluded.word_count,
       front_matter_json=excluded.front_matter_json,
       updated_at=excluded.updated_at,
       indexed_at=excluded.indexed_at,
       deleted_at=NULL",
    params![note_id, rel_path, title, summary, hash, word_count, front_matter_json, now, now, now],
)?;
```

- [ ] **Step 4: Implement target normalization and resolution**

In `src-tauri/src/services/index.rs`, change the loop that inserts links to resolve using source path and link type:

```rust
for raw in &raw_links {
    let link_id = Ulid::new().to_string();
    let normalized_target = normalize_link_target(rel_path, raw)?;
    let target_note_id = resolve_link_target(&tx, &normalized_target)?;
    let resolved: i64 = if target_note_id.is_some() { 1 } else { 0 };
    tx.execute(
        "INSERT INTO links (id, source_note_id, target_note_id, target_raw, display_text, link_type, anchor, resolved, start_offset, end_offset, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            link_id, actual_id, target_note_id, normalized_target, raw.display_text,
            raw.link_type, raw.anchor, resolved,
            raw.start_offset as i64, raw.end_offset as i64, now, now
        ],
    )?;
}
```

Add helper functions above `resolve_link_target`:

```rust
fn normalize_link_target(source_rel_path: &str, raw: &crate::infrastructure::markdown::RawLink) -> AppResult<String> {
    if raw.link_type == "external" {
        return Ok(raw.target_raw.clone());
    }

    if raw.link_type == "markdown" || raw.link_type == "asset" {
        let target = raw.target_raw.replace('\\', "/");
        let candidate = if target.starts_with("notes/") || target.starts_with("assets/") {
            target
        } else {
            let parent = Path::new(source_rel_path)
                .parent()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|| "notes".to_string());
            format!("{}/{}", parent, target)
        };
        return normalize_kb_relative_path(&candidate);
    }

    Ok(raw.target_raw.clone())
}

fn front_matter_aliases(json: &str) -> Vec<String> {
    serde_json::from_str::<crate::infrastructure::markdown::FrontMatter>(json)
        .ok()
        .and_then(|fm| fm.aliases)
        .unwrap_or_default()
}
```

Replace `resolve_link_target` with ID/path/title/alias priority:

```rust
fn resolve_link_target(
    tx: &rusqlite::Transaction,
    target_raw: &str,
) -> AppResult<Option<String>> {
    let by_id = tx
        .query_row(
            "SELECT id FROM notes WHERE id = ?1 AND deleted_at IS NULL LIMIT 1",
            params![target_raw],
            |row| row.get(0),
        )
        .optional()?;
    if by_id.is_some() {
        return Ok(by_id);
    }

    let by_path = tx
        .query_row(
            "SELECT id FROM notes WHERE path = ?1 AND deleted_at IS NULL LIMIT 1",
            params![target_raw],
            |row| row.get(0),
        )
        .optional()?;
    if by_path.is_some() {
        return Ok(by_path);
    }

    let by_title = tx
        .query_row(
            "SELECT id FROM notes WHERE title = ?1 AND deleted_at IS NULL LIMIT 1",
            params![target_raw],
            |row| row.get(0),
        )
        .optional()?;
    if by_title.is_some() {
        return Ok(by_title);
    }

    let alias_exact = resolve_alias(tx, target_raw, false)?;
    if alias_exact.is_some() {
        return Ok(alias_exact);
    }

    let by_title_ci = tx
        .query_row(
            "SELECT id FROM notes WHERE lower(title) = lower(?1) AND deleted_at IS NULL LIMIT 1",
            params![target_raw],
            |row| row.get(0),
        )
        .optional()?;
    if by_title_ci.is_some() {
        return Ok(by_title_ci);
    }

    resolve_alias(tx, target_raw, true)
}

fn resolve_alias(
    tx: &rusqlite::Transaction,
    target_raw: &str,
    case_insensitive: bool,
) -> AppResult<Option<String>> {
    let mut stmt = tx.prepare(
        "SELECT id, front_matter_json FROM notes WHERE deleted_at IS NULL ORDER BY path",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in rows {
        let (note_id, json) = row?;
        for alias in front_matter_aliases(&json) {
            let matches = if case_insensitive {
                alias.eq_ignore_ascii_case(target_raw)
            } else {
                alias == target_raw
            };
            if matches {
                return Ok(Some(note_id));
            }
        }
    }

    Ok(None)
}
```

- [ ] **Step 5: Update reconciliation to use normalized target values**

Keep `reconcile_links_for_note` and `reconcile_all_links` resolving stored `target_raw` directly. Because inserted links now store normalized target paths for Markdown links and raw note targets for Wiki links, existing reconcile loops can call the new `resolve_link_target(tx, &target_raw)` without source path.

- [ ] **Step 6: Run backend tests**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher/src-tauri
cargo test infrastructure::markdown services::index
```

Expected: markdown and index service tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
git add src-tauri/src/infrastructure/markdown.rs src-tauri/src/services/index.rs
git commit -m "feat(links): expand link target resolution"
```

## 4. Task 2: NoteLinks unresolved 分组

**Files:**
- Modify: `src-tauri/src/domain/link.rs`
- Modify: `src-tauri/src/commands/link.rs`
- Modify: `src/types/index.ts`
- Modify: `src/components/RightSidebar/BacklinksPanel.tsx`
- Create: `src/components/RightSidebar/BacklinksPanel.test.tsx`

- [ ] **Step 1: Add failing Rust test for unresolved grouping**

In `src-tauri/src/commands/link.rs`, add a `#[cfg(test)]` module with a testable helper if one does not exist. Extract the DB query into:

```rust
pub(crate) fn get_note_links_in_conn(conn: &rusqlite::Connection, note_id: &str) -> Result<NoteLinks, AppError> {
    // existing outgoing/incoming query logic moves here
}
```

Then add:

```rust
#[cfg(test)]
mod tests {
    use super::get_note_links_in_conn;
    use crate::infrastructure::db::open_and_migrate;
    use crate::services::index::index_note_full;
    use tempfile::TempDir;

    #[test]
    fn get_note_links_returns_unresolved_group() {
        let root = TempDir::new().unwrap();
        let conn = open_and_migrate(&root.path().join("test.sqlite")).unwrap();
        let source = index_note_full(
            &conn,
            root.path(),
            "notes/source.md",
            "# Source\n\n[[Missing Target]]",
        )
        .unwrap();

        let links = get_note_links_in_conn(&conn, &source.id).unwrap();

        assert_eq!(links.outgoing.len(), 1);
        assert_eq!(links.incoming.len(), 0);
        assert_eq!(links.unresolved.len(), 1);
        assert_eq!(links.unresolved[0].link_url, "Missing Target");
        assert!(!links.unresolved[0].resolved);
    }
}
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher/src-tauri
cargo test commands::link::tests::get_note_links_returns_unresolved_group
```

Expected: compile fails because `NoteLinks.unresolved` does not exist or helper is not implemented.

- [ ] **Step 3: Update Rust domain type**

In `src-tauri/src/domain/link.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteLinks {
    pub outgoing: Vec<LinkItem>,
    pub incoming: Vec<LinkItem>,
    pub unresolved: Vec<LinkItem>,
}
```

- [ ] **Step 4: Implement unresolved query**

In `src-tauri/src/commands/link.rs`, return unresolved links from current note only and exclude external links:

```rust
let mut unresolved_stmt = conn.prepare(
    "SELECT l.id, l.target_note_id, n.title, n.path, l.display_text, l.target_raw, l.link_type, l.resolved
     FROM links l
     LEFT JOIN notes n ON n.id = l.target_note_id AND n.deleted_at IS NULL
     WHERE l.source_note_id = ?1
       AND l.resolved = 0
       AND l.link_type != 'external'
     ORDER BY l.target_raw",
)?;
let unresolved = unresolved_stmt
    .query_map([note_id], |row| {
        Ok(LinkItem {
            id: row.get(0)?,
            note_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            note_title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            note_path: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            link_text: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            link_url: row.get(5)?,
            link_type: row.get(6)?,
            resolved: row.get::<_, i64>(7)? != 0,
        })
    })?
    .collect::<Result<Vec<_>, _>>()?;

Ok(NoteLinks { outgoing, incoming, unresolved })
```

- [ ] **Step 5: Update TypeScript type**

In `src/types/index.ts`:

```typescript
export interface NoteLinks {
  outgoing: LinkItem[];
  incoming: LinkItem[];
  unresolved: LinkItem[];
}
```

- [ ] **Step 6: Add BacklinksPanel test**

Create `src/components/RightSidebar/BacklinksPanel.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BacklinksPanel } from "./BacklinksPanel";
import { api } from "../../api/commands";

const openNote = vi.fn();

vi.mock("../../api/commands", () => ({
  api: {
    getNoteLinks: vi.fn(),
  },
}));

vi.mock("../../hooks/useOpenNote", () => ({
  useOpenNote: () => ({ openNote }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("BacklinksPanel", () => {
  beforeEach(() => {
    vi.mocked(api.getNoteLinks).mockResolvedValue({
      outgoing: [
        { id: "l1", note_id: "n2", note_title: "Target", note_path: "notes/target.md", link_text: "", link_url: "Target", link_type: "wiki", resolved: true },
      ],
      incoming: [
        { id: "l2", note_id: "n3", note_title: "Source", note_path: "notes/source.md", link_text: "", link_url: "Current", link_type: "wiki", resolved: true },
      ],
      unresolved: [
        { id: "l3", note_id: "", note_title: "", note_path: "", link_text: "Missing", link_url: "Missing", link_type: "wiki", resolved: false },
      ],
    });
    openNote.mockReset();
  });

  it("renders outgoing, incoming, and unresolved sections", async () => {
    render(<BacklinksPanel noteId="n1" />);

    expect(await screen.findByText("出链")).toBeInTheDocument();
    expect(screen.getByText("反链")).toBeInTheDocument();
    expect(screen.getByText("未解析链接")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });

  it("opens resolved local links", async () => {
    render(<BacklinksPanel noteId="n1" />);
    await userEvent.click(await screen.findByText("Target"));
    expect(openNote).toHaveBeenCalledWith("notes/target.md");
  });
});
```

- [ ] **Step 7: Update BacklinksPanel implementation**

Refactor `BacklinksPanel.tsx` to use a small section renderer:

```typescript
function LinkSection({
  title,
  links,
  empty,
  unresolved = false,
  onClick,
}: {
  title: string;
  links: NoteLinks["outgoing"];
  empty: string;
  unresolved?: boolean;
  onClick: (link: NoteLinks["outgoing"][number]) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={headingStyle}>{title}</div>
      {links.length > 0 ? links.map((link) => (
        <span
          key={link.id}
          style={unresolved ? unresolvedItemStyle : itemStyle}
          onClick={() => onClick(link)}
          title={link.link_url}
        >
          {link.note_title || link.link_text || link.link_url}
        </span>
      )) : <div style={emptyStyle}>{empty}</div>}
    </div>
  );
}
```

Render sections with titles exactly `出链`, `反链`, and `未解析链接` so tests and UI copy match.

- [ ] **Step 8: Run tests**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/RightSidebar/BacklinksPanel.test.tsx
cd src-tauri
cargo test commands::link
```

Expected: BacklinksPanel test passes; link command tests pass.

- [ ] **Step 9: Commit**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
git add src-tauri/src/domain/link.rs src-tauri/src/commands/link.rs src/types/index.ts src/components/RightSidebar/BacklinksPanel.tsx src/components/RightSidebar/BacklinksPanel.test.tsx
git commit -m "feat(links): expose unresolved links"
```

## 5. Task 3: MarkdownPreview Wiki 语法对齐

**Files:**
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.test.tsx`

- [ ] **Step 1: Add failing preview tests**

Add tests to `MarkdownPreview.test.tsx`:

```typescript
it("renders wiki display text and anchor metadata", () => {
  const { container } = render(<MarkdownPreview content="See [[Target#Section|Read here]]" />);
  const link = container.querySelector(".wiki-link") as HTMLElement;
  expect(link).toHaveTextContent("Read here");
  expect(link.dataset.title).toBe("Target");
  expect(link.dataset.anchor).toBe("Section");
  expect(link.dataset.raw).toBe("Target#Section|Read here");
});

it("renders unresolved-looking wiki text without unsafe html", () => {
  const { container } = render(<MarkdownPreview content="See [[<img src=x onerror=alert(1)>|Bad]]" />);
  expect(container.querySelector("img")).not.toBeInTheDocument();
  const link = container.querySelector(".wiki-link") as HTMLElement;
  expect(link).toHaveTextContent("Bad");
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected: new display/anchor metadata assertions fail before implementation.

- [ ] **Step 3: Replace processWikiLinks parser**

In `MarkdownPreview.tsx`, replace `processWikiLinks` with parser helpers:

```typescript
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseWikiTarget(raw: string) {
  const pipeIndex = raw.indexOf("|");
  const targetPart = pipeIndex === -1 ? raw : raw.slice(0, pipeIndex);
  const displayText = pipeIndex === -1 ? null : raw.slice(pipeIndex + 1);
  const hashIndex = targetPart.indexOf("#");
  const title = hashIndex === -1 ? targetPart : targetPart.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? "" : targetPart.slice(hashIndex + 1);
  return {
    raw,
    title: title.trim(),
    anchor: anchor.trim(),
    displayText: (displayText ?? title).trim(),
  };
}

function processWikiLinks(html: string): string {
  return html.replace(/\[\[([^\]]+)\]\]/g, (_, raw: string) => {
    const parsed = parseWikiTarget(raw);
    const text = escapeAttr(parsed.displayText || parsed.title || raw);
    return `<span class="wiki-link wiki-link-unresolved" data-title="${escapeAttr(parsed.title)}" data-anchor="${escapeAttr(parsed.anchor)}" data-raw="${escapeAttr(parsed.raw)}">${text}</span>`;
  });
}
```

Keep DOMPurify after `processWikiLinks` so injected attributes/text remain sanitized.

- [ ] **Step 4: Update click handling to use title dataset**

Keep existing click flow but read the parsed dataset:

```typescript
const title = wikiLink.dataset.title;
if (!title) return;
```

No one-click creation is added in this task.

- [ ] **Step 5: Add unresolved style**

In the `<style>` block, add:

```css
.wiki-link-unresolved {
  color: #b42318;
  text-decoration-style: dashed;
}
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected: MarkdownPreview tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
git add src/components/EditorWorkspace/MarkdownPreview.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
git commit -m "feat(preview): render wiki link display text"
```

## 6. Task 4: 搜索 limit 与最近笔记

**Files:**
- Modify: `src-tauri/src/commands/search.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api/commands.ts`

- [ ] **Step 1: Add failing Rust tests for limit and recent notes**

In `src-tauri/src/commands/search.rs`, add helper functions if needed:

```rust
fn normalize_search_limit(limit: Option<usize>, default_limit: usize, max_limit: usize) -> usize {
    match limit {
        Some(value) if value > 0 => value.min(max_limit),
        _ => default_limit,
    }
}
```

Add tests:

```rust
#[test]
fn search_notes_honors_limit_cap() {
    let conn = setup_search_db();
    for idx in 0..60 {
        let id = format!("n{idx}");
        let title = format!("Plan {idx}");
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![id, format!("notes/{idx}.md"), title],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
            rusqlite::params![format!("n{idx}"), format!("Plan {idx}"), "plan body"],
        ).unwrap();
    }

    let results = search_notes_in_conn(&conn, "Plan", Some(100)).unwrap();
    assert_eq!(results.len(), 50);
}

#[test]
fn list_recent_notes_orders_by_updated_at() {
    let conn = setup_search_db();
    conn.execute("ALTER TABLE notes ADD COLUMN content_hash TEXT DEFAULT ''", []).unwrap();
    conn.execute("ALTER TABLE notes ADD COLUMN word_count INTEGER DEFAULT 0", []).unwrap();
    conn.execute("ALTER TABLE notes ADD COLUMN created_at TEXT DEFAULT '2026-01-01T00:00:00Z'", []).unwrap();
    conn.execute("ALTER TABLE notes ADD COLUMN updated_at TEXT DEFAULT '2026-01-01T00:00:00Z'", []).unwrap();
    conn.execute("ALTER TABLE notes ADD COLUMN indexed_at TEXT DEFAULT '2026-01-01T00:00:00Z'", []).unwrap();
    conn.execute("UPDATE notes SET updated_at = '2026-01-01T00:00:00Z'", []).unwrap();
    conn.execute(
        "INSERT INTO notes (id, path, title, summary, deleted_at, updated_at) VALUES ('old', 'notes/old.md', 'Old', NULL, NULL, '2026-01-01T00:00:00Z')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO notes (id, path, title, summary, deleted_at, updated_at) VALUES ('new', 'notes/new.md', 'New', NULL, NULL, '2026-02-01T00:00:00Z')",
        [],
    ).unwrap();

    let notes = list_recent_notes_in_conn(&conn, Some(10)).unwrap();
    assert_eq!(notes[0].id, "new");
    assert_eq!(notes[1].id, "old");
}
```

If `setup_search_db` does not include all `Note` columns, adjust it once so recent-note tests can construct full `Note` values.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher/src-tauri
cargo test commands::search
```

Expected: compile fails until signatures and recent helper are implemented.

- [ ] **Step 3: Update search_notes signature and helper**

In `src-tauri/src/commands/search.rs`:

```rust
#[tauri::command]
pub async fn search_notes(
    state: State<'_, AppState>,
    query: String,
    kb_id: String,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, AppError> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let _ = kb_id;

    search_notes_in_conn(conn, &query, limit)
}
```

Update `search_notes_in_conn` to accept `limit: Option<usize>` and bind limit as SQL param:

```rust
fn search_notes_in_conn(
    conn: &Connection,
    query: &str,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, AppError> {
    let normalized_limit = normalize_search_limit(limit, 20, 50) as i64;
    // ...
    // SQL ends with LIMIT ?3
    // query_map params: rusqlite::params![fts_query, like_query, normalized_limit]
}
```

- [ ] **Step 4: Add list_recent_notes command**

In `src-tauri/src/commands/search.rs`:

```rust
#[tauri::command]
pub async fn list_recent_notes(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<crate::domain::note::Note>, AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    list_recent_notes_in_conn(conn, limit)
}

fn list_recent_notes_in_conn(
    conn: &Connection,
    limit: Option<usize>,
) -> Result<Vec<crate::domain::note::Note>, AppError> {
    let normalized_limit = normalize_search_limit(limit, 10, 20) as i64;
    let mut stmt = conn.prepare(
        "SELECT id, path, title, summary, content_hash, word_count, created_at, updated_at, indexed_at, deleted_at
         FROM notes
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC, path ASC
         LIMIT ?1",
    )?;

    let notes = stmt
        .query_map([normalized_limit], |row| {
            Ok(crate::domain::note::Note {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                summary: row.get(3)?,
                content_hash: row.get(4)?,
                word_count: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                indexed_at: row.get(8)?,
                deleted_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(notes)
}
```

- [ ] **Step 5: Register Tauri command**

In `src-tauri/src/lib.rs`, add to `generate_handler!`:

```rust
commands::search::list_recent_notes,
```

- [ ] **Step 6: Update frontend API**

In `src/api/commands.ts`:

```typescript
searchNotes: (query: string, kbId: string, limit?: number) =>
  invoke<SearchResult[]>("search_notes", { query, kbId, limit }),

listRecentNotes: (limit?: number) =>
  invoke<Note[]>("list_recent_notes", { limit }),
```

- [ ] **Step 7: Run tests**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher/src-tauri
cargo test commands::search
cd ..
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm build
```

Expected: search command tests pass; TypeScript build passes.

- [ ] **Step 8: Commit**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
git add src-tauri/src/commands/search.rs src-tauri/src/lib.rs src/api/commands.ts
git commit -m "feat(search): add limits and recent notes"
```

## 7. Task 5: SearchOverlay 空搜索展示最近笔记

**Files:**
- Modify: `src/components/SearchOverlay.tsx`
- Modify: `src/components/SearchOverlay.test.tsx`

- [ ] **Step 1: Add failing frontend test**

In `src/components/SearchOverlay.test.tsx`, extend mocks for `api.listRecentNotes` if the file currently only mocks `useSearch`. Prefer mocking `api` directly for the new recent-note behavior:

```typescript
vi.mock("../api/commands", () => ({
  api: {
    listRecentNotes: vi.fn(),
  },
}));
```

Add test:

```typescript
it("shows recent notes when query is empty", async () => {
  vi.mocked(api.listRecentNotes).mockResolvedValue([
    makeNote({ id: "recent", title: "Recent Note", path: "notes/recent.md", updated_at: "2026-05-31T09:00:00Z" }),
  ]);

  renderSearchOverlay();

  expect(await screen.findByText("Recent Note")).toBeInTheDocument();
  expect(screen.getByText("notes/recent.md")).toBeInTheDocument();
});
```

Import `api` and `makeNote` from existing helpers as needed:

```typescript
import { api } from "../api/commands";
import { makeNote } from "../test/testData";
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/SearchOverlay.test.tsx
```

Expected: new test fails because recent notes are not loaded or rendered.

- [ ] **Step 3: Implement recent-note loading**

In `SearchOverlay.tsx`, add state and effect:

```typescript
const [recentNotes, setRecentNotes] = useState<Note[]>([]);
const [recentLoading, setRecentLoading] = useState(false);

useEffect(() => {
  if (query.trim()) return;
  let isMounted = true;
  setRecentLoading(true);
  api.listRecentNotes(10)
    .then((notes) => { if (isMounted) setRecentNotes(notes); })
    .catch(() => { if (isMounted) setRecentNotes([]); })
    .finally(() => { if (isMounted) setRecentLoading(false); });
  return () => { isMounted = false; };
}, [query]);
```

Import `api` and `Note`:

```typescript
import { api } from "../api/commands";
import type { Note, SearchResult } from "../types";
```

Render recent notes when query is blank:

```typescript
{!query.trim() && recentLoading && (
  <div style={styles.empty}>加载最近笔记...</div>
)}
{!query.trim() && !recentLoading && recentNotes.length === 0 && (
  <div style={styles.empty}>暂无最近笔记</div>
)}
{!query.trim() && !recentLoading && recentNotes.map((note, i) => (
  <div
    key={note.id}
    style={{
      ...styles.resultItem,
      ...(i === selectedIndex ? styles.resultItemSelected : {}),
    }}
    onClick={() => openResult({ note_id: note.id, title: note.title, path: note.path, snippet: note.updated_at })}
    onMouseEnter={() => setSelectedIndex(i)}
  >
    <div style={styles.resultTitle}>{note.title}</div>
    <div style={styles.resultSnippet}>{note.updated_at}</div>
    <div style={styles.resultPath}>{note.path}</div>
  </div>
))}
```

Adjust keyboard Enter to open from recent notes when query is blank:

```typescript
const activeItems = query.trim() ? results : recentNotes;
// Enter opens activeItems[selectedIndex] with path mapping.
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/SearchOverlay.test.tsx
```

Expected: SearchOverlay tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
git add src/components/SearchOverlay.tsx src/components/SearchOverlay.test.tsx
git commit -m "feat(search): show recent notes in overlay"
```

## 8. Task 6: Watcher file_events 诊断

**Files:**
- Modify: `src-tauri/src/services/watcher.rs`

- [ ] **Step 1: Add failing tests around event recording helper**

In `src-tauri/src/services/watcher.rs`, add a test module and plan to expose a helper:

```rust
#[cfg(test)]
mod tests {
    use super::record_file_event;
    use crate::infrastructure::db::open_and_migrate;
    use tempfile::TempDir;

    #[test]
    fn record_file_event_writes_processed_event() {
        let dir = TempDir::new().unwrap();
        let conn = open_and_migrate(&dir.path().join("test.sqlite")).unwrap();

        record_file_event(
            &conn,
            "modify",
            "notes/a.md",
            None,
            Some("hash"),
            true,
            None,
        )
        .unwrap();

        let row: (String, String, i64, Option<String>) = conn
            .query_row(
                "SELECT event_type, path, processed, error FROM file_events",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        assert_eq!(row.0, "modify");
        assert_eq!(row.1, "notes/a.md");
        assert_eq!(row.2, 1);
        assert_eq!(row.3, None);
    }

    #[test]
    fn record_file_event_writes_failed_event() {
        let dir = TempDir::new().unwrap();
        let conn = open_and_migrate(&dir.path().join("test.sqlite")).unwrap();

        record_file_event(
            &conn,
            "delete",
            "notes/missing.md",
            None,
            None,
            false,
            Some("boom"),
        )
        .unwrap();

        let row: (i64, String) = conn
            .query_row(
                "SELECT processed, error FROM file_events",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(row.0, 0);
        assert_eq!(row.1, "boom");
    }
}
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher/src-tauri
cargo test services::watcher
```

Expected: compile fails because `record_file_event` does not exist.

- [ ] **Step 3: Implement record_file_event helper**

In `src-tauri/src/services/watcher.rs`, add imports:

```rust
use crate::infrastructure::hash::sha256_str;
use rusqlite::params;
use ulid::Ulid;
```

Add helper:

```rust
pub(crate) fn record_file_event(
    conn: &rusqlite::Connection,
    event_type: &str,
    path: &str,
    old_path: Option<&str>,
    content_hash: Option<&str>,
    processed: bool,
    error: Option<&str>,
) -> Result<(), rusqlite::Error> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO file_events (id, event_type, path, old_path, content_hash, processed, error, created_at, processed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            Ulid::new().to_string(),
            event_type,
            path,
            old_path,
            content_hash,
            if processed { 1 } else { 0 },
            error,
            now,
            now,
        ],
    )?;
    Ok(())
}
```

- [ ] **Step 4: Record events in watcher processing loop**

In the `for abs_path in to_process` block, compute event type and hash:

```rust
let event_type = if abs_path.exists() { "modify" } else { "delete" };
let content_hash = if abs_path.exists() {
    std::fs::read_to_string(&abs_path).ok().map(|content| sha256_str(&content))
} else {
    None
};
```

After indexing or deleting:

```rust
match result {
    Ok(_) => {
        if let Err(e) = record_file_event(
            conn,
            event_type,
            &rel_str,
            None,
            content_hash.as_deref(),
            true,
            None,
        ) {
            eprintln!("[watcher] failed to record event {}: {:?}", rel_str, e);
        }
        let _ = app_clone.emit("note:index_updated", &rel_str);
    }
    Err(e) => {
        let error = e.to_string();
        if let Err(record_error) = record_file_event(
            conn,
            event_type,
            &rel_str,
            None,
            content_hash.as_deref(),
            false,
            Some(&error),
        ) {
            eprintln!("[watcher] failed to record failed event {}: {:?}", rel_str, record_error);
        }
        eprintln!("[watcher] sync error {}: {:?}", rel_str, e);
    }
}
```

This task records modify/delete. Reliable create-vs-modify distinction from notify event kind can be refined later; this baseline creates useful diagnostics without changing watcher behavior.

- [ ] **Step 5: Run tests**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher/src-tauri
cargo test services::watcher
```

Expected: watcher tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
git add src-tauri/src/services/watcher.rs
git commit -m "feat(watcher): record file events"
```

## 9. Task 7: 总验证与 baseline 更新

**Files:**
- Modify: `docs/superpowers/baseline-2026-05-30.md`

- [ ] **Step 1: Run full verification**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run
pnpm build
pnpm test:e2e
rm -rf test-results playwright-report
cd src-tauri
cargo test
cd ..
git status --short
```

Expected: Vitest passes; build exits 0 with only existing chunk-size warning; Playwright smoke passes using installed Chrome channel; Rust tests pass; git status only shows intended baseline doc change after the next step.

- [ ] **Step 2: Update baseline doc revision history**

In `docs/superpowers/baseline-2026-05-30.md`, add a new revision row:

```markdown
| 2026-05-31 | v1.5 | 标记 Phase 2.5 链接模型、搜索入口和 watcher file_events 诊断对齐完成。 |
```

Update sections:

- Section 3 validation command results with new test counts.
- Section 4 current feature range to mention ID/path/alias link resolution, unresolved link panel, search recent notes, watcher file_events.
- Section 6 risk queue to add or mark Phase 2.5 design gaps as completed.
- Section 8 next suggestion to Phase 3A summary/revision/relations planning.

- [ ] **Step 3: Commit baseline update**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
git add docs/superpowers/baseline-2026-05-30.md
git commit -m "docs: update baseline after phase 2.5"
```

- [ ] **Step 4: Final diff check**

```bash
cd /Users/lijun/mynote/.worktrees/phase2-5-link-search-watcher
git diff --check main...HEAD
git status --short
git log --oneline --decorate main..HEAD
```

Expected: diff check exits 0; worktree clean; log shows one commit per task.

## 10. 计划自检

### Spec coverage

| Spec requirement | Covered by |
| --- | --- |
| ID/path/title/alias link resolution | Task 1 |
| Wiki display text and anchor syntax | Task 1, Task 3 |
| outgoing/backlinks/unresolved API and UI | Task 2 |
| search limit and cap | Task 4 |
| empty search recent notes | Task 4, Task 5 |
| watcher file_events diagnostics | Task 6 |
| baseline verification and docs | Task 7 |

### Placeholder scan

This plan intentionally contains no TBD/TODO placeholders. Each task includes exact files, failing-test intent, implementation snippets, verification commands, and commit boundaries.

### Type consistency

- Rust `NoteLinks` uses `outgoing`, `incoming`, and `unresolved`.
- TypeScript `NoteLinks` mirrors the Rust fields.
- Frontend keeps existing `LinkItem` field names: `id`, `note_id`, `note_title`, `note_path`, `link_text`, `link_url`, `link_type`, `resolved`.
- `searchNotes(query, kbId, limit?)` matches the Tauri command payload.
- `listRecentNotes(limit?)` returns `Note[]` and reuses existing `Note` type.
