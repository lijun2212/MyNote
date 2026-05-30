# Frontend Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sustainable frontend test baseline for MyNote with Vitest component/hook tests and Playwright browser smoke tests.

**Architecture:** Keep production frontend behavior unchanged and add a test layer around existing hooks/components. Vitest runs in jsdom with centralized Tauri API mocks and Zustand reset helpers; Playwright starts the existing Vite dev server and checks the initial browser screen without depending on a real Tauri desktop shell.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, React Testing Library, jsdom, Zustand, Playwright, pnpm, existing Rust `cargo test` verification.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义前端测试框架和首轮交互测试实施计划。 |

## 目录

- [1. Scope](#1-scope)
- [2. File Structure](#2-file-structure)
- [3. Execution Setup](#3-execution-setup)
- [4. Tasks](#4-tasks)
- [5. Final Verification](#5-final-verification)
- [6. Self-Review](#6-self-review)

## 1. Scope

Implement the approved design in [Frontend Testing Design](../specs/2026-05-30-frontend-testing-design.md).

In scope:

- Add Vitest, React Testing Library, jsdom, user-event, jest-dom, and Playwright as dev dependencies.
- Add stable scripts: `test`, `test:run`, `test:e2e`.
- Add Vitest config and centralized frontend test helpers.
- Add hook tests for `useSearch` and `useAutoSave`.
- Add component tests for `MarkdownPreview` and `SearchOverlay`.
- Add Playwright Chromium smoke test for the WelcomeScreen.
- Update baseline after verification.

Out of scope:

- Real Tauri desktop E2E.
- Visual regression or screenshot diff tests.
- Coverage thresholds.
- CodeMirror editing integration tests.
- UI restyling or component architecture refactors.

## 2. File Structure

- Modify: `package.json` - add frontend test scripts and dev dependencies through `pnpm add -D`.
- Modify: `pnpm-lock.yaml` - updated by pnpm after dependency installation.
- Create: `vitest.config.ts` - Vitest config for jsdom and React.
- Create: `playwright.config.ts` - Playwright config that starts Vite on port 1420.
- Create: `src/test/setup.ts` - global test setup, jest-dom import, Tauri plugin mocks, cleanup, timer reset, store reset.
- Create: `src/test/testData.ts` - typed factories and deferred promise helper.
- Create: `src/hooks/useSearch.test.tsx` - debounce, empty query, stale response, and knowledge base guard tests.
- Create: `src/hooks/useAutoSave.test.tsx` - autosave delay, success, conflict, and stale note-save tests.
- Create: `src/components/EditorWorkspace/MarkdownPreview.test.tsx` - Front Matter, sanitize, external URL, and wiki-link tests.
- Create: `src/components/SearchOverlay.test.tsx` - focus, keyboard selection, open/close, and safe snippet rendering tests.
- Create: `tests/e2e/welcome.spec.ts` - browser smoke test for initial app render.
- Modify: `docs/superpowers/baseline-2026-05-30.md` - mark the P3 frontend testing risk as completed after all verification passes.

## 3. Execution Setup

Run implementation in an isolated worktree from `main`:

```bash
cd /Users/lijun/mynote
git worktree add .worktrees/frontend-testing -b feature/frontend-testing main
cd .worktrees/frontend-testing
```

Expected result:

- New branch: `feature/frontend-testing`
- Worktree path: `/Users/lijun/mynote/.worktrees/frontend-testing`
- Starting commit includes `docs: add frontend testing design` and this plan.

## 4. Tasks

### Task 1: Add Test Tooling And Shared Helpers

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/testData.ts`

- [ ] **Step 1: Install dev dependencies**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm add -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
```

Expected result: `package.json` gains the test packages in `devDependencies`, `pnpm-lock.yaml` is updated, and the command exits 0.

- [ ] **Step 2: Add test scripts to `package.json`**

Replace the `scripts` object with:

```json
{
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "test": "vitest",
  "test:run": "vitest run",
  "test:e2e": "playwright test"
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: true,
  },
});
```

- [ ] **Step 4: Create `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";

export const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  openDialog: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: tauriMocks.openDialog }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauriMocks.openUrl }));

export function resetTauriMocks() {
  tauriMocks.invoke.mockReset();
  tauriMocks.openDialog.mockReset();
  tauriMocks.openUrl.mockReset();
}

export function resetStores() {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useEditorStore.setState(useEditorStore.getInitialState(), true);
}

afterEach(() => {
  cleanup();
  resetTauriMocks();
  resetStores();
  vi.useRealTimers();
});
```

- [ ] **Step 5: Create `src/test/testData.ts`**

```ts
import type { KnowledgeBase, Note, NoteDetail, SaveNoteResult, SearchResult } from "../types";

export function makeKnowledgeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "kb1",
    name: "Test KB",
    root_path: "/tmp/test-kb",
    created_at: "2026-05-30T00:00:00Z",
    updated_at: "2026-05-30T00:00:00Z",
    ...overrides,
  };
}

export function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note1",
    path: "notes/note1.md",
    title: "Note 1",
    summary: null,
    content_hash: "hash1",
    word_count: 2,
    created_at: "2026-05-30T00:00:00Z",
    updated_at: "2026-05-30T00:00:00Z",
    indexed_at: "2026-05-30T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

export function makeNoteDetail(overrides: Partial<NoteDetail> = {}): NoteDetail {
  const note = overrides.note ?? makeNote();
  return { note, content: "# Note 1\n\nBody", ...overrides };
}

export function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    note_id: "note1",
    title: "Note 1",
    path: "notes/note1.md",
    snippet: "A <mark>note</mark> result",
    ...overrides,
  };
}

export function makeSaveNoteResult(overrides: Partial<SaveNoteResult> = {}): SaveNoteResult {
  return { note: makeNote({ content_hash: "hash2" }), conflict: false, ...overrides };
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
```

- [ ] **Step 6: Run test infrastructure check**

Run:

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run -- --passWithNoTests
```

Expected result: Vitest starts with jsdom and exits 0 before test files exist.

- [ ] **Step 7: Commit test tooling**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
git add package.json pnpm-lock.yaml vitest.config.ts src/test/setup.ts src/test/testData.ts
git commit -m "test(frontend): add vitest setup"
```

### Task 2: Add `useSearch` Tests

**Files:**
- Create: `src/hooks/useSearch.test.tsx`

- [ ] **Step 1: Create `src/hooks/useSearch.test.tsx`**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSearch } from "./useSearch";
import { useAppStore } from "../store/useAppStore";
import { tauriMocks } from "../test/setup";
import { deferred, makeKnowledgeBase, makeSearchResult } from "../test/testData";

describe("useSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns empty results without calling the API for an empty query", () => {
    useAppStore.getState().setKb(makeKnowledgeBase());
    const { result } = renderHook(() => useSearch("   "));
    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it("debounces non-empty searches before invoking the API", async () => {
    useAppStore.getState().setKb(makeKnowledgeBase({ id: "kb1" }));
    tauriMocks.invoke.mockResolvedValueOnce([makeSearchResult({ note_id: "n1", title: "Alpha", path: "alpha.md" })]);
    const { result, rerender } = renderHook(({ query }) => useSearch(query), { initialProps: { query: "" } });

    rerender({ query: "alpha" });
    expect(result.current.isLoading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(tauriMocks.invoke).toHaveBeenCalledWith("search_notes", { query: "alpha", kbId: "kb1" });
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.isLoading).toBe(false);
  });

  it("ignores an old search result that resolves after a newer query starts", async () => {
    useAppStore.getState().setKb(makeKnowledgeBase({ id: "kb1" }));
    const oldSearch = deferred<ReturnType<typeof makeSearchResult>[]>();
    const newSearch = deferred<ReturnType<typeof makeSearchResult>[]>();
    tauriMocks.invoke.mockReturnValueOnce(oldSearch.promise).mockReturnValueOnce(newSearch.promise);
    const { result, rerender } = renderHook(({ query }) => useSearch(query), { initialProps: { query: "alpha" } });

    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    rerender({ query: "beta" });
    await act(async () => {
      oldSearch.resolve([makeSearchResult({ note_id: "old", title: "Old", path: "old.md" })]);
      await Promise.resolve();
    });
    expect(result.current.results).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      newSearch.resolve([makeSearchResult({ note_id: "new", title: "New", path: "new.md" })]);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.results[0]?.note_id).toBe("new"));
  });

  it("ignores a pending result after the knowledge base changes", async () => {
    useAppStore.getState().setKb(makeKnowledgeBase({ id: "kb1" }));
    const search = deferred<ReturnType<typeof makeSearchResult>[]>();
    tauriMocks.invoke.mockReturnValueOnce(search.promise);
    const { result } = renderHook(() => useSearch("alpha"));

    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    act(() => { useAppStore.getState().setKb(makeKnowledgeBase({ id: "kb2" })); });
    await act(async () => {
      search.resolve([makeSearchResult({ note_id: "stale", title: "Stale", path: "stale.md" })]);
      await Promise.resolve();
    });

    expect(result.current.results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it passes**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/hooks/useSearch.test.tsx
```

Expected result: 4 tests pass.

- [ ] **Step 3: Commit `useSearch` tests**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
git add src/hooks/useSearch.test.tsx
git commit -m "test(frontend): cover search hook behavior"
```

### Task 3: Add `useAutoSave` Tests

**Files:**
- Create: `src/hooks/useAutoSave.test.tsx`

- [ ] **Step 1: Create `src/hooks/useAutoSave.test.tsx`**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSave } from "./useAutoSave";
import { useEditorStore } from "../store/useEditorStore";
import { tauriMocks } from "../test/setup";
import { deferred, makeNote, makeSaveNoteResult } from "../test/testData";

function makeDirtyEditorState(content = "updated content") {
  const note = makeNote({ id: "note1", content_hash: "hash1" });
  useEditorStore.getState().setCurrentNote(note);
  useEditorStore.getState().setContent(content);
  useEditorStore.getState().markDirty();
  return note;
}

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("saves a dirty note after the debounce delay", async () => {
    makeDirtyEditorState("updated content");
    tauriMocks.invoke.mockResolvedValueOnce(makeSaveNoteResult({ note: makeNote({ id: "note1", content_hash: "hash2" }) }));
    renderHook(() => useAutoSave());

    await act(async () => { await vi.advanceTimersByTimeAsync(799); });
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(tauriMocks.invoke).toHaveBeenCalledWith("save_note", {
      noteId: "note1",
      content: "updated content",
      expectedHash: "hash1",
    });
    await waitFor(() => expect(useEditorStore.getState().saveStatus).toBe("saved"));
    expect(useEditorStore.getState().currentNote?.content_hash).toBe("hash2");
  });

  it("sets a conflict error instead of marking the note saved", async () => {
    makeDirtyEditorState("conflicting content");
    tauriMocks.invoke.mockResolvedValueOnce(makeSaveNoteResult({
      note: makeNote({ id: "note1", content_hash: "conflict-hash" }),
      conflict: true,
    }));
    renderHook(() => useAutoSave());

    await act(async () => { await vi.advanceTimersByTimeAsync(800); });

    await waitFor(() => expect(useEditorStore.getState().saveStatus).toBe("error"));
    expect(useEditorStore.getState().saveError).toBe("检测到外部修改，已将当前内容保存为冲突副本");
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it("does not apply a save result after switching to another note", async () => {
    makeDirtyEditorState("first note content");
    const save = deferred<ReturnType<typeof makeSaveNoteResult>>();
    tauriMocks.invoke.mockReturnValueOnce(save.promise);
    renderHook(() => useAutoSave());

    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    act(() => {
      useEditorStore.getState().setCurrentNote(makeNote({
        id: "note2",
        path: "notes/note2.md",
        title: "Note 2",
        content_hash: "hash-note2",
      }));
      useEditorStore.getState().setContent("second note content");
    });
    await act(async () => {
      save.resolve(makeSaveNoteResult({ note: makeNote({ id: "note1", content_hash: "hash-from-old-save" }) }));
      await Promise.resolve();
    });

    expect(useEditorStore.getState().currentNote?.id).toBe("note2");
    expect(useEditorStore.getState().currentNote?.content_hash).toBe("hash-note2");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it passes**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/hooks/useAutoSave.test.tsx
```

Expected result: 3 tests pass.

- [ ] **Step 3: Commit `useAutoSave` tests**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
git add src/hooks/useAutoSave.test.tsx
git commit -m "test(frontend): cover autosave behavior"
```

### Task 4: Add `MarkdownPreview` Tests

**Files:**
- Create: `src/components/EditorWorkspace/MarkdownPreview.test.tsx`

- [ ] **Step 1: Create `src/components/EditorWorkspace/MarkdownPreview.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { tauriMocks } from "../../test/setup";
import { makeNote, makeNoteDetail } from "../../test/testData";

describe("MarkdownPreview", () => {
  it("hides a closed opening Front Matter block", () => {
    render(<MarkdownPreview content={"---\ntags: [a]\n---\n\n# Visible"} />);
    expect(screen.getByRole("heading", { name: "Visible" })).toBeInTheDocument();
    expect(screen.queryByText("tags: [a]")).not.toBeInTheDocument();
  });

  it("keeps an unclosed opening Front Matter block visible", () => {
    render(<MarkdownPreview content={"---\ntags: [a]\n# Visible"} />);
    expect(screen.getByText("tags: [a]")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Visible" })).toBeInTheDocument();
  });

  it("does not render dangerous html or non-http links as executable DOM", () => {
    const { container } = render(<MarkdownPreview content={"<script>alert(1)</script>\n\n[bad](javascript:alert(2))"} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("opens http links through the Tauri opener", async () => {
    render(<MarkdownPreview content={"[site](https://example.com)"} />);
    fireEvent.click(screen.getByRole("link", { name: "site" }));
    await waitFor(() => expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://example.com"));
  });

  it("resolves and opens wiki links by title", async () => {
    const resolvedNote = makeNote({ id: "note-wiki", path: "notes/wiki.md", title: "Wiki Title" });
    tauriMocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "get_note_by_title") {
        expect(args).toEqual({ title: "Wiki Title" });
        return resolvedNote;
      }
      if (command === "get_note_by_path") {
        expect(args).toEqual({ path: "notes/wiki.md" });
        return makeNoteDetail({ note: resolvedNote, content: "# Wiki Title" });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    render(<MarkdownPreview content={"Open [[Wiki Title]]"} />);
    fireEvent.click(screen.getByText("Wiki Title"));

    await waitFor(() => expect(useAppStore.getState().selectedNodePath).toBe("notes/wiki.md"));
    expect(useEditorStore.getState().currentNote?.id).toBe("note-wiki");
    expect(useEditorStore.getState().content).toBe("# Wiki Title");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it passes**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/EditorWorkspace/MarkdownPreview.test.tsx
```

Expected result: 5 tests pass.

- [ ] **Step 3: Commit `MarkdownPreview` tests**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
git add src/components/EditorWorkspace/MarkdownPreview.test.tsx
git commit -m "test(frontend): cover markdown preview behavior"
```

### Task 5: Add `SearchOverlay` Tests

**Files:**
- Create: `src/components/SearchOverlay.test.tsx`

- [ ] **Step 1: Create `src/components/SearchOverlay.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../types";
import { SearchOverlay } from "./SearchOverlay";

const overlayMocks = vi.hoisted(() => ({
  searchState: { results: [] as SearchResult[], isLoading: false },
  openNote: vi.fn(),
}));

vi.mock("../hooks/useSearch", () => ({ useSearch: () => overlayMocks.searchState }));
vi.mock("../hooks/useOpenNote", () => ({ useOpenNote: () => ({ openNote: overlayMocks.openNote }) }));

describe("SearchOverlay", () => {
  beforeEach(() => {
    overlayMocks.searchState.results = [];
    overlayMocks.searchState.isLoading = false;
    overlayMocks.openNote.mockReset();
  });

  it("focuses the search input on mount", () => {
    render(<SearchOverlay onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText("输入关键词搜索笔记")).toHaveFocus();
  });

  it("opens the selected result with Enter and closes the overlay", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    overlayMocks.searchState.results = [
      { note_id: "n1", title: "Alpha", path: "notes/alpha.md", snippet: "Alpha" },
      { note_id: "n2", title: "Beta", path: "notes/beta.md", snippet: "Beta" },
    ];
    overlayMocks.openNote.mockResolvedValue(undefined);
    render(<SearchOverlay onClose={onClose} />);

    await user.keyboard("{ArrowDown}{Enter}");

    expect(overlayMocks.openNote).toHaveBeenCalledWith("notes/beta.md");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the overlay with Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SearchOverlay onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves selection up and down with arrow keys", async () => {
    const user = userEvent.setup();
    overlayMocks.searchState.results = [
      { note_id: "n1", title: "Alpha", path: "notes/alpha.md", snippet: "Alpha" },
      { note_id: "n2", title: "Beta", path: "notes/beta.md", snippet: "Beta" },
      { note_id: "n3", title: "Gamma", path: "notes/gamma.md", snippet: "Gamma" },
    ];
    overlayMocks.openNote.mockResolvedValue(undefined);
    render(<SearchOverlay onClose={vi.fn()} />);

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");

    expect(overlayMocks.openNote).toHaveBeenCalledWith("notes/beta.md");
  });

  it("renders mark snippets without executing other html", () => {
    overlayMocks.searchState.results = [
      {
        note_id: "n1",
        title: "Safe Result",
        path: "notes/safe.md",
        snippet: '<img src=x onerror=alert(1)><mark>safe</mark>',
      },
    ];
    const { container } = render(<SearchOverlay onClose={vi.fn()} />);

    expect(screen.getByText("safe").tagName.toLowerCase()).toBe("mark");
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it passes**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run src/components/SearchOverlay.test.tsx
```

Expected result: 5 tests pass.

- [ ] **Step 3: Commit `SearchOverlay` tests**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
git add src/components/SearchOverlay.test.tsx
git commit -m "test(frontend): cover search overlay behavior"
```

### Task 6: Add Playwright Smoke Test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/welcome.spec.ts`

- [ ] **Step 1: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

- [ ] **Step 2: Create `tests/e2e/welcome.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("renders the welcome screen without startup browser errors", async ({ page }) => {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "MyNote" })).toBeVisible();
  await expect(page.getByText("个人 Markdown 知识库")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建知识库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开知识库" })).toBeVisible();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 3: Install Chromium for Playwright**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm exec playwright install chromium
```

Expected result: Playwright downloads or confirms Chromium is installed and exits 0.

- [ ] **Step 4: Run smoke test and verify it passes**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:e2e
```

Expected result: Vite starts on `http://127.0.0.1:1420` and the Chromium smoke test passes.

- [ ] **Step 5: Commit Playwright smoke test**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
git add playwright.config.ts tests/e2e/welcome.spec.ts
git commit -m "test(frontend): add browser smoke test"
```

### Task 7: Full Verification And Baseline Update

**Files:**
- Modify: `docs/superpowers/baseline-2026-05-30.md`

- [ ] **Step 1: Run all frontend unit/component tests**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run
```

Expected result: all Vitest files pass.

- [ ] **Step 2: Run browser smoke tests**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:e2e
```

Expected result: the Playwright Chromium project passes.

- [ ] **Step 3: Run production frontend build**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm build
```

Expected result: TypeScript and Vite build pass. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 4: Run backend regression suite**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing/src-tauri
cargo test
```

Expected result: Rust tests pass.

- [ ] **Step 5: Update baseline revision record and validation commands**

In `docs/superpowers/baseline-2026-05-30.md`, add this row to the 修订记录 table after v1.3:

```markdown
| 2026-05-30 | v1.4 | 标记前端测试框架和交互测试完成，并补充 Vitest/Playwright 验证结果。 |
```

In section `3. 启动与验证命令`, update the verified commands to include:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm test:run
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm test:e2e
```

Update validation results to state Rust tests, frontend build, Vitest tests, and Playwright smoke tests passed.

- [ ] **Step 6: Update the P3 risk row**

In section `6. 已知风险队列`, replace the P3 row with:

```markdown
| P3 | 已完成 | 前端缺少测试框架和交互测试。 | 已增加 Vitest/React Testing Library/jsdom 测试框架和 Playwright Chromium smoke 测试，覆盖搜索、自动保存、Markdown 预览和搜索弹层关键交互。 |
```

- [ ] **Step 7: Update next recommendation**

In section `8. 下一步建议`, replace the current recommendation paragraph with:

```markdown
P1 风险、P2 Tauri 安全面、SQLite migration safety、搜索 fallback 性能风险，以及 P3 前端测试框架和交互测试均已处理完成。

下一步建议重新审视 Phase 2 之后的新功能队列，按新的风险或产品优先级继续拆分 design spec。
```

- [ ] **Step 8: Commit baseline update**

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
git add docs/superpowers/baseline-2026-05-30.md
git commit -m "docs: update baseline after frontend tests"
```

## 5. Final Verification

Before merging the worktree back to `main`, run:

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
export PATH="$HOME/.npm-global/bin:$PATH"
pnpm test:run
pnpm test:e2e
pnpm build
cd /Users/lijun/mynote/.worktrees/frontend-testing/src-tauri
cargo test
```

Expected result:

- Vitest passes.
- Playwright Chromium smoke test passes.
- Production frontend build passes.
- Rust backend tests pass.

Then request review before merging:

```bash
cd /Users/lijun/mynote/.worktrees/frontend-testing
git status --short
git log --oneline --decorate main..HEAD
```

Expected result: `git status --short` is clean and the branch contains the frontend test commits from this plan.

## 6. Self-Review

Spec coverage:

- Vitest/RTL/jsdom setup is covered by Task 1.
- Playwright smoke setup is covered by Task 6.
- `useSearch` coverage is covered by Task 2.
- `useAutoSave` coverage is covered by Task 3.
- `MarkdownPreview` coverage is covered by Task 4.
- `SearchOverlay` coverage is covered by Task 5.
- Mock and store isolation are covered by Task 1.
- Verification and baseline update are covered by Task 7 and Final Verification.

Placeholder scan:

- The plan names concrete files, commands, assertions, and commit points for each task.

Type consistency:

- Test factories use the existing exported interfaces from `src/types/index.ts`.
- Tauri API assertions match command names and argument shapes from `src/api/commands.ts`.
- Store reset helpers use existing Zustand stores `useAppStore` and `useEditorStore`.
