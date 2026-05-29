# MyNote Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1 的可用内核上增加标签系统、Wiki 双链与反链、FTS5 全文搜索、文件监听，以及可折叠/可调宽的左右侧边栏。

**Architecture:** Tauri 2 + Rust 后端 + React 前端，延续 Phase 1 架构。后端新增 index service（全量更新 tags/links/FTS）和 watcher service（notify crate 监听文件变化）。前端新增 TagPanel、BacklinksPanel、SearchOverlay 以及 useSidebarResize hook。所有新 Tauri command 注册到 lib.rs 的 `invoke_handler`。

**Tech Stack:** 现有栈 + `notify = "6"` (Rust 文件监听)；前端无新依赖。

---

## 文件变更清单

### 新建（Rust）
- `src-tauri/src/domain/tag.rs` — Tag, TagSummary 结构体
- `src-tauri/src/domain/link.rs` — RawLink, Link, LinkItem, NoteLinks 结构体
- `src-tauri/src/domain/search.rs` — SearchResult 结构体
- `src-tauri/src/services/index.rs` — `index_note_full()` 全量索引（tags + links + FTS，单事务）
- `src-tauri/src/services/watcher.rs` — WatcherService（notify + 防抖 + 增量索引）
- `src-tauri/src/commands/search.rs` — `search_notes` Tauri command
- `src-tauri/src/commands/link.rs` — `get_note_links` Tauri command
- `src-tauri/src/commands/tag.rs` — `list_tags`、`list_notes_by_tag` Tauri commands

### 新建（前端）
- `src/hooks/useSidebarResize.ts` — 拖拽调宽 + 折叠状态 + localStorage 持久化
- `src/components/LeftSidebar/TagPanel.tsx` — 标签列表，支持多选过滤
- `src/components/RightSidebar/BacklinksPanel.tsx` — 出链/反链/未解析链接三区域
- `src/hooks/useSearch.ts` — 搜索状态管理（query, results, isOpen, loading）
- `src/components/SearchOverlay.tsx` — 搜索弹层（键盘导航 + 高亮片段）

### 修改（Rust）
- `src-tauri/Cargo.toml` — 添加 `notify = "6"`
- `src-tauri/src/infrastructure/db.rs` — 添加 migration 5-8（tags、note_tags、links、file_events）
- `src-tauri/src/infrastructure/markdown.rs` — 添加 `extract_inline_tags()`、`extract_links()`
- `src-tauri/src/domain/mod.rs` — 暴露 tag、link、search 模块
- `src-tauri/src/services/mod.rs` — 暴露 index、watcher 模块
- `src-tauri/src/commands/mod.rs` — 暴露 search、link、tag 模块
- `src-tauri/src/services/note.rs` — `create_note_service`、`save_note_service`、`import_note_service`、`index_note_from_file` 调用 `index_note_full`
- `src-tauri/src/state.rs` — 添加 `watcher: Mutex<Option<WatcherHandle>>`
- `src-tauri/src/lib.rs` — 注册新 command，打开知识库时启动 watcher

### 修改（前端）
- `src/types/index.ts` — 添加 Tag、LinkItem、NoteLinks、SearchResult
- `src/api/commands.ts` — 添加 listTags、listNotesByTag、getNoteLinks、searchNotes
- `src/store/useAppStore.ts` — 添加 selectedTagIds、setSelectedTagIds
- `src/components/AppShell.tsx` — 改为动态宽度侧边栏，集成 useSidebarResize
- `src/styles/layout.css` — 添加 resize handle 和折叠按钮样式
- `src/components/LeftSidebar/LeftSidebar.tsx` — 添加文件/标签 Tab 切换
- `src/components/LeftSidebar/FileTreePanel.tsx` — 支持按 selectedTagIds 过滤
- `src/components/RightSidebar/RightSidebar.tsx` — 添加大纲/反链 Tab 切换，集成 BacklinksPanel
- `src/components/EditorWorkspace/MarkdownPreview.tsx` — Wiki 链接渲染 + 点击导航
- `src/components/AppHeader.tsx` — 搜索框 + ⌘K 快捷键，集成 SearchOverlay

---

## Task 1: DB Migration — tags / note_tags / links / file_events

> 注意：`note_fts` 表已在 Phase 1 的 migration 4 中创建，本任务只加 4 张新表。

**Files:**
- Modify: `src-tauri/src/infrastructure/db.rs`

- [ ] **Step 1: 在 `MIGRATIONS` 数组中追加 migration 5-8**

打开 `src-tauri/src/infrastructure/db.rs`，找到 `MIGRATIONS` 数组末尾的 `)` 闭括号，在其前面追加：

```rust
    (
        5,
        "create_tags",
        "CREATE TABLE IF NOT EXISTS tags (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL UNIQUE,
            normalized_name TEXT NOT NULL UNIQUE,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );",
    ),
    (
        6,
        "create_note_tags",
        "CREATE TABLE IF NOT EXISTS note_tags (
            note_id TEXT NOT NULL,
            tag_id  TEXT NOT NULL,
            source  TEXT NOT NULL,
            PRIMARY KEY (note_id, tag_id, source),
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id);
        CREATE INDEX IF NOT EXISTS idx_note_tags_tag  ON note_tags(tag_id);",
    ),
    (
        7,
        "create_links",
        "CREATE TABLE IF NOT EXISTS links (
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
    ),
    (
        8,
        "create_file_events",
        "CREATE TABLE IF NOT EXISTS file_events (
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
    ),
```

- [ ] **Step 2: 更新现有测试中 migration 数量断言**

找到 `test_open_and_migrate_creates_tables` 中的 `assert_eq!(count, 4)` 改为 `assert_eq!(count, 8)`。

- [ ] **Step 3: 运行 Rust 测试确认通过**

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::db -- --nocapture
```

Expected: 2 tests pass。

- [ ] **Step 4: Commit**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/infrastructure/db.rs
git commit -m "feat(db): add migrations 5-8 for tags, note_tags, links, file_events"
```

---

## Task 2: 可折叠/可调宽侧边栏

**Files:**
- Create: `src/hooks/useSidebarResize.ts`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/styles/layout.css`

- [ ] **Step 1: 创建 `src/hooks/useSidebarResize.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  side: "left" | "right";
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  defaultVisible: boolean;
}

export function useSidebarResize({
  side,
  defaultWidth,
  minWidth,
  maxWidth,
  defaultVisible,
}: Options) {
  const storageKeyWidth = `mynote:${side}-sidebar:width`;
  const storageKeyVisible = `mynote:${side}-sidebar:visible`;

  const [width, setWidth] = useState<number>(() => {
    const saved = localStorage.getItem(storageKeyWidth);
    return saved ? parseInt(saved, 10) : defaultWidth;
  });
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKeyVisible);
    return saved !== null ? saved === "true" : defaultVisible;
  });

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
  }, [width]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = side === "left"
        ? e.clientX - startX.current
        : startX.current - e.clientX;
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
      setWidth(next);
    };
    const onUp = () => { isDragging.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [side, minWidth, maxWidth]);

  useEffect(() => {
    localStorage.setItem(storageKeyWidth, String(width));
  }, [width, storageKeyWidth]);

  useEffect(() => {
    localStorage.setItem(storageKeyVisible, String(isVisible));
  }, [isVisible, storageKeyVisible]);

  const toggleVisible = useCallback(() => setIsVisible((v) => !v), []);

  return { width, isVisible, toggleVisible, handleMouseDown };
}
```

- [ ] **Step 2: 重写 `src/components/AppShell.tsx`**

```typescript
import { AppHeader } from "./AppHeader";
import { StatusBar } from "./StatusBar";
import { LeftSidebar } from "./LeftSidebar/LeftSidebar";
import { EditorWorkspace } from "./EditorWorkspace/EditorWorkspace";
import { RightSidebar } from "./RightSidebar/RightSidebar";
import { useSidebarResize } from "../hooks/useSidebarResize";
import "../styles/layout.css";

