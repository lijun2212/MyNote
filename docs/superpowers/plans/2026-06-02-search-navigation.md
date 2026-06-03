# Search Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade search into a full-text, relevance-ranked, hit-level navigation flow that opens a note and synchronizes both editor and preview to the selected match location.

**Architecture:** Keep SQLite FTS5 as the recall layer, then reconstruct hit-level matches from candidate Markdown files in Rust so the frontend receives exact line-based results instead of coarse note-level items. On the frontend, add a search-specific navigation target in editor state, keep `useSearch` and the overlay typed against the richer result shape, and reuse the existing editor/preview source-line synchronization path for the final jump.

**Tech Stack:** Rust, rusqlite, Tauri commands, React 19, TypeScript, Zustand, Vitest, React Testing Library.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-02 | v1.0 | 根据已确认的全文搜索导航设计创建 implementation plan。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. Task 1: 后端搜索结果升级为命中级](#2-task-1-后端搜索结果升级为命中级)
- [3. Task 2: 前端类型与搜索 Hook 接线](#3-task-2-前端类型与搜索-hook-接线)
- [4. Task 3: 搜索导航状态与编辑区/预览区定位](#4-task-3-搜索导航状态与编辑区预览区定位)
- [5. Task 4: 搜索弹层结果渲染与打开行为](#5-task-4-搜索弹层结果渲染与打开行为)
- [6. Task 5: 总验证](#6-task-5-总验证)
- [7. 计划自检](#7-计划自检)

## 1. 文件结构

### Rust 修改

- Modify: `src-tauri/src/domain/search.rs` - 搜索结果模型从笔记级升级为命中级。
- Modify: `src-tauri/src/commands/search.rs` - 召回候选笔记、重建命中位置、按相关度排序并返回命中级结果。

### 前端修改

- Modify: `src/types/index.ts` - 新增 `SearchNavigationTarget`，扩展 `SearchResult`。
- Modify: `src/test/testData.ts` - 更新 `makeSearchResult` 默认结构。
- Modify: `src/hooks/useSearch.ts` - 继续复用 API，但适配新结果结构。
- Modify: `src/hooks/useSearch.test.tsx` - 断言新的返回结构不破坏防抖与竞态保护。
- Modify: `src/store/useEditorStore.ts` - 新增 `searchNavigationTarget` 状态。
- Modify: `src/hooks/useOpenNote.ts` - 保持打开逻辑不改签名，但为后续搜索导航调用提供稳定时序。
- Modify: `src/components/EditorWorkspace/MarkdownEditor.tsx` - 接收搜索导航目标并滚动/高亮。
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx` - 接收搜索导航目标并翻译到预览 source line。
- Modify: `src/components/SearchOverlay.tsx` - 展示命中级结果、调用打开并设置搜索导航目标。

### 测试修改

- Modify: `src/components/SearchOverlay.test.tsx` - 覆盖命中级结果渲染与打开行为。
- Modify: `src/components/EditorWorkspace/MarkdownEditor.test.tsx` - 覆盖搜索导航滚动与高亮。
- Modify: `src/components/EditorWorkspace/MarkdownPreview.test.tsx` - 覆盖搜索导航在 front matter 偏移下的定位。

## 2. Task 1: 后端搜索结果升级为命中级

**Files:**
- Modify: `src-tauri/src/domain/search.rs`
- Modify: `src-tauri/src/commands/search.rs`

- [ ] **Step 1: 先写 Rust 失败测试，锁定“同一篇文章多命中展开为多条结果”**

在 `src-tauri/src/commands/search.rs` 的测试模块中添加：

```rust
#[test]
fn search_notes_expands_multiple_body_hits_into_multiple_results() {
    let conn = setup_search_db();
    conn.execute(
        "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
        rusqlite::params!["n1", "notes/demo.md", "Demo Note"],
    ).unwrap();
    conn.execute(
        "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
        rusqlite::params!["n1", "Demo Note", "alpha first line\nneutral line\nalpha second line"],
    ).unwrap();

    let results = search_notes_in_conn(&conn, "alpha").unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].line_start, 1);
    assert_eq!(results[0].occurrence_order, 1);
    assert_eq!(results[1].line_start, 3);
    assert_eq!(results[1].occurrence_order, 2);
}
```

- [ ] **Step 2: 再写 Rust 失败测试，锁定“标题命中优先于正文命中”**

继续在同一测试模块添加：

```rust
#[test]
fn search_notes_ranks_title_hits_ahead_of_body_hits() {
    let conn = setup_search_db();
    conn.execute(
        "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
        rusqlite::params!["title-note", "notes/title.md", "Alpha Design"],
    ).unwrap();
    conn.execute(
        "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
        rusqlite::params!["body-note", "notes/body.md", "Neutral"],
    ).unwrap();
    conn.execute(
        "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
        rusqlite::params!["title-note", "Alpha Design", "neutral body"],
    ).unwrap();
    conn.execute(
        "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
        rusqlite::params!["body-note", "Neutral", "alpha appears in body only"],
    ).unwrap();

    let results = search_notes_in_conn(&conn, "alpha").unwrap();

    assert_eq!(results[0].note_id, "title-note");
    assert_eq!(results[0].source, "title");
}
```

- [ ] **Step 3: 运行 Rust 窄测试，确认它先失败**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test commands::search::tests::search_notes_expands_multiple_body_hits_into_multiple_results
cargo test commands::search::tests::search_notes_ranks_title_hits_ahead_of_body_hits
```

Expected: FAIL because `SearchResult` 还没有 `line_start`、`occurrence_order`、`source` 等字段，查询仍返回笔记级结果。

- [ ] **Step 4: 扩展 Rust 搜索结果模型**

将 `src-tauri/src/domain/search.rs` 改为：

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub path: String,
    pub snippet: String,
    pub line_start: i64,
    pub line_end: i64,
    pub occurrence_order: i64,
    pub match_text: String,
    pub source: String,
    pub score: f64,
}
```

- [ ] **Step 5: 在 `src-tauri/src/commands/search.rs` 写最小命中重建实现**

在现有 `search_notes_in_conn` 上方加入以下帮助结构和函数：

```rust
#[derive(Debug)]
struct CandidateNote {
    note_id: String,
    title: String,
    path: String,
    rank: f64,
}

fn build_snippet(line: &str, query: &str) -> String {
    let lower_line = line.to_lowercase();
    let lower_query = query.to_lowercase();
    if let Some(index) = lower_line.find(&lower_query) {
        let end = index + query.len().min(line.len().saturating_sub(index));
        format!(
            "{}<mark>{}</mark>{}",
            &line[..index],
            &line[index..end],
            &line[end..]
        )
    } else {
        line.to_string()
    }
}

fn expand_candidate_hits(candidate: &CandidateNote, query: &str) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let lower_query = query.trim().to_lowercase();
    let mut occurrence_order = 0_i64;

    if candidate.title.to_lowercase().contains(&lower_query) {
        occurrence_order += 1;
        results.push(SearchResult {
            note_id: candidate.note_id.clone(),
            title: candidate.title.clone(),
            path: candidate.path.clone(),
            snippet: build_snippet(&candidate.title, query),
            line_start: 1,
            line_end: 1,
            occurrence_order,
            match_text: query.to_string(),
            source: "title".to_string(),
            score: candidate.rank - 1000.0,
        });
    }

    for (index, line) in candidate.path.lines().enumerate() {
        let _ = index;
        let _ = line;
    }

    results
}
```

然后把 `setup_search_db()` 改成让 `notes` 带 `body` 列，仅用于测试命中重建：

```rust
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    body TEXT DEFAULT '',
    deleted_at TEXT
);
```

并把测试插入语句改成写入 `body`：

```rust
"INSERT INTO notes (id, path, title, summary, body, deleted_at) VALUES (?1, ?2, ?3, NULL, ?4, NULL)"
```

再将查询拆成“候选召回 + 命中展开”：

```rust
fn search_notes_in_conn(conn: &Connection, query: &str) -> Result<Vec<SearchResult>, AppError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let fts_query = format!("\"{}\"*", trimmed.replace('"', "\"\""));
    let like_query = escape_like_query(trimmed);

    let mut stmt = conn.prepare(
        "SELECT n.id, n.title, n.path, n.body, bm25(note_fts) AS rank
         FROM note_fts
         JOIN notes n ON note_fts.note_id = n.id AND n.deleted_at IS NULL
         WHERE note_fts MATCH ?1
         UNION ALL
         SELECT n.id, n.title, n.path, n.body, 0.0 AS rank
         FROM notes n
         WHERE n.deleted_at IS NULL
           AND (n.title LIKE ?2 ESCAPE '\\\\' OR n.path LIKE ?2 ESCAPE '\\\\')",
    )?;

    let candidates = stmt
        .query_map(rusqlite::params![fts_query, like_query], |row| {
            Ok((
                CandidateNote {
                    note_id: row.get(0)?,
                    title: row.get(1)?,
                    path: row.get(2)?,
                    rank: row.get(4)?,
                },
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut expanded = Vec::new();
    for (candidate, body) in candidates.into_iter().take(20) {
        let mut occurrence_order = expanded
            .iter()
            .filter(|item: &&SearchResult| item.note_id == candidate.note_id)
            .count() as i64;

        if candidate.title.to_lowercase().contains(&trimmed.to_lowercase()) {
            occurrence_order += 1;
            expanded.push(SearchResult {
                note_id: candidate.note_id.clone(),
                title: candidate.title.clone(),
                path: candidate.path.clone(),
                snippet: build_snippet(&candidate.title, trimmed),
                line_start: 1,
                line_end: 1,
                occurrence_order,
                match_text: trimmed.to_string(),
                source: "title".to_string(),
                score: candidate.rank - 1000.0,
            });
        }

        for (line_index, line) in body.lines().enumerate() {
            if !line.to_lowercase().contains(&trimmed.to_lowercase()) {
                continue;
            }
            occurrence_order += 1;
            expanded.push(SearchResult {
                note_id: candidate.note_id.clone(),
                title: candidate.title.clone(),
                path: candidate.path.clone(),
                snippet: build_snippet(line, trimmed),
                line_start: (line_index + 1) as i64,
                line_end: (line_index + 1) as i64,
                occurrence_order,
                match_text: trimmed.to_string(),
                source: "body".to_string(),
                score: candidate.rank,
            });
        }
    }

    expanded.sort_by(|left, right| {
        left.score
            .partial_cmp(&right.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(left.line_start.cmp(&right.line_start))
    });

    Ok(expanded)
}
```

这一步先接受“测试环境用 `notes.body` 字段承载原文”的最小实现，下一步再替换为真实文件重建。

- [ ] **Step 6: 将命中重建切换到真实文件内容**

把 `search_notes_in_conn` 改签名为接收知识库根路径，并新增一个真实文件读取版本：

```rust
fn search_notes_in_conn(conn: &Connection, kb_root: &std::path::Path, query: &str) -> Result<Vec<SearchResult>, AppError> {
    // 保留候选召回逻辑
    // 对 candidate.path 调用 resolve_kb_path(kb_root, &candidate.path)?
    // 读取 markdown 原文并逐行重建命中
}
```

更新 command 调用：

```rust
let root_guard = state.kb_root.lock().unwrap();
let root = root_guard
    .as_ref()
    .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
    .clone();

search_notes_in_conn(conn, &root, &query)
```

并在测试模块中保留 `search_notes_in_conn_for_body(conn, query)` 这样的 helper，仅供内存库测试使用：

```rust
fn search_notes_in_conn_for_body(conn: &Connection, query: &str) -> Result<Vec<SearchResult>, AppError> {
    // 使用 notes.body 做测试替身，避免每个单测都创建临时目录
}
```

- [ ] **Step 7: 重跑 Rust 搜索测试，确认通过**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test commands::search::tests
```

Expected: PASS，且新增测试证明多命中展开和标题优先排序成立。

- [ ] **Step 8: Commit 后端搜索切片**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/domain/search.rs src-tauri/src/commands/search.rs
git commit -m "feat(search): return hit-level search results"
```

## 3. Task 2: 前端类型与搜索 Hook 接线

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/test/testData.ts`
- Modify: `src/hooks/useSearch.ts`
- Modify: `src/hooks/useSearch.test.tsx`

- [ ] **Step 1: 先扩展前端类型测试夹具**

把 `src/test/testData.ts` 中的 `makeSearchResult` 改为：

```ts
export function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    note_id: "note1",
    title: "Note 1",
    path: "notes/note1.md",
    snippet: "A <mark>note</mark> result",
    line_start: 3,
    line_end: 3,
    occurrence_order: 1,
    match_text: "note",
    source: "body",
    score: -1.2,
    ...overrides,
  };
}
```

- [ ] **Step 2: 扩展前端搜索类型**

在 `src/types/index.ts` 中新增：

```ts
export interface SearchNavigationTarget {
  note_id: string;
  note_path: string;
  note_title: string;
  line_start: number;
  line_end: number;
  occurrence_order: number;
  match_text: string;
  context_snippet: string;
  source: "title" | "body";
  revision: number;
}
```

并将 `SearchResult` 改成：

```ts
export interface SearchResult {
  note_id: string;
  title: string;
  path: string;
  snippet: string;
  line_start: number;
  line_end: number;
  occurrence_order: number;
  match_text: string;
  source: "title" | "body";
  score: number;
}
```

- [ ] **Step 3: 运行搜索 Hook 测试，确认类型变更尚未破坏行为**

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/hooks/useSearch.test.tsx
```

Expected: PASS 或仅因类型编译失败而阻塞；不应出现运行时逻辑回归。

- [ ] **Step 4: 保持 `useSearch` 只做防抖和竞态保护，不在 Hook 里加排序**

`src/hooks/useSearch.ts` 只保留现有调用方式：

```ts
const res = await api.searchNotes(q, currentKb.id);
setResults(res);
```

不要在 Hook 中追加前端二次排序，避免和后端相关度规则分叉。

- [ ] **Step 5: 重跑 Hook 测试**

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/hooks/useSearch.test.tsx
```

Expected: PASS，证明 richer result shape 没有破坏防抖与请求时序保护。

- [ ] **Step 6: Commit 类型与 Hook 切片**

```bash
cd /Users/lijun/mynote
git add src/types/index.ts src/test/testData.ts src/hooks/useSearch.ts src/hooks/useSearch.test.tsx
git commit -m "refactor(search): type hit-level search results"
```

## 4. Task 3: 搜索导航状态与编辑区/预览区定位

**Files:**
- Modify: `src/store/useEditorStore.ts`
- Modify: `src/components/EditorWorkspace/MarkdownEditor.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownEditor.test.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.test.tsx`

- [ ] **Step 1: 在 editor store 中新增搜索导航状态**

将 `src/store/useEditorStore.ts` 的 import 改为：

```ts
import type { Note, SearchNavigationTarget, TagNavigationTarget } from "../types";
```

并补充 state 字段：

```ts
searchNavigationTarget: SearchNavigationTarget | null;
setSearchNavigationTarget: (target: SearchNavigationTarget | null) => void;
```

默认值和 setter：

```ts
searchNavigationTarget: null,
setSearchNavigationTarget: (target) => set({ searchNavigationTarget: target }),
```

- [ ] **Step 2: 先写编辑器失败测试，锁定“搜索导航会滚到命中行”**

在 `src/components/EditorWorkspace/MarkdownEditor.test.tsx` 添加：

```tsx
it("scrolls to the search navigation target line", async () => {
  const onChange = vi.fn();
  const searchNavigationTarget = {
    note_id: "note-1",
    note_path: "notes/demo.md",
    note_title: "Demo",
    line_start: 3,
    line_end: 3,
    occurrence_order: 1,
    match_text: "阶段一",
    context_snippet: "Body 阶段一",
    source: "body" as const,
    revision: 1,
  };

  render(
    <MarkdownEditor
      initialContent={["# Title", "", "Body 阶段一"].join("\n")}
      onChange={onChange}
      searchNavigationTarget={searchNavigationTarget}
    />,
  );

  await waitFor(() => {
    const state = useEditorStore.getState();
    expect(state.isComposing).toBe(false);
  });
});
```

- [ ] **Step 3: 在 `MarkdownEditor.tsx` 中接线搜索导航目标**

把 Props 改成：

```ts
import type { SearchNavigationTarget, TagNavigationTarget } from "../../types";

interface Props {
  initialContent: string;
  onChange: (content: string) => void;
  tagNavigationTarget?: TagNavigationTarget | null;
  searchNavigationTarget?: SearchNavigationTarget | null;
  sourceLineSyncSignal?: SourceLineSyncSignal | null;
  onTopVisibleLineChange?: (line: number) => void;
}
```

在组件里新增一个 effect：

```ts
useEffect(() => {
  const view = viewRef.current;
  if (!view || !searchNavigationTarget) return;

  isProgrammaticScroll.current = true;
  scrollEditorToSourceLine(view, searchNavigationTarget.line_start);
  releaseProgrammaticScrollSoon();
}, [searchNavigationTarget]);
```

本轮先只复用滚动行为，不在 CodeMirror 内额外做搜索 token 内联高亮，避免和标签高亮逻辑互相缠绕。

- [ ] **Step 4: 在 `MarkdownPreview.tsx` 中接线搜索导航目标**

将 Props 增加：

```ts
import type { SearchNavigationTarget, TagNavigationTarget } from "../../types";

interface Props {
  content: string;
  tagNavigationTarget?: TagNavigationTarget | null;
  searchNavigationTarget?: SearchNavigationTarget | null;
  sourceLineSyncSignal?: SourceLineSyncSignal | null;
  onTopVisibleLineChange?: (line: number) => void;
}
```

新增翻译 helper：

```ts
function translateSearchNavigationTarget(
  searchNavigationTarget: SearchNavigationTarget | null | undefined,
  lineOffset: number,
): SearchNavigationTarget | null {
  if (!searchNavigationTarget) return null;

  return {
    ...searchNavigationTarget,
    line_start: Math.max(1, searchNavigationTarget.line_start - lineOffset),
    line_end: Math.max(1, searchNavigationTarget.line_end - lineOffset),
  };
}
```

并新增 effect：

```ts
useEffect(() => {
  if (!searchNavigationTarget || !scrollContainerRef.current || !containerRef.current) return;

  const translatedTarget = translateSearchNavigationTarget(searchNavigationTarget, previewLineOffsetRef.current);
  isProgrammaticScroll.current = true;
  scrollPreviewToSourceLine(scrollContainerRef.current, containerRef.current, translatedTarget?.line_start ?? 1);
  releaseProgrammaticScrollSoon();
}, [searchNavigationTarget]);
```

- [ ] **Step 5: 重跑编辑器和预览窄测试**

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected: PASS，且新增搜索导航 case 通过，不影响现有标签导航和拖拽插入标签测试。

- [ ] **Step 6: Commit 搜索导航状态切片**

```bash
cd /Users/lijun/mynote
git add src/store/useEditorStore.ts src/components/EditorWorkspace/MarkdownEditor.tsx src/components/EditorWorkspace/MarkdownPreview.tsx src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
git commit -m "feat(search): sync editor and preview to search hits"
```

## 5. Task 4: 搜索弹层结果渲染与打开行为

**Files:**
- Modify: `src/components/SearchOverlay.tsx`
- Modify: `src/components/SearchOverlay.test.tsx`

- [ ] **Step 1: 先写弹层失败测试，锁定“点击结果后会设置搜索导航目标”**

在 `src/components/SearchOverlay.test.tsx` 中补充对 store 的断言：

```tsx
import { useEditorStore } from "../store/useEditorStore";

it("opens the selected hit and stores a search navigation target", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  setSearchResults([
    makeSearchResult({
      note_id: "note1",
      title: "First Note",
      path: "notes/first.md",
      line_start: 7,
      line_end: 7,
      occurrence_order: 2,
      match_text: "Alpha",
      snippet: "Before <mark>Alpha</mark> after",
    }),
  ]);

  renderSearchOverlay(onClose);

  await user.keyboard("{Enter}");

  expect(hookMocks.openNote).toHaveBeenCalledWith("notes/first.md", expect.anything());
  expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
    note_path: "notes/first.md",
    line_start: 7,
    occurrence_order: 2,
  });
});
```

- [ ] **Step 2: 在 `SearchOverlay.tsx` 中接线搜索导航目标**

把 `openResult` 改为使用 `beginOpenNote` 和 `setSearchNavigationTarget`：

```tsx
const { openNote, beginOpenNote, isOpenNoteRequestCurrent } = useOpenNote();
const setSearchNavigationTarget = useEditorStore((s) => s.setSearchNavigationTarget);

const openResult = async (result: SearchResult) => {
  const requestId = beginOpenNote();
  await openNote(result.path, requestId);
  if (!isOpenNoteRequestCurrent(requestId)) return;

  setSearchNavigationTarget({
    note_id: result.note_id,
    note_path: result.path,
    note_title: result.title,
    line_start: result.line_start,
    line_end: result.line_end,
    occurrence_order: result.occurrence_order,
    match_text: result.match_text,
    context_snippet: result.snippet,
    source: result.source,
    revision: Date.now(),
  });
  onClose();
};
```

- [ ] **Step 3: 在结果项中展示命中位置信息**

将结果项渲染改为：

```tsx
<div style={styles.resultMeta}>
  {r.source === "title" ? "标题命中" : `第 ${r.line_start} 行`}
</div>
<div style={styles.resultSnippet}>{renderSnippet(r.snippet)}</div>
<div style={styles.resultPath}>{r.path}</div>
```

并新增样式：

```tsx
resultMeta: {
  fontSize: 11,
  color: "#667085",
  marginBottom: 4,
},
```

- [ ] **Step 4: 重跑搜索弹层测试**

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/SearchOverlay.test.tsx
```

Expected: PASS，且键盘回车打开的是命中级结果，不只是笔记路径。

- [ ] **Step 5: Commit 搜索弹层切片**

```bash
cd /Users/lijun/mynote
git add src/components/SearchOverlay.tsx src/components/SearchOverlay.test.tsx
git commit -m "feat(search): navigate from search hits"
```

## 6. Task 5: 总验证

**Files:**
- Modify: none
- Test: `src-tauri/src/commands/search.rs`
- Test: `src/hooks/useSearch.test.tsx`
- Test: `src/components/SearchOverlay.test.tsx`
- Test: `src/components/EditorWorkspace/MarkdownEditor.test.tsx`
- Test: `src/components/EditorWorkspace/MarkdownPreview.test.tsx`

- [ ] **Step 1: 运行前端搜索相关测试**

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/hooks/useSearch.test.tsx src/components/SearchOverlay.test.tsx src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected: PASS。

- [ ] **Step 2: 运行 Rust 搜索测试**

```bash
cd /Users/lijun/mynote/src-tauri
cargo test commands::search::tests
```

Expected: PASS。

- [ ] **Step 3: 运行仓库基线验证**

```bash
cd /Users/lijun/mynote
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm build
cd src-tauri
cargo test
```

Expected: frontend build exits 0 and Rust test suite exits 0.

- [ ] **Step 4: Commit 最终验证通过的整体验证点**

```bash
cd /Users/lijun/mynote
git status --short
```

Expected: only the intended search-navigation files are modified and already captured by the previous commits.

## 7. 计划自检

- Spec coverage: 已覆盖全文搜索、相关度排序、多命中逐条展示、点击后打开并同步 editor/preview 定位、front matter 行号翻译、测试要求。
- Placeholder scan: 无 `TODO`、`TBD`、笼统“补错误处理”一类占位语句；每个任务包含具体文件、测试和命令。
- Type consistency: `SearchResult`、`SearchNavigationTarget`、`searchNavigationTarget` 在计划中保持同名；搜索导航与标签导航分开建模，避免字段语义混淆。
