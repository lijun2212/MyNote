# Search Session Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add search history, hit highlighting, result-set next/previous navigation, and a bottom search session bar so global search becomes a continuous reading workflow instead of a one-shot jump.

**Architecture:** Keep the existing hit-level backend results unchanged and add a frontend search session layer that stores the active query, full result set, current hit index, and local history. SearchOverlay will create and resume sessions, EditorWorkspace will render the bottom session bar and drive next/previous navigation, and MarkdownEditor/MarkdownPreview will render explicit current-hit highlights derived from the active `searchNavigationTarget`.

**Tech Stack:** React 19, TypeScript, Zustand, CodeMirror 6, MarkdownIt, Vitest, React Testing Library.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-03 | v1.0 | 根据已确认的搜索会话增强设计创建 implementation plan。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. Task 1: 搜索会话与历史状态层](#2-task-1-搜索会话与历史状态层)
- [3. Task 2: 搜索弹层历史与会话接线](#3-task-2-搜索弹层历史与会话接线)
- [4. Task 3: 工作区底部状态条与上下一个导航](#4-task-3-工作区底部状态条与上下一个导航)
- [5. Task 4: 编辑区与预览区当前命中高亮](#5-task-4-编辑区与预览区当前命中高亮)
- [6. Task 5: 快捷键边界与总验证](#6-task-5-快捷键边界与总验证)
- [7. 计划自检](#7-计划自检)

## 1. 文件结构

### 新增文件

- Create: `src/store/useSearchSessionStore.ts` - 搜索会话、最近搜索词、最近打开命中的统一前端状态层。
- Create: `src/store/useSearchSessionStore.test.ts` - 搜索会话与历史规则窄测。
- Create: `src/components/EditorWorkspace/SearchSessionBar.tsx` - 底部紧凑搜索会话状态条。
- Create: `src/components/EditorWorkspace/SearchSessionBar.test.tsx` - 状态条按钮、展示和退出行为测试。

### 修改文件

- Modify: `src/types/index.ts` - 新增搜索会话与历史项类型。
- Modify: `src/test/testData.ts` - 为搜索会话和历史测试提供夹具。
- Modify: `src/components/SearchOverlay.tsx` - 空态展示历史，打开结果时创建搜索会话。
- Modify: `src/components/SearchOverlay.test.tsx` - 覆盖历史展示、历史点击、会话写入。
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx` - 渲染状态条并承接搜索会话导航。
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx` - 覆盖状态条显隐和最新搜索导航仲裁。
- Modify: `src/components/EditorWorkspace/MarkdownEditor.tsx` - 增加当前搜索命中显式高亮。
- Modify: `src/components/EditorWorkspace/MarkdownEditor.test.tsx` - 覆盖搜索命中高亮与键盘边界。
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx` - 增加预览区当前搜索命中高亮。
- Modify: `src/components/EditorWorkspace/MarkdownPreview.test.tsx` - 覆盖预览区高亮与 front matter 偏移。

## 2. Task 1: 搜索会话与历史状态层

**Files:**
- Create: `src/store/useSearchSessionStore.ts`
- Create: `src/store/useSearchSessionStore.test.ts`
- Modify: `src/types/index.ts`
- Modify: `src/test/testData.ts`

- [ ] **Step 1: 先写状态层失败测试，锁定历史去重和会话创建规则**

在 `src/store/useSearchSessionStore.test.ts` 中添加：

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { makeSearchResult } from "../test/testData";
import { useSearchSessionStore } from "./useSearchSessionStore";

describe("useSearchSessionStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useSearchSessionStore.getState().resetForTest();
  });

  it("deduplicates recent queries and moves the newest one to the front", () => {
    const store = useSearchSessionStore.getState();
    store.recordQuery("nacos");
    store.recordQuery("agent");
    store.recordQuery("nacos");

    expect(useSearchSessionStore.getState().recentQueries).toEqual(["nacos", "agent"]);
  });

  it("creates a search session with results and current index", () => {
    const results = [
      makeSearchResult({ note_id: "n1", path: "notes/a.md" }),
      makeSearchResult({ note_id: "n2", path: "notes/b.md" }),
    ];

    useSearchSessionStore.getState().startSession({
      query: "nacos",
      results,
      currentIndex: 1,
    });

    expect(useSearchSessionStore.getState().session).toMatchObject({
      query: "nacos",
      currentIndex: 1,
      active: true,
    });
    expect(useSearchSessionStore.getState().session?.results).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行状态层窄测，确认先失败**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/store/useSearchSessionStore.test.ts
```

Expected: FAIL，因为 `useSearchSessionStore.ts` 尚不存在，类型和重置入口也还未定义。

- [ ] **Step 3: 定义搜索会话与历史类型**

在 `src/types/index.ts` 中补充：

```ts
export interface SearchHistoryHitItem {
  query: string;
  note_id: string;
  note_title: string;
  note_path: string;
  line_start: number;
  line_end: number;
  occurrence_order: number;
  snippet: string;
  source: SearchMatchSource;
}

export interface SearchSession {
  query: string;
  results: SearchResult[];
  currentIndex: number;
  active: boolean;
}
```

并在 `src/test/testData.ts` 中新增默认夹具：

```ts
export function makeSearchHistoryHit(
  overrides: Partial<SearchHistoryHitItem> = {},
): SearchHistoryHitItem {
  return {
    query: "nacos",
    note_id: "note-1",
    note_title: "Search Hit",
    note_path: "notes/search-hit.md",
    line_start: 3,
    line_end: 3,
    occurrence_order: 1,
    snippet: "A <mark>nacos</mark> result",
    source: "body",
    ...overrides,
  };
}
```

- [ ] **Step 4: 写最小的搜索会话 store 实现**

创建 `src/store/useSearchSessionStore.ts`：

```ts
import { create } from "zustand";
import type { SearchHistoryHitItem, SearchResult, SearchSession } from "../types";

const MAX_RECENT_QUERIES = 8;
const MAX_RECENT_HITS = 8;
const STORAGE_KEY = "mynote-search-session-history";

type PersistedState = {
  recentQueries: string[];
  recentHits: SearchHistoryHitItem[];
};

interface SearchSessionState {
  recentQueries: string[];
  recentHits: SearchHistoryHitItem[];
  session: SearchSession | null;
  recordQuery: (query: string) => void;
  recordOpenedHit: (query: string, result: SearchResult) => void;
  startSession: (input: { query: string; results: SearchResult[]; currentIndex: number }) => void;
  setCurrentIndex: (index: number) => void;
  clearSession: () => void;
  resetForTest: () => void;
}

function loadPersistedState(): PersistedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { recentQueries: [], recentHits: [] };
    const parsed = JSON.parse(raw) as PersistedState;
    return {
      recentQueries: Array.isArray(parsed.recentQueries) ? parsed.recentQueries : [],
      recentHits: Array.isArray(parsed.recentHits) ? parsed.recentHits : [],
    };
  } catch {
    return { recentQueries: [], recentHits: [] };
  }
}

function persistHistory(recentQueries: string[], recentHits: SearchHistoryHitItem[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ recentQueries, recentHits }));
}

export const useSearchSessionStore = create<SearchSessionState>((set, get) => {
  const initial = loadPersistedState();

  return {
    recentQueries: initial.recentQueries,
    recentHits: initial.recentHits,
    session: null,
    recordQuery: (query) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      const recentQueries = [trimmed, ...get().recentQueries.filter((item) => item !== trimmed)]
        .slice(0, MAX_RECENT_QUERIES);
      persistHistory(recentQueries, get().recentHits);
      set({ recentQueries });
    },
    recordOpenedHit: (query, result) => {
      const item: SearchHistoryHitItem = {
        query,
        note_id: result.note_id,
        note_title: result.title,
        note_path: result.path,
        line_start: result.line_start,
        line_end: result.line_end,
        occurrence_order: result.occurrence_order,
        snippet: result.snippet,
        source: result.source,
      };
      const recentHits = [
        item,
        ...get().recentHits.filter((existing) => !(
          existing.query === item.query
          && existing.note_id === item.note_id
          && existing.line_start === item.line_start
          && existing.occurrence_order === item.occurrence_order
        )),
      ].slice(0, MAX_RECENT_HITS);
      persistHistory(get().recentQueries, recentHits);
      set({ recentHits });
    },
    startSession: ({ query, results, currentIndex }) => set({
      session: { query, results, currentIndex, active: true },
    }),
    setCurrentIndex: (currentIndex) => set((state) => state.session ? {
      session: { ...state.session, currentIndex },
    } : state),
    clearSession: () => set({ session: null }),
    resetForTest: () => {
      window.localStorage.removeItem(STORAGE_KEY);
      set({ recentQueries: [], recentHits: [], session: null });
    },
  };
});
```

- [ ] **Step 5: 运行状态层测试，确认通过**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/store/useSearchSessionStore.test.ts
```

Expected: PASS with 2 tests.

## 3. Task 2: 搜索弹层历史与会话接线

**Files:**
- Modify: `src/components/SearchOverlay.tsx`
- Modify: `src/components/SearchOverlay.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定空态历史展示与打开结果创建会话**

在 `src/components/SearchOverlay.test.tsx` 中新增：

```ts
import { useSearchSessionStore } from "../store/useSearchSessionStore";
import { makeSearchHistoryHit } from "../test/testData";

it("shows recent queries and recent hits when the query is empty", () => {
  useSearchSessionStore.setState({
    recentQueries: ["nacos", "agent"],
    recentHits: [makeSearchHistoryHit({ note_title: "Hit Note" })],
    session: null,
  });

  renderSearchOverlay();

  expect(screen.getByText("最近搜索")).toBeInTheDocument();
  expect(screen.getByText("nacos")).toBeInTheDocument();
  expect(screen.getByText("最近查看命中")).toBeInTheDocument();
  expect(screen.getByText("Hit Note")).toBeInTheDocument();
});

it("records query, opened hit, and session when a result is opened", async () => {
  const user = userEvent.setup();
  setSearchResults([
    makeSearchResult({ note_id: "note1", title: "First Note", path: "notes/first.md" }),
    makeSearchResult({ note_id: "note2", title: "Second Note", path: "notes/second.md" }),
  ]);

  renderSearchOverlay();
  await user.type(screen.getByPlaceholderText("输入关键词搜索笔记"), "nacos");
  await user.click(screen.getByText("Second Note"));

  const session = useSearchSessionStore.getState().session;
  expect(session).toMatchObject({ query: "nacos", currentIndex: 1, active: true });
  expect(session?.results).toHaveLength(2);
  expect(useSearchSessionStore.getState().recentQueries[0]).toBe("nacos");
  expect(useSearchSessionStore.getState().recentHits[0].note_title).toBe("Second Note");
});
```

- [ ] **Step 2: 运行 SearchOverlay 窄测，确认先失败**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/SearchOverlay.test.tsx
```

Expected: FAIL，因为 `SearchOverlay` 还没有读写搜索会话 store，也没有空态历史区域。

- [ ] **Step 3: 在 SearchOverlay 接入历史与会话**

将 `src/components/SearchOverlay.tsx` 调整为：

```tsx
const { results, isLoading } = useSearch(query);
const recentQueries = useSearchSessionStore((s) => s.recentQueries);
const recentHits = useSearchSessionStore((s) => s.recentHits);
const recordQuery = useSearchSessionStore((s) => s.recordQuery);
const recordOpenedHit = useSearchSessionStore((s) => s.recordOpenedHit);
const startSession = useSearchSessionStore((s) => s.startSession);

useEffect(() => {
  if (query.trim()) {
    recordQuery(query);
  }
}, [query, recordQuery]);

const openResult = async (result: SearchResult, index: number) => {
  const requestId = beginOpenNote();
  await openNote(result.path, requestId);
  if (!isOpenNoteRequestCurrent(requestId)) return;

  setSearchNavigationTarget({ ... });
  recordOpenedHit(query.trim(), result);
  startSession({ query: query.trim(), results, currentIndex: index });
  onClose();
};
```

空态 UI 增加两个 section：

```tsx
{!query.trim() && (
  <>
    <div style={styles.historySection}>
      <div style={styles.historyHeader}>最近搜索</div>
      {recentQueries.map((item) => (
        <button key={item} style={styles.historyItem} onClick={() => setQuery(item)}>{item}</button>
      ))}
    </div>
    <div style={styles.historySection}>
      <div style={styles.historyHeader}>最近查看命中</div>
      {recentHits.map((item) => (
        <button
          key={`${item.query}:${item.note_id}:${item.line_start}:${item.occurrence_order}`}
          style={styles.historyItem}
          onClick={() => setQuery(item.query)}
        >
          <strong>{item.note_title}</strong>
          <span>{item.query}</span>
        </button>
      ))}
    </div>
  </>
)}
```

并把结果项的 `onClick` 和 Enter 路径都改为传 index：

```tsx
onClick={() => openResult(r, i)}
```

- [ ] **Step 4: 运行 SearchOverlay 窄测，确认通过**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/SearchOverlay.test.tsx
```

Expected: PASS with the new history and session assertions plus existing open-result behavior.

## 4. Task 3: 工作区底部状态条与上下一个导航

**Files:**
- Create: `src/components/EditorWorkspace/SearchSessionBar.tsx`
- Create: `src/components/EditorWorkspace/SearchSessionBar.test.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
- Modify: `src/hooks/useOpenNote.ts`

- [ ] **Step 1: 先写状态条失败测试，锁定展示和按钮回调**

创建 `src/components/EditorWorkspace/SearchSessionBar.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchSessionBar } from "./SearchSessionBar";

describe("SearchSessionBar", () => {
  it("renders query, count, and navigation actions", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onClose = vi.fn();

    render(
      <SearchSessionBar
        query="nacos"
        currentIndex={1}
        total={17}
        onPrevious={onPrev}
        onNext={onNext}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("nacos")).toBeInTheDocument();
    expect(screen.getByText("2 / 17")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "上一个命中" }));
    await user.click(screen.getByRole("button", { name: "下一个命中" }));
    await user.click(screen.getByRole("button", { name: "退出搜索会话" }));

    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 再写 EditorWorkspace 失败测试，锁定跨结果集导航**

在 `src/components/EditorWorkspace/EditorWorkspace.test.tsx` 中新增：

```tsx
it("opens the next search result across notes when the session advances", async () => {
  const nextResult = makeSearchResult({
    note_id: "note-2",
    title: "Second Note",
    path: "notes/second.md",
    line_start: 12,
    line_end: 12,
  });

  useSearchSessionStore.setState({
    recentQueries: [],
    recentHits: [],
    session: {
      query: "nacos",
      results: [makeSearchResult({ note_id: "note-1", path: "notes/first.md" }), nextResult],
      currentIndex: 0,
      active: true,
    },
  });

  render(<EditorWorkspace />);

  await userEvent.click(screen.getByRole("button", { name: "下一个命中" }));

  expect(hookMocks.openNote).toHaveBeenCalledWith("notes/second.md", expect.any(Number));
  expect(useSearchSessionStore.getState().session?.currentIndex).toBe(1);
});
```

- [ ] **Step 3: 运行状态条和工作区窄测，确认先失败**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/SearchSessionBar.test.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx
```

Expected: FAIL because `SearchSessionBar` does not exist and `EditorWorkspace` does not yet read session state.

- [ ] **Step 4: 写最小状态条组件**

创建 `src/components/EditorWorkspace/SearchSessionBar.tsx`：

```tsx
interface Props {
  query: string;
  currentIndex: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function SearchSessionBar({ query, currentIndex, total, onPrevious, onNext, onClose }: Props) {
  return (
    <div data-testid="search-session-bar" style={styles.bar}>
      <span style={styles.query}>{query}</span>
      <span style={styles.counter}>{currentIndex + 1} / {total}</span>
      <button aria-label="上一个命中" onClick={onPrevious}>上一个</button>
      <button aria-label="下一个命中" onClick={onNext}>下一个</button>
      <button aria-label="退出搜索会话" onClick={onClose}>退出</button>
      <span style={styles.hint}>N / B / Esc</span>
    </div>
  );
}
```

- [ ] **Step 5: 在 EditorWorkspace 接入搜索会话导航**

在 `src/components/EditorWorkspace/EditorWorkspace.tsx` 中：

```tsx
const session = useSearchSessionStore((s) => s.session);
const setCurrentIndex = useSearchSessionStore((s) => s.setCurrentIndex);
const clearSession = useSearchSessionStore((s) => s.clearSession);
const { openNote, beginOpenNote, isOpenNoteRequestCurrent } = useOpenNote();
const setSearchNavigationTarget = useEditorStore((s) => s.setSearchNavigationTarget);

const openSessionResult = async (nextIndex: number) => {
  if (!session) return;
  const result = session.results[nextIndex];
  if (!result) return;

  const requestId = beginOpenNote();
  await openNote(result.path, requestId);
  if (!isOpenNoteRequestCurrent(requestId)) return;

  setCurrentIndex(nextIndex);
  setSearchNavigationTarget({
    note_id: result.note_id,
    note_path: result.path,
    note_title: result.title,
    line_start: result.line_start,
    line_end: result.line_end,
    occurrence_order: result.occurrence_order,
    match_text: result.match_text,
    source: result.source,
    context_snippet: result.snippet,
    revision: Date.now(),
  });
};

const handleNextSearchResult = () => {
  if (!session) return;
  const nextIndex = Math.min(session.results.length - 1, session.currentIndex + 1);
  void openSessionResult(nextIndex);
};

const handlePreviousSearchResult = () => {
  if (!session) return;
  const previousIndex = Math.max(0, session.currentIndex - 1);
  void openSessionResult(previousIndex);
};
```

在布局底部渲染：

```tsx
{session?.active && (
  <SearchSessionBar
    query={session.query}
    currentIndex={session.currentIndex}
    total={session.results.length}
    onPrevious={handlePreviousSearchResult}
    onNext={handleNextSearchResult}
    onClose={() => {
      clearSession();
      setSearchNavigationTarget(null);
    }}
  />
)}
```

- [ ] **Step 6: 运行状态条和工作区测试，确认通过**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/SearchSessionBar.test.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx
```

Expected: PASS with the bar rendering and next-result navigation assertions.

## 5. Task 4: 编辑区与预览区当前命中高亮

**Files:**
- Modify: `src/components/EditorWorkspace/MarkdownEditor.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownEditor.test.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.test.tsx`

- [ ] **Step 1: 先写编辑区失败测试，锁定当前命中高亮**

在 `src/components/EditorWorkspace/MarkdownEditor.test.tsx` 中新增：

```tsx
it("highlights the current search match text in the editor", () => {
  render(
    <MarkdownEditor
      initialContent={"first line\ncontains nacos token\nthird line"}
      onChange={vi.fn()}
      searchNavigationTarget={{
        note_id: "note-1",
        note_path: "notes/a.md",
        note_title: "A",
        line_start: 2,
        line_end: 2,
        occurrence_order: 1,
        match_text: "nacos",
        source: "body",
        context_snippet: "contains <mark>nacos</mark> token",
        revision: 1,
      }}
    />,
  );

  expect(document.querySelector(".cm-search-navigation-target")).toBeInTheDocument();
});
```

- [ ] **Step 2: 再写预览区失败测试，锁定当前命中高亮**

在 `src/components/EditorWorkspace/MarkdownPreview.test.tsx` 中新增：

```tsx
it("highlights the current search match in preview", () => {
  const { container } = render(
    <MarkdownPreview
      content={["# Title", "", "contains nacos token"].join("\n")}
      searchNavigationTarget={{
        note_id: "note-1",
        note_path: "notes/a.md",
        note_title: "A",
        line_start: 3,
        line_end: 3,
        occurrence_order: 1,
        match_text: "nacos",
        source: "body",
        context_snippet: "contains <mark>nacos</mark> token",
        revision: 1,
      }}
    />,
  );

  expect(container.querySelector(".search-navigation-target")).toBeInTheDocument();
});
```

- [ ] **Step 3: 运行 editor/preview 窄测，确认先失败**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected: FAIL because current search navigation only scrolls and does not render explicit highlight classes.

- [ ] **Step 4: 给 MarkdownEditor 增加搜索命中 decoration**

在 `src/components/EditorWorkspace/MarkdownEditor.tsx` 中新增状态 effect / field：

```ts
const searchNavigationDecoration = Decoration.mark({ class: "cm-search-navigation-target" });
const setSearchNavigationTargetEffect = StateEffect.define<SearchNavigationTarget | null>();
const searchNavigationTargetField = StateField.define<SearchNavigationTarget | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchNavigationTargetEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});
```

并在现有 decoration plugin 中额外扫描目标行文本：

```ts
const searchNavigationTarget = view.state.field(searchNavigationTargetField, false);
if (searchNavigationTarget && lineNumber === searchNavigationTarget.line_start) {
  const matchIndex = line.text.indexOf(searchNavigationTarget.match_text);
  if (matchIndex >= 0) {
    builder.add(
      line.from + matchIndex,
      line.from + matchIndex + searchNavigationTarget.match_text.length,
      searchNavigationDecoration,
    );
  }
}
```

当 `searchNavigationTarget` prop 更新时，dispatch 新 effect。

- [ ] **Step 5: 给 MarkdownPreview 增加当前命中 DOM 高亮**

在 `src/components/EditorWorkspace/MarkdownPreview.tsx` 中新增增强函数：

```ts
function enhanceSearchHighlight(container: HTMLElement, target: SearchNavigationTarget | null) {
  container.querySelectorAll(".search-navigation-target").forEach((node) => {
    node.classList.remove("search-navigation-target");
  });
  if (!target) return;

  const selector = `[data-source-line="${target.line_start}"]`;
  const node = container.querySelector(selector) as HTMLElement | null;
  if (!node) return;

  if (target.match_text && node.textContent?.includes(target.match_text)) {
    node.innerHTML = node.innerHTML.replace(target.match_text, `<mark class="search-navigation-target">${target.match_text}</mark>`);
    return;
  }

  node.classList.add("search-navigation-target");
}
```

在内容渲染 effect 中，在 `enhanceInlineTags` 之后调用：

```ts
enhanceSearchHighlight(containerRef.current, translateSearchNavigationTarget(searchNavigationTarget, previewBody.lineOffset));
```

- [ ] **Step 6: 运行 editor/preview 测试，确认通过**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected: PASS with the new explicit highlight assertions plus existing scroll behavior.

## 6. Task 5: 快捷键边界与总验证

**Files:**
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownEditor.test.tsx`

- [ ] **Step 1: 先写失败测试，锁定搜索会话快捷键边界**

在 `src/components/EditorWorkspace/EditorWorkspace.test.tsx` 中新增：

```tsx
it("handles N, B, and Escape while the search session is active", async () => {
  useSearchSessionStore.setState({
    recentQueries: [],
    recentHits: [],
    session: {
      query: "nacos",
      results: [
        makeSearchResult({ note_id: "note-1", path: "notes/first.md" }),
        makeSearchResult({ note_id: "note-2", path: "notes/second.md" }),
      ],
      currentIndex: 0,
      active: true,
    },
  });

  render(<EditorWorkspace />);

  fireEvent.keyDown(window, { key: "n" });
  expect(useSearchSessionStore.getState().session?.currentIndex).toBe(1);

  fireEvent.keyDown(window, { key: "b" });
  expect(useSearchSessionStore.getState().session?.currentIndex).toBe(0);

  fireEvent.keyDown(window, { key: "Escape" });
  expect(useSearchSessionStore.getState().session).toBeNull();
});
```

并在 `src/components/EditorWorkspace/MarkdownEditor.test.tsx` 中新增：

```tsx
it("does not hijack plain text input for N and B while editing", async () => {
  const user = userEvent.setup();
  render(<MarkdownEditor initialContent="" onChange={vi.fn()} />);

  const editor = document.querySelector(".cm-content") as HTMLElement;
  editor.focus();
  await user.keyboard("nb");

  expect(editor.textContent?.toLowerCase()).toContain("nb");
});
```

- [ ] **Step 2: 运行快捷键相关窄测，确认先失败**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx src/components/EditorWorkspace/MarkdownEditor.test.tsx
```

Expected: FAIL because global session shortcuts are not implemented.

- [ ] **Step 3: 在 EditorWorkspace 增加搜索会话快捷键监听**

在 `src/components/EditorWorkspace/EditorWorkspace.tsx` 中添加：

```tsx
useEffect(() => {
  if (!session?.active) return;

  const handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const isEditable = Boolean(
      target?.closest("input, textarea, [contenteditable='true']")
      || target?.closest(".cm-content")
    );

    if (event.key === "Escape") {
      event.preventDefault();
      clearSession();
      setSearchNavigationTarget(null);
      return;
    }

    if (isEditable) return;

    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      handleNextSearchResult();
    }

    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      handlePreviousSearchResult();
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [session, handleNextSearchResult, handlePreviousSearchResult, clearSession, setSearchNavigationTarget]);
```

- [ ] **Step 4: 运行快捷键窄测，确认通过**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx src/components/EditorWorkspace/MarkdownEditor.test.tsx
```

Expected: PASS with session shortcut handling and plain typing preserved.

- [ ] **Step 5: 运行前端总验证**

Run:

```bash
cd /Users/lijun/mynote
PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run \
  src/store/useSearchSessionStore.test.ts \
  src/components/SearchOverlay.test.tsx \
  src/components/EditorWorkspace/SearchSessionBar.test.tsx \
  src/components/EditorWorkspace/EditorWorkspace.test.tsx \
  src/components/EditorWorkspace/MarkdownEditor.test.tsx \
  src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected: PASS for all touched slices.

- [ ] **Step 6: 运行构建验证**

Run:

```bash
cd /Users/lijun/mynote
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm build
```

Expected: successful TypeScript compile and Vite build.

## 7. 计划自检

- Spec coverage: 已覆盖最近搜索词、最近打开命中、底部状态条、editor/preview 高亮、全局结果集前后切换、`N` / `B` / `Esc` 快捷键边界。
- Placeholder scan: 无 `TODO`、`TBD` 或“后续补充”式空步骤。
- Type consistency: 计划统一使用 `SearchSession`、`SearchHistoryHitItem`、`searchNavigationTarget`、`useSearchSessionStore` 命名，没有前后漂移。