export function AppShell() {
  const left = useSidebarResize({
    side: "left",
    defaultWidth: 240,
    minWidth: 120,
    maxWidth: 480,
    defaultVisible: true,
  });
  const right = useSidebarResize({
    side: "right",
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 400,
    defaultVisible: false,
  });

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-body">
        {/* Left sidebar */}
        <div className="sidebar-container" style={{ width: left.isVisible ? left.width : 0 }}>
          {left.isVisible && (
            <aside className="left-sidebar" style={{ width: left.width }}>
              <LeftSidebar />
            </aside>
          )}
        </div>
        <div
          className={`resize-handle resize-handle-left${left.isVisible ? "" : " hidden"}`}
          onMouseDown={left.handleMouseDown}
        >
          <button
            className="sidebar-toggle sidebar-toggle-left"
            onClick={left.toggleVisible}
            title={left.isVisible ? "收起左侧栏" : "展开左侧栏"}
          >
            {left.isVisible ? "‹" : "›"}
          </button>
        </div>

        {/* Editor */}
        <main className="editor-workspace">
          <EditorWorkspace />
        </main>

        {/* Right sidebar */}
        <div
          className={`resize-handle resize-handle-right${right.isVisible ? "" : " hidden"}`}
          onMouseDown={right.handleMouseDown}
        >
          <button
            className="sidebar-toggle sidebar-toggle-right"
            onClick={right.toggleVisible}
            title={right.isVisible ? "收起右侧栏" : "展开右侧栏"}
          >
            {right.isVisible ? "›" : "‹"}
          </button>
        </div>
        <div className="sidebar-container" style={{ width: right.isVisible ? right.width : 0 }}>
          {right.isVisible && (
            <aside className="right-sidebar" style={{ width: right.width }}>
              <RightSidebar />
            </aside>
          )}
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 3: 更新 `src/styles/layout.css`**

将文件内容替换为：

```css
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.app-header {
  height: var(--header-height);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 12px;
  flex-shrink: 0;
}

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

.sidebar-container {
  flex-shrink: 0;
  overflow: hidden;
  transition: width 0.0s; /* no animation, instant */
}

.left-sidebar,
.right-sidebar {
  height: 100%;
  background: var(--bg-sidebar);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.left-sidebar {
  border-right: 1px solid var(--border);
}

.right-sidebar {
  border-left: 1px solid var(--border);
}

.editor-workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-width: 0;
}

/* Resize handle strip */
.resize-handle {
  flex-shrink: 0;
  width: 8px;
  position: relative;
  cursor: col-resize;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.resize-handle:hover {
  background: rgba(0, 0, 0, 0.06);
}

.resize-handle.hidden {
  cursor: default;
  pointer-events: none; /* disable drag when sidebar hidden */
}

/* Toggle button inside the handle */
.sidebar-toggle {
  position: absolute;
  width: 20px;
  height: 36px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--text-secondary);
  pointer-events: all;
  z-index: 11;
}

.sidebar-toggle:hover {
  background: var(--bg-hover, #e8eaed);
}

/* Re-enable pointer events on the toggle even when handle is "hidden" */
.resize-handle.hidden .sidebar-toggle {
  pointer-events: all;
  cursor: pointer;
}

.status-bar {
  height: var(--statusbar-height);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
```

- [ ] **Step 4: TypeScript 检查**

```bash
cd /Users/lijun/mynote && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSidebarResize.ts src/components/AppShell.tsx src/styles/layout.css
git commit -m "feat(ui): resizable and collapsible sidebars with localStorage persistence"
```

---

## Task 3: Rust — 标签与链接提取（markdown.rs）

**Files:**
- Modify: `src-tauri/src/infrastructure/markdown.rs`

- [ ] **Step 1: 在 `markdown.rs` 中添加 `extract_inline_tags` 函数**

在文件末尾的 `#[cfg(test)]` 块之前追加：

```rust
/// 从正文提取内联标签（#标签），跳过代码块和 URL 片段
pub fn extract_inline_tags(body: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut in_code_block = false;
    let mut in_inline_code = false;

    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }

        // Scan character by character
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            // Toggle inline code
            if chars[i] == '`' {
                in_inline_code = !in_inline_code;
                i += 1;
                continue;
            }
            if in_inline_code {
                i += 1;
                continue;
            }
            // Check for URL scheme before #
            if chars[i] == '#' {
                // Not a tag if preceded by '/' or part of URL (look back for "://")
                let prefix: String = chars[..i].iter().collect();
                if prefix.ends_with("://") || prefix.ends_with('/') {
                    i += 1;
                    continue;
                }
                // Must be at start of line or preceded by whitespace
                let preceded_by_space = i == 0 || chars[i - 1].is_whitespace();
                if !preceded_by_space {
                    i += 1;
                    continue;
                }
                // Collect tag name
                let start = i + 1;
                let mut end = start;
                while end < chars.len() {
                    let c = chars[end];
                    if c.is_alphanumeric() || c == '-' || c == '_' || "\u{4e00}" <= c && c <= "\u{9fff}" {
                        end += 1;
                    } else {
                        break;
                    }
                }
                if end > start {
                    let tag: String = chars[start..end].iter().collect();
                    tags.push(tag);
                    i = end;
                    continue;
                }
            }
            i += 1;
        }
    }
    tags.sort();
    tags.dedup();
    tags
}

#[derive(Debug, Clone)]
pub struct RawLink {
    pub target_raw: String,
    pub display_text: Option<String>,
    pub link_type: String, // "wiki" | "markdown" | "asset"
    pub anchor: Option<String>,
    pub start_offset: usize,
    pub end_offset: usize,
}

/// 从正文提取所有链接（wiki 链接和 markdown 链接）
pub fn extract_links(body: &str) -> Vec<RawLink> {
    let mut links = Vec::new();
    let mut in_code_block = false;

    let mut offset = 0usize;
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            offset += line.len() + 1;
            continue;
        }
        if in_code_block {
            offset += line.len() + 1;
            continue;
        }

        // Extract wiki links: [[target]], [[target|text]], [[target#anchor]]
        let mut search_from = 0;
        while let Some(start) = line[search_from..].find("[[") {
            let abs_start = offset + search_from + start;
            let rest = &line[search_from + start + 2..];
            if let Some(end) = rest.find("]]") {
                let inner = &rest[..end];
                let abs_end = abs_start + 2 + end + 2;
                let (target_part, display) = if let Some(pipe) = inner.find('|') {
                    (&inner[..pipe], Some(inner[pipe + 1..].to_string()))
                } else {
                    (inner, None)
                };
                let (target_raw, anchor) = if let Some(hash) = target_part.find('#') {
                    (target_part[..hash].to_string(), Some(target_part[hash + 1..].to_string()))
                } else {
                    (target_part.to_string(), None)
                };
                links.push(RawLink {
                    target_raw,
                    display_text: display,
                    link_type: "wiki".to_string(),
                    anchor,
                    start_offset: abs_start,
                    end_offset: abs_end,
                });
                search_from = search_from + start + 2 + end + 2;
            } else {
                break;
            }
        }

        // Extract markdown links: [text](path) and ![alt](path)
        search_from = 0;
        while search_from < line.len() {
            // Find [ or ![
            let is_image = line[search_from..].starts_with("![");
            let bracket_offset = if is_image {
                line[search_from..].find("![").map(|p| p)
            } else {
                line[search_from..].find('[').map(|p| p)
            };
            let Some(b_start) = bracket_offset else { break };
            let actual_start = search_from + b_start + if is_image { 2 } else { 1 };
            let rest = &line[actual_start..];
            let Some(bracket_end) = rest.find(']') else {
                search_from = search_from + b_start + 1;
                continue;
            };
            let text = &rest[..bracket_end];
            let after_bracket = &rest[bracket_end + 1..];
            if !after_bracket.starts_with('(') {
                search_from = actual_start + bracket_end + 1;
                continue;
            }
            let paren_rest = &after_bracket[1..];
            let Some(paren_end) = paren_rest.find(')') else {
                search_from = actual_start + bracket_end + 1;
                continue;
            };
            let href = &paren_rest[..paren_end];
            // Only relative .md links or relative asset links
            if href.starts_with("http://") || href.starts_with("https://") {
                search_from = actual_start + bracket_end + paren_end + 3;
                continue;
            }
            let link_type = if is_image { "asset" } else { "markdown" };
            let (target_raw, anchor) = if let Some(hash) = href.rfind('#') {
                (href[..hash].to_string(), Some(href[hash + 1..].to_string()))
            } else {
                (href.to_string(), None)
            };
            let abs_start = offset + search_from + b_start;
            let abs_end = actual_start + bracket_end + 1 + paren_end + 2;
            links.push(RawLink {
                target_raw,
                display_text: Some(text.to_string()),
                link_type: link_type.to_string(),
                anchor,
                start_offset: abs_start,
                end_offset: offset + abs_end,
            });
            search_from = actual_start + bracket_end + 1 + paren_end + 2;
        }

        offset += line.len() + 1;
    }
    links
}
```

- [ ] **Step 2: 在 `markdown.rs` 测试块中追加测试**

在 `#[cfg(test)]` 块中追加：

```rust
    #[test]
    fn test_extract_inline_tags_basic() {
        let body = "Hello #rust and #tauri are great.\nNo tag in `#code` block.";
        let tags = extract_inline_tags(body);
        assert!(tags.contains(&"rust".to_string()));
        assert!(tags.contains(&"tauri".to_string()));
    }

    #[test]
    fn test_extract_inline_tags_skips_code_block() {
        let body = "```\n#notag\n```\n#realtag";
        let tags = extract_inline_tags(body);
        assert!(!tags.contains(&"notag".to_string()));
        assert!(tags.contains(&"realtag".to_string()));
    }

    #[test]
    fn test_extract_links_wiki() {
        let body = "See [[另一篇笔记]] and [[笔记标题|显示文本]] and [[标题#章节]].";
        let links = extract_links(body);
        assert_eq!(links.len(), 3);
        assert_eq!(links[0].target_raw, "另一篇笔记");
        assert_eq!(links[0].link_type, "wiki");
        assert_eq!(links[1].display_text, Some("显示文本".to_string()));
        assert_eq!(links[2].anchor, Some("章节".to_string()));
    }

    #[test]
    fn test_extract_links_markdown() {
        let body = "See [relative](../notes/foo.md) and [section](bar.md#heading).";
        let links = extract_links(body);
        assert_eq!(links.iter().filter(|l| l.link_type == "markdown").count(), 2);
        assert_eq!(links[1].anchor, Some("heading".to_string()));
    }

    #[test]
    fn test_extract_links_skips_http() {
        let body = "Visit [google](https://google.com) for more.";
        let links = extract_links(body);
        assert_eq!(links.len(), 0);
    }
```

- [ ] **Step 3: 运行测试**

```bash
cd /Users/lijun/mynote/src-tauri && cargo test infrastructure::markdown -- --nocapture
```

Expected: 所有 markdown 测试通过（含新增 5 个）。

- [ ] **Step 4: Commit**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/infrastructure/markdown.rs
git commit -m "feat(markdown): add extract_inline_tags and extract_links"
```

---

## Task 4: Rust — 新增 domain 类型 + 全量索引服务

**Files:**
- Create: `src-tauri/src/domain/tag.rs`
- Create: `src-tauri/src/domain/link.rs`
- Create: `src-tauri/src/domain/search.rs`
- Modify: `src-tauri/src/domain/mod.rs`
- Create: `src-tauri/src/services/index.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/services/note.rs`

- [ ] **Step 1: 创建 `src-tauri/src/domain/tag.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagSummary {
    pub id: String,
    pub name: String,
    pub note_count: i64,
}
```

- [ ] **Step 2: 创建 `src-tauri/src/domain/link.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkItem {
    pub link_id: String,
    pub note_id: Option<String>,
    pub note_title: Option<String>,
    pub note_path: Option<String>,
    pub target_raw: String,
    pub display_text: Option<String>,
    pub link_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteLinks {
    pub outgoing: Vec<LinkItem>,
    pub backlinks: Vec<LinkItem>,
    pub unresolved: Vec<LinkItem>,
}
```

- [ ] **Step 3: 创建 `src-tauri/src/domain/search.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub path: String,
    pub snippet: String,
}
```

- [ ] **Step 4: 更新 `src-tauri/src/domain/mod.rs`**

```rust
pub mod knowledge_base;
pub mod link;
pub mod note;
pub mod search;
pub mod tag;
```

- [ ] **Step 5: 创建 `src-tauri/src/services/index.rs`**

```rust
use crate::domain::note::Note;
use crate::error::{AppError, AppResult};
use crate::infrastructure::hash::sha256_str;
use crate::infrastructure::markdown::{extract_inline_tags, extract_links, parse_note};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use ulid::Ulid;

/// 对一篇笔记执行全量索引：upsert notes + 重建 note_tags + links + note_fts
/// 全部在同一个 SQLite 事务中完成。
pub fn index_note_full(
    conn: &Connection,
    root: &Path,
    rel_path: &str,
    content: &str,
) -> AppResult<Note> {
    let stem = Path::new(rel_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let parsed = parse_note(content, &stem)?;
    let hash = sha256_str(content);
    let now = chrono::Utc::now().to_rfc3339();

    let note_id = parsed
        .front_matter
        .id
        .clone()
        .unwrap_or_else(|| Ulid::new().to_string());
    let title = parsed.title.clone();
    let summary = parsed.front_matter.summary.clone();
    let word_count = parsed.word_count as i64;
    let fm_tags = parsed.front_matter.tags.clone().unwrap_or_default();
    let inline_tags = extract_inline_tags(&parsed.body);
    let raw_links = extract_links(&parsed.body);

    // ── single transaction ──────────────────────────────────────────────────
    let tx = conn.unchecked_transaction()?;

    // 1. Upsert note
    tx.execute(
        "INSERT INTO notes (id, path, title, summary, content_hash, word_count, front_matter_json, created_at, updated_at, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', ?7, ?8, ?9)
         ON CONFLICT(path) DO UPDATE SET
           title=excluded.title,
           summary=excluded.summary,
           content_hash=excluded.content_hash,
           word_count=excluded.word_count,
           updated_at=excluded.updated_at,
           indexed_at=excluded.indexed_at",
        params![note_id, rel_path, title, summary, hash, word_count, now, now, now],
    )?;

    // Re-fetch actual id in case of conflict (the existing row keeps its id)
    let actual_id: String = tx.query_row(
        "SELECT id FROM notes WHERE path = ?1",
        params![rel_path],
        |r| r.get(0),
    )?;

    // 2. Rebuild note_tags
    tx.execute("DELETE FROM note_tags WHERE note_id = ?1", params![actual_id])?;
    for tag_name in &fm_tags {
        upsert_tag_and_link(&tx, &actual_id, tag_name, "front_matter", &now)?;
    }
    for tag_name in &inline_tags {
        if !fm_tags.contains(tag_name) {
            upsert_tag_and_link(&tx, &actual_id, tag_name, "inline", &now)?;
        }
    }

    // 3. Rebuild links
    tx.execute("DELETE FROM links WHERE source_note_id = ?1", params![actual_id])?;
    for raw in &raw_links {
        let link_id = Ulid::new().to_string();
        // Resolve target_note_id by title match
        let target_note_id: Option<String> = tx
            .query_row(
                "SELECT id FROM notes WHERE title = ?1 AND deleted_at IS NULL LIMIT 1",
                params![raw.target_raw],
                |r| r.get(0),
            )
            .ok()
            .or_else(|| {
                // case-insensitive fallback
                tx.query_row(
                    "SELECT id FROM notes WHERE lower(title) = lower(?1) AND deleted_at IS NULL LIMIT 1",
                    params![raw.target_raw],
                    |r| r.get(0),
                ).ok()
            });
        let resolved: i64 = if target_note_id.is_some() { 1 } else { 0 };
        tx.execute(
            "INSERT INTO links (id, source_note_id, target_note_id, target_raw, display_text, link_type, anchor, resolved, start_offset, end_offset, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                link_id, actual_id, target_note_id, raw.target_raw, raw.display_text,
                raw.link_type, raw.anchor, resolved,
                raw.start_offset as i64, raw.end_offset as i64, now, now
            ],
        )?;
    }

    // 4. Rebuild FTS
    tx.execute("DELETE FROM note_fts WHERE note_id = ?1", params![actual_id])?;
    tx.execute(
        "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, ?3, ?4)",
        params![actual_id, title, summary.as_deref().unwrap_or(""), parsed.body],
    )?;

    tx.commit()?;

    Ok(Note {
        id: actual_id,
        path: rel_path.to_string(),
        title,
        summary,
        content_hash: hash,
        word_count,
        created_at: now.clone(),
        updated_at: now.clone(),
        indexed_at: now,
        deleted_at: None,
    })
}

fn upsert_tag_and_link(
    tx: &rusqlite::Transaction,
    note_id: &str,
    tag_name: &str,
    source: &str,
    now: &str,
) -> AppResult<()> {
    let normalized = tag_name.to_lowercase();
    let tag_id = Ulid::new().to_string();
    tx.execute(
        "INSERT INTO tags (id, name, normalized_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(normalized_name) DO UPDATE SET updated_at=excluded.updated_at",
        params![tag_id, tag_name, normalized, now, now],
    )?;
    let actual_tag_id: String = tx.query_row(
        "SELECT id FROM tags WHERE normalized_name = ?1",
        params![normalized],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO note_tags (note_id, tag_id, source) VALUES (?1, ?2, ?3)",
        params![note_id, actual_tag_id, source],
    )?;
    Ok(())
}

/// 从文件路径重新索引（供 watcher 调用）
pub fn reindex_from_path(conn: &Connection, root: &PathBuf, rel_path: &str) -> AppResult<Note> {
    let abs = root.join(rel_path);
    let content = std::fs::read_to_string(&abs)
        .map_err(|e| AppError::Io(e))?;
    index_note_full(conn, root, rel_path, &content)
}
```

- [ ] **Step 6: 更新 `src-tauri/src/services/mod.rs`**

```rust
pub mod index;
pub mod knowledge_base;
pub mod note;
pub mod watcher;
```

（`watcher` 模块在 Task 9 实现，此处先声明；如编译器报错暂时注释掉，Task 9 中恢复。）

实际上先添加 index，watcher 到 Task 9 再加：

```rust
pub mod index;
pub mod knowledge_base;
pub mod note;
```

- [ ] **Step 7: 在 `src-tauri/src/services/note.rs` 中调用 `index_note_full`**

在文件顶部 `use` 块添加：

```rust
use crate::services::index::index_note_full;
```

然后修改 `create_note_service` 中写入数据库的部分——将原有的 `conn.execute("INSERT INTO notes ...")` 替换为调用 `index_note_full`：

找到 `create_note_service` 中的 `conn.execute` 调用（大约第 44-47 行）以及后面构造 `Ok(Note {...})` 的部分，替换为：

```rust
    let note = index_note_full(conn, root, &rel_path, &content)?;
    Ok(note)
```

删除原来的 `conn.execute(...)` 和手动构造 `Note {}` 的代码。

修改 `save_note_service` 中更新 DB 的部分（大约第 124-130 行）：

将：
```rust
    conn.execute(
        "UPDATE notes SET title = ?1, content_hash = ?2, word_count = ?3, updated_at = ?4, indexed_at = ?5 WHERE id = ?6",
        params![parsed.title, new_hash, parsed.word_count as i64, now, now, input.note_id],
    )?;

    let note = get_note_by_path_service_inner(conn, root, &path)?;
    Ok(SaveNoteResult { note, conflict: false })
```

替换为：
```rust
    let note = index_note_full(conn, root, &path, &input.content)?;
    Ok(SaveNoteResult { note, conflict: false })
```

删除不再需要的 `new_hash`、`now`、`stem`、`parsed` 局部变量（save_note_service 中 atomic_write 之后的代码）。

修改 `import_note_service` 末尾的 `conn.execute(...)` 和手动构造 `Note {}` 的部分，替换为：

```rust
    let note = index_note_full(conn, &root, &final_rel, &content)?;
    Ok(note)
```

修改 `index_note_from_file` 末尾的 `conn.execute(...)` 和手动构造 `Note {}` 的部分，替换为：

```rust
    let note = index_note_full(conn, root, rel_path, &content)?;
    Ok(note)
```

- [ ] **Step 8: 编译检查**

```bash
cd /Users/lijun/mynote/src-tauri && cargo build 2>&1 | tail -20
```

Expected: `Finished` 无 error（可能有 warning，可忽略）。

- [ ] **Step 9: Commit**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/domain/tag.rs src-tauri/src/domain/link.rs \
        src-tauri/src/domain/search.rs src-tauri/src/domain/mod.rs \
        src-tauri/src/services/index.rs src-tauri/src/services/mod.rs \
        src-tauri/src/services/note.rs
git commit -m "feat(index): full indexing service with tags, links, and FTS"
```

---

## Task 5: Rust — 标签 commands + 前端 TagPanel

**Files:**
- Create: `src-tauri/src/commands/tag.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Modify: `src/store/useAppStore.ts`
- Create: `src/components/LeftSidebar/TagPanel.tsx`
- Modify: `src/components/LeftSidebar/LeftSidebar.tsx`
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`

- [ ] **Step 1: 创建 `src-tauri/src/commands/tag.rs`**

```rust
use crate::domain::tag::TagSummary;
use crate::error::AppResult;
use crate::state::AppState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> Result<Vec<TagSummary>, String> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or("No database open")?;

    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, COUNT(nt.note_id) as note_count
             FROM tags t
             LEFT JOIN note_tags nt ON nt.tag_id = t.id
             LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
             GROUP BY t.id
             ORDER BY note_count DESC, t.name ASC",
        )
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], |row| {
            Ok(TagSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                note_count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tags)
}

#[tauri::command]
pub fn list_notes_by_tag(
    tag_ids: Vec<String>,
    state: State<AppState>,
) -> Result<Vec<crate::domain::note::Note>, String> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or("No database open")?;

    if tag_ids.is_empty() {
        return Ok(vec![]);
    }

    // AND filter: note must have ALL specified tags
    let placeholders = tag_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "SELECT n.id, n.path, n.title, n.summary, n.content_hash, n.word_count,
                n.created_at, n.updated_at, n.indexed_at, n.deleted_at
         FROM notes n
         WHERE n.deleted_at IS NULL
           AND (SELECT COUNT(DISTINCT nt.tag_id) FROM note_tags nt
                WHERE nt.note_id = n.id AND nt.tag_id IN ({placeholders})) = {count}
         ORDER BY n.path",
        placeholders = placeholders,
        count = tag_ids.len()
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = tag_ids
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let notes = stmt
        .query_map(param_refs.as_slice(), |row| {
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
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(notes)
}
```

- [ ] **Step 2: 更新 `src-tauri/src/commands/mod.rs`**

```rust
pub mod knowledge_base;
pub mod link;
pub mod note;
pub mod search;
pub mod tag;
```

（link 和 search 模块在后续 Task 中实现，先声明；如编译报错先不加，Task 6/7 中添加。）

本步只加 tag：
```rust
pub mod knowledge_base;
pub mod note;
pub mod tag;
```

- [ ] **Step 3: 更新 `src-tauri/src/lib.rs` — 注册 tag commands**

在 `invoke_handler` 中追加：

```rust
            commands::tag::list_tags,
            commands::tag::list_notes_by_tag,
```

同时在 `lib.rs` 顶部添加对 `commands::tag` 的可见性（`mod.rs` 已声明则自动可见）。

- [ ] **Step 4: 编译**

```bash
cd /Users/lijun/mynote/src-tauri && cargo build 2>&1 | tail -10
```

Expected: Finished.

- [ ] **Step 5: 更新 `src/types/index.ts` — 添加 Tag 类型**

追加：

```typescript
export interface Tag {
  id: string;
  name: string;
  note_count?: number;
}
```

- [ ] **Step 6: 更新 `src/api/commands.ts` — 添加 tag API**

追加：

```typescript
  listTags: () =>
    invoke<Tag[]>("list_tags"),

  listNotesByTag: (tagIds: string[]) =>
    invoke<Note[]>("list_notes_by_tag", { tagIds }),
```

并在 import 行加上 `Tag`：
```typescript
import type { KnowledgeBase, Note, NoteDetail, NoteTreeNode, SaveNoteResult, Tag } from "../types";
```

- [ ] **Step 7: 更新 `src/store/useAppStore.ts` — 添加 selectedTagIds**

查看当前文件内容然后追加 `selectedTagIds: string[]` 和 `setSelectedTagIds`：

先查看当前内容：现有文件路径 `src/store/useAppStore.ts`。在 state interface 中追加：
```typescript
  selectedTagIds: string[];
  setSelectedTagIds: (ids: string[]) => void;
```

在 create 的初始值中追加：
```typescript
  selectedTagIds: [],
  setSelectedTagIds: (ids) => set({ selectedTagIds: ids }),
```

- [ ] **Step 8: 创建 `src/components/LeftSidebar/TagPanel.tsx`**

```typescript
import { useEffect, useState } from "react";
import { api } from "../../api/commands";
import type { Tag } from "../../types";
import { useAppStore } from "../../store/useAppStore";

export function TagPanel() {
  const [tags, setTags] = useState<Tag[]>([]);
  const { selectedTagIds, setSelectedTagIds } = useAppStore((s) => ({
    selectedTagIds: s.selectedTagIds,
    setSelectedTagIds: s.setSelectedTagIds,
  }));
  const kb = useAppStore((s) => s.kb);

  useEffect(() => {
    if (!kb) return;
    api.listTags().then(setTags).catch(console.error);
  }, [kb]);

  const toggleTag = (id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Multi-select
      setSelectedTagIds(
        selectedTagIds.includes(id)
          ? selectedTagIds.filter((t) => t !== id)
          : [...selectedTagIds, id]
      );
    } else {
      // Single select / deselect
      setSelectedTagIds(selectedTagIds.includes(id) && selectedTagIds.length === 1 ? [] : [id]);
    }
  };

  if (tags.length === 0) {
    return (
      <div style={{ padding: "16px 12px", fontSize: 13, color: "#999" }}>
        暂无标签。在笔记 Front Matter 中添加 <code>tags: [标签名]</code> 或在正文中使用 #标签 语法。
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0" }}>
      {tags.map((tag) => (
        <div
          key={tag.id}
          onClick={(e) => toggleTag(tag.id, e)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 12px",
            cursor: "pointer",
            background: selectedTagIds.includes(tag.id) ? "#e8f0fe" : "transparent",
            borderRadius: 4,
            margin: "1px 4px",
          }}
        >
          <span style={{ fontSize: 13, color: selectedTagIds.includes(tag.id) ? "#1a73e8" : "#333" }}>
            # {tag.name}
          </span>
          <span style={{ fontSize: 11, color: "#999" }}>{tag.note_count ?? 0}</span>
        </div>
      ))}
      {selectedTagIds.length > 0 && (
        <div
          style={{ padding: "6px 12px", fontSize: 12, color: "#888", cursor: "pointer" }}
          onClick={() => setSelectedTagIds([])}
        >
          ✕ 清除过滤
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 9: 更新 `src/components/LeftSidebar/LeftSidebar.tsx` — 添加文件/标签 Tab**

```typescript
import { useState } from "react";
import { FileTreePanel } from "./FileTreePanel";
import { TagPanel } from "./TagPanel";

type Tab = "files" | "tags";

export function LeftSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("files");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab bar */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid #e0e2e7",
        flexShrink: 0,
        background: "#fafbfc",
      }}>
        {(["files", "tags"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: "7px 0",
              fontSize: 12,
              background: "none",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid #1a73e8" : "2px solid transparent",
              color: activeTab === tab ? "#1a73e8" : "#555",
              cursor: "pointer",
              fontWeight: activeTab === tab ? 600 : 400,
            }}
          >
            {tab === "files" ? "文件" : "标签"}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {activeTab === "files" ? <FileTreePanel /> : <TagPanel />}
      </div>
    </div>
  );
}
```

- [ ] **Step 10: 更新 `src/components/LeftSidebar/FileTreePanel.tsx` — 支持标签过滤**

在 `FileTreePanel` 组件中引入 `useAppStore`，在加载笔记树时加入标签过滤逻辑。

找到 `FileTreePanel.tsx` 中调用 `api.getNoteTree()` 的地方，改为：

```typescript
  const { selectedTagIds } = useAppStore((s) => ({ selectedTagIds: s.selectedTagIds }));

  // 当 selectedTagIds 变化时，切换到标签过滤视图
  useEffect(() => {
    if (selectedTagIds.length > 0) {
      api.listNotesByTag(selectedTagIds)
        .then((notes) => {
          // Convert flat notes to tree
          const tree = notes.map((n) => ({
            id: n.id,
            name: n.title,
            path: n.path,
            is_dir: false,
            children: [],
          }));
          setNodes(tree);
        })
        .catch(console.error);
    } else {
      api.getNoteTree().then(setNodes).catch(console.error);
    }
  }, [selectedTagIds, kb]);
```

（`setNodes` 是现有状态 setter，`nodes` 是 `NoteTreeNode[]` state，请根据 FileTreePanel 现有实现调整变量名。）

- [ ] **Step 11: TypeScript 检查**

```bash
cd /Users/lijun/mynote && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 12: Commit**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/commands/tag.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs \
        src/types/index.ts src/api/commands.ts src/store/useAppStore.ts \
        src/components/LeftSidebar/TagPanel.tsx src/components/LeftSidebar/LeftSidebar.tsx \
        src/components/LeftSidebar/FileTreePanel.tsx
git commit -m "feat(tags): tag extraction, list_tags command, TagPanel with multi-select filter"
```

---

## Task 6: Rust — 链接 commands + 前端 BacklinksPanel + Wiki 链接渲染

**Files:**
- Create: `src-tauri/src/commands/link.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Create: `src/components/RightSidebar/BacklinksPanel.tsx`
- Modify: `src/components/RightSidebar/RightSidebar.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`

- [ ] **Step 1: 创建 `src-tauri/src/commands/link.rs`**

```rust
use crate::domain::link::{LinkItem, NoteLinks};
use crate::state::AppState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn get_note_links(note_id: String, state: State<AppState>) -> Result<NoteLinks, String> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or("No database open")?;

    // Outgoing links (this note links to others)
    let mut stmt = conn
        .prepare(
            "SELECT l.id, l.target_note_id, n.title, n.path,
                    l.target_raw, l.display_text, l.link_type
             FROM links l
             LEFT JOIN notes n ON n.id = l.target_note_id
             WHERE l.source_note_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let outgoing: Vec<LinkItem> = stmt
        .query_map(params![note_id], |row| {
            Ok(LinkItem {
                link_id: row.get(0)?,
                note_id: row.get(1)?,
                note_title: row.get(2)?,
                note_path: row.get(3)?,
                target_raw: row.get(4)?,
                display_text: row.get(5)?,
                link_type: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Backlinks (other notes link to this note)
    let mut stmt2 = conn
        .prepare(
            "SELECT l.id, l.source_note_id, n.title, n.path,
                    l.target_raw, l.display_text, l.link_type
             FROM links l
             JOIN notes n ON n.id = l.source_note_id
             WHERE l.target_note_id = ?1 AND n.deleted_at IS NULL",
        )
        .map_err(|e| e.to_string())?;

    let backlinks: Vec<LinkItem> = stmt2
        .query_map(params![note_id], |row| {
            Ok(LinkItem {
                link_id: row.get(0)?,
                note_id: row.get(1)?,
                note_title: row.get(2)?,
                note_path: row.get(3)?,
                target_raw: row.get(4)?,
                display_text: row.get(5)?,
                link_type: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Unresolved links from this note
    let unresolved: Vec<LinkItem> = outgoing
        .iter()
        .filter(|l| l.note_id.is_none())
        .cloned()
        .collect();

    // Outgoing = only resolved ones for the "出链" section
    let resolved_outgoing: Vec<LinkItem> = outgoing
        .into_iter()
        .filter(|l| l.note_id.is_some())
        .collect();

    Ok(NoteLinks {
        outgoing: resolved_outgoing,
        backlinks,
        unresolved,
    })
}
```

- [ ] **Step 2: 更新 `src-tauri/src/commands/mod.rs`**

```rust
pub mod knowledge_base;
pub mod link;
pub mod note;
pub mod tag;
```

- [ ] **Step 3: 更新 `src-tauri/src/lib.rs` — 注册 get_note_links**

追加：
```rust
            commands::link::get_note_links,
```

- [ ] **Step 4: 编译**

```bash
cd /Users/lijun/mynote/src-tauri && cargo build 2>&1 | tail -10
```

Expected: Finished.

- [ ] **Step 5: 更新 `src/types/index.ts` — 添加链接类型**

追加：

```typescript
export interface LinkItem {
  link_id: string;
  note_id: string | null;
  note_title: string | null;
  note_path: string | null;
  target_raw: string;
  display_text: string | null;
  link_type: "wiki" | "markdown" | "asset";
}

export interface NoteLinks {
  outgoing: LinkItem[];
  backlinks: LinkItem[];
  unresolved: LinkItem[];
}
```

- [ ] **Step 6: 更新 `src/api/commands.ts` — 添加 getNoteLinks**

追加：

```typescript
  getNoteLinks: (noteId: string) =>
    invoke<NoteLinks>("get_note_links", { noteId }),
```

并在 import 行加上 `LinkItem, NoteLinks`。

- [ ] **Step 7: 创建 `src/components/RightSidebar/BacklinksPanel.tsx`**

```typescript
import { useEffect, useState } from "react";
import { api } from "../../api/commands";
import type { LinkItem, NoteLinks } from "../../types";
import { useEditorStore } from "../../store/useEditorStore";
import { useAppStore } from "../../store/useAppStore";

function Section({
  title,
  items,
  onSelect,
  color,
}: {
  title: string;
  items: LinkItem[];
  onSelect: (path: string) => void;
  color?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "5px 12px",
          fontSize: 11,
          fontWeight: 600,
          color: "#666",
          cursor: "pointer",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{title}</span>
        <span style={{
          marginLeft: "auto",
          background: "#e8eaed",
          borderRadius: 8,
          padding: "0 6px",
          fontSize: 11,
        }}>
          {items.length}
        </span>
      </div>
      {open && items.map((item) => (
        <div
          key={item.link_id}
          onClick={() => item.note_path && onSelect(item.note_path)}
          style={{
            padding: "4px 12px 4px 24px",
            fontSize: 12,
            cursor: item.note_path ? "pointer" : "default",
            color: color ?? "#333",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={item.note_path ?? item.target_raw}
        >
          {item.note_title ?? item.target_raw}
        </div>
      ))}
    </div>
  );
}

export function BacklinksPanel() {
  const { currentNote } = useEditorStore();
  const [links, setLinks] = useState<NoteLinks | null>(null);
  const { kb } = useAppStore((s) => ({ kb: s.kb }));

  useEffect(() => {
    if (!currentNote || !kb) { setLinks(null); return; }
    api.getNoteLinks(currentNote.id).then(setLinks).catch(console.error);
  }, [currentNote?.id, kb]);

  const handleSelect = (path: string) => {
    api.getNoteByPath(path).then((detail) => {
      useEditorStore.getState().setCurrentNote(detail.note);
      useEditorStore.getState().setContent(detail.content);
    }).catch(console.error);
  };

  if (!currentNote) {
    return <div style={{ padding: 12, fontSize: 12, color: "#999" }}>请先选择笔记</div>;
  }
  if (!links) {
    return <div style={{ padding: 12, fontSize: 12, color: "#999" }}>加载中…</div>;
  }

  return (
    <div style={{ paddingTop: 8 }}>
      <Section title="出链" items={links.outgoing} onSelect={handleSelect} />
      <Section title="反链" items={links.backlinks} onSelect={handleSelect} />
      <Section title="未解析" items={links.unresolved} onSelect={() => {}} color="#e53935" />
    </div>
  );
}
```

- [ ] **Step 8: 更新 `src/components/RightSidebar/RightSidebar.tsx` — 添加大纲/反链 Tab**

```typescript
import { useState } from "react";
import { BacklinksPanel } from "./BacklinksPanel";

type Tab = "outline" | "backlinks";

export function RightSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("backlinks");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        display: "flex",
        borderBottom: "1px solid #e0e2e7",
        flexShrink: 0,
        background: "#fafbfc",
      }}>
        {(["outline", "backlinks"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: "7px 0",
              fontSize: 12,
              background: "none",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid #1a73e8" : "2px solid transparent",
              color: activeTab === tab ? "#1a73e8" : "#555",
              cursor: "pointer",
              fontWeight: activeTab === tab ? 600 : 400,
            }}
          >
            {tab === "outline" ? "大纲" : "链接"}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {activeTab === "outline"
          ? <div style={{ padding: 12, fontSize: 12, color: "#999" }}>大纲（Phase 3 实现）</div>
          : <BacklinksPanel />}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: 更新 `src/components/EditorWorkspace/MarkdownPreview.tsx` — Wiki 链接渲染**

在文件顶部添加 imports：

```typescript
import { useEditorStore } from "../../store/useEditorStore";
import { api } from "../../api/commands";
```

在 `MarkdownPreview` 函数中，在 `const containerRef = ...` 之前添加：

```typescript
  const setCurrentNote = useEditorStore((s) => s.setCurrentNote);
  const setContent = useEditorStore((s) => s.setContent);
```

修改 `MarkdownIt` 初始化，追加 wiki link 插件：

在 `const md = new MarkdownIt(...)` 之后，追加一个自定义 inline rule：

```typescript
// 在组件外部（模块级）定义 md 实例并注册 wiki 链接规则
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// Preprocess: replace [[...]] before markdown-it processes the text
function preprocessWikiLinks(content: string): string {
  return content.replace(
    /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,
    (_, target, anchor, display) => {
      const text = display || target;
      const href = anchor ? `${target}#${anchor}` : target;
      return `<span class="wiki-link" data-target="${encodeURIComponent(href)}">${text}</span>`;
    }
  );
}
```

然后修改 `useEffect` 中的渲染部分：

```typescript
  useEffect(() => {
    if (!containerRef.current) return;
    const processed = preprocessWikiLinks(content);
    containerRef.current.innerHTML = md.render(processed);
  }, [content]);
```

在容器的外层 `div` 上添加点击事件委托：

```typescript
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const wikiLink = target.closest(".wiki-link") as HTMLElement | null;
    if (wikiLink) {
      e.preventDefault();
      const rawTarget = decodeURIComponent(wikiLink.dataset.target ?? "");
      const title = rawTarget.split("#")[0];
      // Find note by searching for title match
      api.getNoteByPath(title).catch(() => {
        // If direct path fails, try as title — for now just log
        console.warn("Wiki link target not found:", title);
      }).then((detail) => {
        if (detail) {
          setCurrentNote(detail.note);
          setContent(detail.content);
        }
      });
    }
  };
```

在返回的外层 `div` 上添加 `onClick={handleClick}`。

在 `src/styles/global.css` 中追加 wiki link 样式：

```css
.wiki-link {
  color: #1a73e8;
  text-decoration: underline;
  cursor: pointer;
}
.wiki-link[data-unresolved] {
  color: #e53935;
  text-decoration: underline dotted;
}
```

- [ ] **Step 10: TypeScript 检查**

```bash
cd /Users/lijun/mynote && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 11: Commit**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/commands/link.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs \
        src/types/index.ts src/api/commands.ts \
        src/components/RightSidebar/BacklinksPanel.tsx \
        src/components/RightSidebar/RightSidebar.tsx \
        src/components/EditorWorkspace/MarkdownPreview.tsx \
        src/styles/global.css
git commit -m "feat(links): backlinks panel, wiki link rendering, get_note_links command"
```

---

## Task 7: Rust — 搜索 command + 前端 SearchOverlay

**Files:**
- Create: `src-tauri/src/commands/search.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Create: `src/hooks/useSearch.ts`
- Create: `src/components/SearchOverlay.tsx`
- Modify: `src/components/AppHeader.tsx`

- [ ] **Step 1: 创建 `src-tauri/src/commands/search.rs`**

```rust
use crate::domain::search::SearchResult;
use crate::state::AppState;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn search_notes(
    query: String,
    limit: Option<i64>,
    state: State<AppState>,
) -> Result<Vec<SearchResult>, String> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or("No database open")?;

    if query.trim().is_empty() {
        // Return recent notes ordered by updated_at
        let mut stmt = conn
            .prepare(
                "SELECT id, title, path FROM notes
                 WHERE deleted_at IS NULL
                 ORDER BY updated_at DESC LIMIT 10",
            )
            .map_err(|e| e.to_string())?;
        let results = stmt
            .query_map([], |row| {
                Ok(SearchResult {
                    note_id: row.get(0)?,
                    title: row.get(1)?,
                    path: row.get(2)?,
                    snippet: String::new(),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        return Ok(results);
    }

    let max = limit.unwrap_or(50);
    // FTS5 query: wrap in quotes for phrase if contains spaces, else use as-is
    let fts_query = if query.contains(' ') {
        format!("\"{}\"", query.replace('"', ""))
    } else {
        format!("{}*", query) // prefix match
    };

    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.title, n.path,
                    snippet(note_fts, 3, '<mark>', '</mark>', '…', 20) as snippet
             FROM note_fts
             JOIN notes n ON note_fts.note_id = n.id
             WHERE note_fts MATCH ?1 AND n.deleted_at IS NULL
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map(params![fts_query, max], |row| {
            Ok(SearchResult {
                note_id: row.get(0)?,
                title: row.get(1)?,
                path: row.get(2)?,
                snippet: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(results)
}
```

- [ ] **Step 2: 更新 `src-tauri/src/commands/mod.rs`**

```rust
pub mod knowledge_base;
pub mod link;
pub mod note;
pub mod search;
pub mod tag;
```

- [ ] **Step 3: 更新 `src-tauri/src/lib.rs` — 注册 search_notes**

追加：
```rust
            commands::search::search_notes,
```

- [ ] **Step 4: 编译**

```bash
cd /Users/lijun/mynote/src-tauri && cargo build 2>&1 | tail -10
```

Expected: Finished.

- [ ] **Step 5: 更新 `src/types/index.ts` — 添加 SearchResult**

追加：

```typescript
export interface SearchResult {
  note_id: string;
  title: string;
  path: string;
  snippet: string;
}
```

- [ ] **Step 6: 更新 `src/api/commands.ts` — 添加 searchNotes**

追加：

```typescript
  searchNotes: (query: string, limit?: number) =>
    invoke<SearchResult[]>("search_notes", { query, limit }),
```

并在 import 行加上 `SearchResult`。

- [ ] **Step 7: 创建 `src/hooks/useSearch.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/commands";
import type { SearchResult } from "../types";

export function useSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery("");
    api.searchNotes("").then(setResults).catch(() => {});
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) close(); else open();
      }
      if (e.key === "Escape" && isOpen) close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, open, close]);

  const handleQueryChange = useCallback((q: string) => {
    setQuery(q);
    setSelectedIndex(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      api.searchNotes(q)
        .then((r) => { setResults(r); setLoading(false); })
        .catch(() => setLoading(false));
    }, 300);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
  }, [results.length]);

  return { isOpen, query, results, loading, selectedIndex, open, close, handleQueryChange, handleKeyDown };
}
```

- [ ] **Step 8: 创建 `src/components/SearchOverlay.tsx`**

```typescript
import { useRef, useEffect } from "react";
import type { SearchResult } from "../types";
import { api } from "../api/commands";
import { useEditorStore } from "../store/useEditorStore";

interface Props {
  query: string;
  results: SearchResult[];
  loading: boolean;
  selectedIndex: number;
  onQueryChange: (q: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onClose: () => void;
}

export function SearchOverlay({
  query, results, loading, selectedIndex,
  onQueryChange, onKeyDown, onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { setCurrentNote, setContent } = useEditorStore();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const openNote = (result: SearchResult) => {
    api.getNoteByPath(result.path)
      .then((detail) => {
        setCurrentNote(detail.note);
        setContent(detail.content);
        onClose();
      })
      .catch(console.error);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: 80,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 560, background: "#fff", borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}>
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #e0e2e7" }}>
          <span style={{ marginRight: 10, color: "#999", fontSize: 16 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              onKeyDown(e);
              if (e.key === "Enter" && results[selectedIndex]) {
                openNote(results[selectedIndex]);
              }
            }}
            placeholder="搜索笔记标题、内容、标签…"
            style={{
              flex: 1, border: "none", outline: "none",
              fontSize: 15, background: "transparent",
            }}
          />
          {loading && <span style={{ fontSize: 12, color: "#999" }}>搜索中…</span>}
        </div>
        {/* Results */}
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {results.length === 0 && !loading && (
            <div style={{ padding: "20px 16px", fontSize: 13, color: "#999", textAlign: "center" }}>
              {query ? "未找到匹配结果" : "暂无最近访问记录"}
            </div>
          )}
          {results.map((r, i) => (
            <div
              key={r.note_id}
              onClick={() => openNote(r)}
              style={{
                padding: "10px 16px",
                cursor: "pointer",
                background: i === selectedIndex ? "#f0f4ff" : "transparent",
                borderBottom: "1px solid #f5f5f5",
              }}
              onMouseEnter={() => {}}
            >
              <div style={{ fontSize: 14, fontWeight: 500, color: "#222", marginBottom: 2 }}>
                {r.title}
              </div>
              <div style={{ fontSize: 11, color: "#888", marginBottom: r.snippet ? 4 : 0 }}>
                {r.path}
              </div>
              {r.snippet && (
                <div
                  style={{ fontSize: 12, color: "#555", lineHeight: 1.5 }}
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              )}
            </div>
          ))}
        </div>
        {/* Footer */}
        <div style={{
          padding: "8px 16px", fontSize: 11, color: "#aaa",
          borderTop: "1px solid #f0f0f0",
          display: "flex", gap: 16,
        }}>
          <span>↑↓ 导航</span>
          <span>↵ 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: 更新 `src/components/AppHeader.tsx` — 搜索按钮**

```typescript
import { useAppStore } from "../store/useAppStore";
import { useSearch } from "../hooks/useSearch";
import { SearchOverlay } from "./SearchOverlay";

export function AppHeader() {
  const kb = useAppStore((s) => s.kb);
  const search = useSearch();

  return (
    <>
      <header className="app-header">
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {kb ? kb.name : "MyNote"}
        </span>
        <div style={{ flex: 1 }} />
        {kb && (
          <button
            onClick={search.open}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 12px", border: "1px solid #e0e2e7",
              borderRadius: 6, background: "#fff", cursor: "pointer",
              fontSize: 12, color: "#666",
            }}
          >
            <span>🔍</span>
            <span>搜索</span>
            <kbd style={{ fontSize: 10, background: "#f0f0f0", padding: "1px 4px", borderRadius: 3 }}>
              ⌘K
            </kbd>
          </button>
        )}
      </header>
      {search.isOpen && (
        <SearchOverlay
          query={search.query}
          results={search.results}
          loading={search.loading}
          selectedIndex={search.selectedIndex}
          onQueryChange={search.handleQueryChange}
          onKeyDown={search.handleKeyDown}
          onClose={search.close}
        />
      )}
    </>
  );
}
```

- [ ] **Step 10: TypeScript 检查**

```bash
cd /Users/lijun/mynote && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 11: Commit**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/commands/search.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs \
        src/types/index.ts src/api/commands.ts \
        src/hooks/useSearch.ts src/components/SearchOverlay.tsx \
        src/components/AppHeader.tsx
git commit -m "feat(search): FTS5 search command, SearchOverlay with keyboard navigation"
```

---

## Task 8: Rust — 文件监听 (watcher) + 前端事件处理

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/services/watcher.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: 在 `src-tauri/Cargo.toml` 添加 notify**

在 `[dependencies]` 中追加：

```toml
notify = "6"
```

- [ ] **Step 2: 创建 `src-tauri/src/services/watcher.rs`**

```rust
use crate::services::index::reindex_from_path;
use crate::state::AppState;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
}

/// 启动文件监听。监听 <root>/notes/ 目录，防抖 500ms，索引变更文件后 emit "note:index_updated"。
pub fn start_watching(root: PathBuf, app_handle: AppHandle) -> Result<WatcherHandle, String> {
    let notes_dir = root.join("notes");
    if !notes_dir.exists() {
        return Err(format!("notes dir not found: {}", notes_dir.display()));
    }

    // Debounce map: path -> last event time
    let debounce: Arc<Mutex<HashMap<PathBuf, Instant>>> = Arc::new(Mutex::new(HashMap::new()));
    let debounce_clone = debounce.clone();
    let app_clone = app_handle.clone();
    let root_clone = root.clone();

    let (tx, rx) = std::sync::mpsc::channel::<Result<Event, notify::Error>>();

    // Spawn processing thread
    std::thread::spawn(move || {
        let debounce_ms = Duration::from_millis(500);
        loop {
            // Drain channel with timeout
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(event)) => {
                    let paths: Vec<PathBuf> = event.paths.into_iter()
                        .filter(|p| p.extension().map(|e| e == "md").unwrap_or(false))
                        .collect();
                    if paths.is_empty() { continue; }

                    let mut map = debounce_clone.lock().unwrap();
                    for path in paths {
                        match event.kind {
                            EventKind::Create(_) | EventKind::Modify(_) => {
                                map.insert(path, Instant::now());
                            }
                            _ => {}
                        }
                    }
                }
                Ok(Err(e)) => eprintln!("[watcher] error: {:?}", e),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }

            // Process debounced events
            let now = Instant::now();
            let mut to_process: Vec<PathBuf> = Vec::new();
            {
                let mut map = debounce_clone.lock().unwrap();
                map.retain(|path, last_event| {
                    if now.duration_since(*last_event) >= debounce_ms {
                        to_process.push(path.clone());
                        false
                    } else {
                        true
                    }
                });
            }

            for abs_path in to_process {
                // Compute relative path from kb root
                if let Ok(rel) = abs_path.strip_prefix(&root_clone) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    // Access AppState via app_handle
                    let state = app_clone.state::<AppState>();
                    let mut db_guard = state.db.lock().unwrap();
                    let kb_root_guard = state.kb_root.lock().unwrap();
                    if let (Some(conn), Some(root_path)) = (db_guard.as_mut(), kb_root_guard.as_ref()) {
                        match reindex_from_path(conn, root_path, &rel_str) {
                            Ok(_) => {
                                let _ = app_clone.emit("note:index_updated", &rel_str);
                            }
                            Err(e) => eprintln!("[watcher] index error {}: {:?}", rel_str, e),
                        }
                    }
                }
            }
        }
    });

    let mut watcher =
        RecommendedWatcher::new(tx, Config::default()).map_err(|e| e.to_string())?;
    watcher
        .watch(&notes_dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    Ok(WatcherHandle { _watcher: watcher })
}
```

- [ ] **Step 3: 更新 `src-tauri/src/services/mod.rs`**

```rust
pub mod index;
pub mod knowledge_base;
pub mod note;
pub mod watcher;
```

- [ ] **Step 4: 更新 `src-tauri/src/state.rs` — 添加 watcher 字段**

```rust
use crate::services::watcher::WatcherHandle;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub kb_root: Mutex<Option<PathBuf>>,
    pub db: Mutex<Option<Connection>>,
    pub watcher: Mutex<Option<WatcherHandle>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            kb_root: Mutex::new(None),
            db: Mutex::new(None),
            watcher: Mutex::new(None),
        }
    }
}
```

- [ ] **Step 5: 更新 `src-tauri/src/lib.rs` — 打开知识库后启动 watcher**

在 `lib.rs` 的 `run()` 函数中，在 `.manage(AppState::new())` 之后，在 `.invoke_handler(...)` 之前，添加：

```rust
        .setup(|app| {
            // Nothing to setup at boot; watcher starts when KB opens
            Ok(())
        })
```

在 `open_knowledge_base` command 的调用链上，需要将 `app_handle` 传给 watcher。由于 `commands::knowledge_base::open_knowledge_base` 目前不持有 `AppHandle`，需要修改该 command 签名。

打开 `src-tauri/src/commands/knowledge_base.rs`，找到 `open_knowledge_base` 函数，在参数中追加 `app_handle: tauri::AppHandle`，并在函数末尾（成功打开 KB 之后）添加：

```rust
    // Start file watcher
    {
        let root_guard = state.kb_root.lock().unwrap();
        if let Some(root) = root_guard.as_ref() {
            match crate::services::watcher::start_watching(root.clone(), app_handle.clone()) {
                Ok(handle) => {
                    let mut w = state.watcher.lock().unwrap();
                    *w = Some(handle);
                }
                Err(e) => eprintln!("[watcher] failed to start: {}", e),
            }
        }
    }
```

同样修改 `create_knowledge_base` command，在成功创建后添加相同的 watcher 启动代码。

- [ ] **Step 6: 编译**

```bash
cd /Users/lijun/mynote/src-tauri && cargo build 2>&1 | tail -20
```

Expected: Finished。（注意 notify 首次会下载编译，可能需要 1-2 分钟。）

- [ ] **Step 7: 前端 — 监听 `note:index_updated` 事件刷新文件树**

在 `src/components/LeftSidebar/FileTreePanel.tsx` 中，在组件 mount 时监听 Tauri 事件。

在文件顶部引入：
```typescript
import { listen } from "@tauri-apps/api/event";
```

在 `FileTreePanel` 组件内，在现有 `useEffect` 之后追加：

```typescript
  // Refresh tree when backend signals index update
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("note:index_updated", () => {
      if (selectedTagIds.length > 0) {
        api.listNotesByTag(selectedTagIds).then((notes) => {
          setNodes(notes.map((n) => ({
            id: n.id, name: n.title, path: n.path, is_dir: false, children: [],
          })));
        }).catch(console.error);
      } else {
        api.getNoteTree().then(setNodes).catch(console.error);
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [selectedTagIds]);
```

- [ ] **Step 8: 前端 — StatusBar 显示索引同步状态**

查看 `src/components/StatusBar.tsx` 当前内容，追加索引状态监听：

在 `StatusBar` 组件中添加：

```typescript
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

// 在组件内：
  const [indexing, setIndexing] = useState(false);
  const indexTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("note:index_updated", () => {
      setIndexing(true);
      if (indexTimerRef.current) clearTimeout(indexTimerRef.current);
      indexTimerRef.current = setTimeout(() => setIndexing(false), 2000);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);
```

在 StatusBar 的 JSX 中追加：
```typescript
      {indexing && <span style={{ color: "#1a73e8" }}>● 索引同步中</span>}
```

- [ ] **Step 9: TypeScript 检查**

```bash
cd /Users/lijun/mynote && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 10: 最终编译确认**

```bash
cd /Users/lijun/mynote/src-tauri && cargo build 2>&1 | tail -10
```

Expected: Finished.

- [ ] **Step 11: Commit**

```bash
cd /Users/lijun/mynote
git add src-tauri/Cargo.toml src-tauri/src/services/watcher.rs \
        src-tauri/src/services/mod.rs src-tauri/src/state.rs \
        src-tauri/src/commands/knowledge_base.rs src-tauri/src/lib.rs \
        src/components/LeftSidebar/FileTreePanel.tsx \
        src/components/StatusBar.tsx
git commit -m "feat(watcher): file watcher with debounce, auto-reindex on external changes"
```

---

## 自检：规格覆盖率

| 规格要求 | 对应 Task |
|---------|----------|
| DB migration: tags / note_tags / links / file_events | Task 1 |
| 侧边栏可折叠 / 可调宽 / localStorage 持久化 | Task 2 |
| 标签提取（Front Matter + inline #标签）| Task 3 |
| 全量索引服务（单事务 tags + links + FTS）| Task 4 |
| list_tags / list_notes_by_tag commands | Task 5 |
| TagPanel 多选过滤 | Task 5 |
| 左侧栏 Tab（文件/标签）| Task 5 |
| get_note_links command（出链/反链/未解析）| Task 6 |
| BacklinksPanel（3 折叠区域）| Task 6 |
| 右侧栏 Tab（大纲/链接）| Task 6 |
| Wiki 链接渲染 + 点击导航 | Task 6 |
| search_notes FTS5 command（前缀匹配 + snippet）| Task 7 |
| SearchOverlay（⌘K, ↑↓ 导航, 片段高亮）| Task 7 |
| 搜索框集成到 AppHeader | Task 7 |
| notify 文件监听（防抖 500ms）| Task 8 |
| 外部修改触发增量索引 | Task 8 |
| StatusBar 索引同步提示 | Task 8 |
| 右侧边栏初始收起 / 左侧展开 | Task 2 (defaultVisible 参数) |
