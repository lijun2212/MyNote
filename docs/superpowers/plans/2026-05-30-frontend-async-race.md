# Frontend Async Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale frontend async requests from overwriting newer search results, note-open state, or autosave state.

**Architecture:** Add a shared `useOpenNote()` hook with module-level request sequencing so all note-open entry points share one latest-request guard. Add request guards directly inside `useSearch()` and `useAutoSave()` because those flows own their own local lifecycle and should not affect note-open sequencing.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri invoke API, existing `pnpm build` and `cargo test` verification. The project has no frontend test framework yet, so this plan uses RED static audits and manual race repro steps instead of introducing Vitest in this P1 fix.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 创建前端异步竞态修复实施计划。 |

## 目录

- [File Structure](#file-structure)
- [Task 1: Record RED Static Audit](#task-1-record-red-static-audit)
- [Task 2: Add Shared Safe Note Opening Hook](#task-2-add-shared-safe-note-opening-hook)
- [Task 3: Migrate File Tree And Import Opening](#task-3-migrate-file-tree-and-import-opening)
- [Task 4: Migrate Search, Preview, And Link Opening](#task-4-migrate-search-preview-and-link-opening)
- [Task 5: Guard Search Requests](#task-5-guard-search-requests)
- [Task 6: Guard Autosave Results](#task-6-guard-autosave-results)
- [Task 7: Final Verification And Review](#task-7-final-verification-and-review)

## File Structure

- Create: `src/hooks/useOpenNote.ts`
  - Shared note-opening entry point.
  - Owns module-level `latestOpenRequestId` so separate component instances still share one race guard.
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
  - Replace direct `api.getNoteByPath()` + editor store writes with `openNote(path)`.
- Modify: `src/components/SearchOverlay.tsx`
  - Replace search-result direct opening with `openNote(result.path)`.
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
  - Keep `getNoteByTitle()` lookup, then open resolved `note.path` through `openNote()`.
- Modify: `src/components/RightSidebar/BacklinksPanel.tsx`
  - Replace direct internal-link opening with `openNote(link.note_path)`.
- Modify: `src/hooks/useSearch.ts`
  - Add request id guard for stale search responses and loading state.
- Modify: `src/hooks/useAutoSave.ts`
  - Add save request id and current-note guard before applying save results.
- Modify: `src/store/useEditorStore.ts`
  - Ensure save status transitions do not report stale saves as current saved state.
- No backend commands are changed.
- No database migration is required.

## Task 1: Record RED Static Audit

**Files:**
- No file changes.

- [ ] **Step 1: Confirm branch and cleanliness**

Run:

```bash
cd /Users/lijun/mynote && git status --short && git branch --show-current
```

Expected: no output from `git status --short`, branch is the implementation branch or `main` before creating a worktree.

- [ ] **Step 2: Run note-open audit and verify RED**

Run:

```bash
cd /Users/lijun/mynote && rg "setCurrentNote|setContent\(detail\.content\)|getNoteByPath" src/components src/hooks
```

Expected RED: output includes direct note-opening state writes in these files:

```text
src/hooks/useKnowledgeBase.ts
src/components/LeftSidebar/FileTreePanel.tsx
src/components/SearchOverlay.tsx
src/components/EditorWorkspace/MarkdownPreview.tsx
src/components/RightSidebar/BacklinksPanel.tsx
```

This proves note-opening writes are currently scattered and not protected by one shared latest-request guard.

- [ ] **Step 3: Run baseline verification**

Run:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
cd /Users/lijun/mynote/src-tauri && cargo test
```

Expected: frontend build passes, Rust tests pass. Existing Vite chunk-size warning is acceptable.

## Task 2: Add Shared Safe Note Opening Hook

**Files:**
- Create: `src/hooks/useOpenNote.ts`

- [ ] **Step 1: Create `useOpenNote.ts` with a module-level request guard**

Create `src/hooks/useOpenNote.ts`:

```ts
import { useCallback } from "react";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";

let nextOpenRequestId = 0;
let latestOpenRequestId = 0;

export function useOpenNote() {
  const setSelectedNodePath = useAppStore((s) => s.setSelectedNodePath);
  const setCurrentNote = useEditorStore((s) => s.setCurrentNote);
  const setContent = useEditorStore((s) => s.setContent);

  const openNote = useCallback(async (path: string) => {
    const requestId = ++nextOpenRequestId;
    latestOpenRequestId = requestId;
    setSelectedNodePath(path);

    try {
      const detail = await api.getNoteByPath(path);
      if (requestId !== latestOpenRequestId) return;
      setCurrentNote(detail.note);
      setContent(detail.content);
    } catch (e) {
      if (requestId !== latestOpenRequestId) return;
      console.error("Failed to open note:", e);
    }
  }, [setSelectedNodePath, setCurrentNote, setContent]);

  return { openNote };
}
```

Important: keep `nextOpenRequestId` and `latestOpenRequestId` at module scope. A `useRef` inside the hook would only protect one component instance and would not solve cross-component races.

- [ ] **Step 2: Run TypeScript build and verify GREEN for the new hook**

Run:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: build passes, even though the hook is not used yet.

- [ ] **Step 3: Commit the new hook**

Run:

```bash
cd /Users/lijun/mynote && git add src/hooks/useOpenNote.ts && git commit -m "feat: add guarded note opening hook"
```

## Task 3: Migrate File Tree And Import Opening

**Files:**
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
- Modify: `src/hooks/useKnowledgeBase.ts`

- [ ] **Step 1: Replace direct editor writes in `FileTreePanel` imports**

In `src/components/LeftSidebar/FileTreePanel.tsx`, remove these imports:

```ts
import { useEditorStore } from "../../store/useEditorStore";
import { api } from "../../api/commands";
```

Add this import:

```ts
import { useOpenNote } from "../../hooks/useOpenNote";
```

If `api` is still needed for tag filtering, keep `api` imported. Do not remove it unless TypeScript confirms it is unused.

- [ ] **Step 2: Replace editor store destructuring with `openNote`**

Replace:

```ts
const { setCurrentNote, setContent } = useEditorStore();
```

with:

```ts
const { openNote } = useOpenNote();
```

- [ ] **Step 3: Rewrite `handleSelect`**

Replace the body of `handleSelect` with:

```ts
async function handleSelect(node: NoteTreeNode) {
  if (node.is_dir) return;
  await openNote(node.path);
}
```

This delegates both selected path and editor content updates to the guarded shared hook.

- [ ] **Step 4: Rewrite import completion opening**

Inside `ImportDialog.onDone`, replace:

```ts
setSelectedNodePath(importedNote.path);
const detail = await api.getNoteByPath(importedNote.path);
setCurrentNote(detail.note);
setContent(detail.content);
```

with:

```ts
await openNote(importedNote.path);
```

- [ ] **Step 5: Remove stale opening logic from `useKnowledgeBase`**

In `src/hooks/useKnowledgeBase.ts`, import the shared hook:

```ts
import { useOpenNote } from "./useOpenNote";
```

Replace:

```ts
const { setCurrentNote, setContent } = useEditorStore();
```

with:

```ts
const { openNote } = useOpenNote();
```

Replace the detail-loading block in `createNote`:

```ts
const detail = await api.getNoteByPath(note.path);
setCurrentNote(detail.note);
setContent(detail.content);
```

with:

```ts
await openNote(note.path);
```

Remove the now-unused `useEditorStore` import.

- [ ] **Step 6: Run audit and build**

Run:

```bash
cd /Users/lijun/mynote && rg "setCurrentNote|setContent\(detail\.content\)|getNoteByPath" src/components/LeftSidebar src/hooks/useKnowledgeBase.ts
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: no direct `setCurrentNote` / `setContent(detail.content)` opening writes remain in `FileTreePanel` or `useKnowledgeBase`; build passes.

- [ ] **Step 7: Commit this migration**

Run:

```bash
cd /Users/lijun/mynote && git add src/components/LeftSidebar/FileTreePanel.tsx src/hooks/useKnowledgeBase.ts && git commit -m "refactor: route file tree openings through guarded hook"
```

## Task 4: Migrate Search, Preview, And Link Opening

**Files:**
- Modify: `src/components/SearchOverlay.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Modify: `src/components/RightSidebar/BacklinksPanel.tsx`

- [ ] **Step 1: Migrate `SearchOverlay` opening**

In `src/components/SearchOverlay.tsx`, remove these imports if they become unused:

```ts
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";
import { api } from "../api/commands";
```

Add:

```ts
import { useOpenNote } from "../hooks/useOpenNote";
```

Replace the store selectors:

```ts
const setSelectedNodePath = useAppStore((s) => s.setSelectedNodePath);
const setCurrentNote = useEditorStore((s) => s.setCurrentNote);
const setContent = useEditorStore((s) => s.setContent);
```

with:

```ts
const { openNote } = useOpenNote();
```

Replace `openResult` with:

```ts
const openResult = async (result: SearchResult) => {
  await openNote(result.path);
  onClose();
};
```

- [ ] **Step 2: Migrate `MarkdownPreview` wiki opening**

In `src/components/EditorWorkspace/MarkdownPreview.tsx`, remove:

```ts
import { useEditorStore } from "../../store/useEditorStore";
```

Add:

```ts
import { useOpenNote } from "../../hooks/useOpenNote";
```

Inside `MarkdownPreview`, add:

```ts
const { openNote } = useOpenNote();
```

Replace:

```ts
const detail = await api.getNoteByPath(note.path);
useEditorStore.getState().setCurrentNote(detail.note);
useEditorStore.getState().setContent(detail.content);
```

with:

```ts
await openNote(note.path);
```

Because `handleClick` is defined in an effect, include `openNote` in that effect dependency array:

```ts
}, [openNote]);
```

- [ ] **Step 3: Migrate `BacklinksPanel` opening**

In `src/components/RightSidebar/BacklinksPanel.tsx`, remove:

```ts
import { useEditorStore } from "../../store/useEditorStore";
```

Add:

```ts
import { useOpenNote } from "../../hooks/useOpenNote";
```

Inside `BacklinksPanel`, add:

```ts
const { openNote } = useOpenNote();
```

Replace:

```ts
const detail = await api.getNoteByPath(link.note_path);
useEditorStore.getState().setCurrentNote(detail.note);
useEditorStore.getState().setContent(detail.content);
```

with:

```ts
await openNote(link.note_path);
```

- [ ] **Step 4: Run global note-open audit and build**

Run:

```bash
cd /Users/lijun/mynote && rg "setCurrentNote|setContent\(detail\.content\)|getNoteByPath" src/components src/hooks
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected audit output only includes allowed locations:

```text
src/hooks/useOpenNote.ts
```

For this command scope, `getNoteByPath` should remain only in `src/hooks/useOpenNote.ts`; component-level direct `getNoteByPath` openings should be gone. Build passes.

- [ ] **Step 5: Commit this migration**

Run:

```bash
cd /Users/lijun/mynote && git add src/components/SearchOverlay.tsx src/components/EditorWorkspace/MarkdownPreview.tsx src/components/RightSidebar/BacklinksPanel.tsx && git commit -m "refactor: route link openings through guarded hook"
```

## Task 5: Guard Search Requests

**Files:**
- Modify: `src/hooks/useSearch.ts`

- [ ] **Step 1: Add request id ref**

In `src/hooks/useSearch.ts`, after `timerRef`, add:

```ts
const requestIdRef = useRef(0);
```

- [ ] **Step 2: Replace `doSearch` with guarded implementation**

Replace `doSearch` with:

```ts
const doSearch = useCallback(async (q: string) => {
  const currentKb = kbRef.current;
  const requestId = ++requestIdRef.current;

  if (!currentKb) {
    setResults([]);
    setIsLoading(false);
    return;
  }

  setIsLoading(true);
  try {
    const res = await api.searchNotes(q, currentKb.id);
    if (requestId !== requestIdRef.current) return;
    if (kbRef.current?.id !== currentKb.id) return;
    setResults(res);
  } catch {
    if (requestId !== requestIdRef.current) return;
    setResults([]);
  } finally {
    if (requestId === requestIdRef.current) {
      setIsLoading(false);
    }
  }
}, []);
```

- [ ] **Step 3: Invalidate stale searches on empty query**

Inside the `useEffect` branch for empty query, replace:

```ts
setResults([]);
setIsLoading(false);
return;
```

with:

```ts
requestIdRef.current += 1;
setResults([]);
setIsLoading(false);
return;
```

- [ ] **Step 4: Invalidate searches when knowledge base changes**

Update the `kb` sync effect to:

```ts
useEffect(() => {
  kbRef.current = kb;
  requestIdRef.current += 1;
}, [kb]);
```

- [ ] **Step 5: Run build**

Run:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: build passes.

- [ ] **Step 6: Commit search guard**

Run:

```bash
cd /Users/lijun/mynote && git add src/hooks/useSearch.ts && git commit -m "fix: ignore stale search responses"
```

## Task 6: Guard Autosave Results

**Files:**
- Modify: `src/hooks/useAutoSave.ts`
- Modify: `src/store/useEditorStore.ts`

- [ ] **Step 1: Add save request id ref**

In `src/hooks/useAutoSave.ts`, after `lastSavedHashRef`, add:

```ts
const saveRequestIdRef = useRef(0);
```

- [ ] **Step 2: Capture save inputs before invoking API**

Inside the timeout callback, before `setSaving(true)`, add:

```ts
const noteId = currentNote.id;
const expectedHash = lastSavedHashRef.current ?? currentNote.content_hash;
const contentToSave = content;
const requestId = ++saveRequestIdRef.current;
```

- [ ] **Step 3: Replace save call arguments**

Replace:

```ts
const result = await api.saveNote(
  currentNote.id,
  content,
  lastSavedHashRef.current ?? currentNote.content_hash
);
```

with:

```ts
const result = await api.saveNote(noteId, contentToSave, expectedHash);
```

- [ ] **Step 4: Add a current-note guard helper inside the timeout**

After the save call returns, before reading `result.conflict`, add:

```ts
const stillCurrent = () => {
  const state = useEditorStore.getState();
  return requestId === saveRequestIdRef.current && state.currentNote?.id === noteId;
};

if (!stillCurrent()) return;
```

- [ ] **Step 5: Guard errors and saving status**

Update the `catch` block to:

```ts
} catch (e) {
  const state = useEditorStore.getState();
  if (requestId === saveRequestIdRef.current && state.currentNote?.id === noteId) {
    setSaveError(String(e));
  }
}
```

Add a `finally` block:

```ts
finally {
  const state = useEditorStore.getState();
  if (requestId === saveRequestIdRef.current && state.currentNote?.id === noteId) {
    setSaving(false);
  }
}
```

This is important because `setSaving(true)` must not leave the current note stuck in saving state, and stale saves must not mark a newer note as saved.

- [ ] **Step 6: Make save status transitions explicit in the editor store**

In `src/store/useEditorStore.ts`, replace the `markSaved`, `setSaving`, and `setSaveError` implementations with:

```ts
markSaved: (note) =>
  set({ currentNote: note, isDirty: false, isSaving: false, saveStatus: "saved", saveError: null }),
setSaving: (saving) =>
  set((s) => ({
    isSaving: saving,
    saveStatus: saving ? "saving" : s.saveError ? "error" : s.isDirty ? "unsaved" : "saved",
  })),
setSaveError: (error) =>
  set({ saveError: error, isSaving: false, saveStatus: "error" }),
```

This keeps `setSaving(false)` from unconditionally turning a dirty or errored note into `saved`.

- [ ] **Step 7: Run build**

Run:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: build passes.

- [ ] **Step 8: Commit autosave guard**

Run:

```bash
cd /Users/lijun/mynote && git add src/hooks/useAutoSave.ts src/store/useEditorStore.ts && git commit -m "fix: ignore stale autosave results"
```

## Task 7: Final Verification And Review

**Files:**
- No implementation changes unless review finds issues.

- [ ] **Step 1: Run final static audits**

Run:

```bash
cd /Users/lijun/mynote && rg "setCurrentNote|setContent\(detail\.content\)|getNoteByPath" src/components src/hooks
cd /Users/lijun/mynote && rg "requestIdRef|latestOpenRequestId|saveRequestIdRef" src/hooks
```

Expected:

- Direct component-level note opening writes are gone.
- `getNoteByPath` is only used through `api` definition and `useOpenNote`.
- `useSearch`, `useOpenNote`, and `useAutoSave` contain request guards.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: build passes. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 3: Run backend regression tests**

Run:

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

Expected: all Rust tests pass.

- [ ] **Step 4: Manual race verification**

Run:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri dev
```

Manually verify:

- Rapidly click two files in the tree; final editor content is the last clicked file.
- Search for one term, quickly change to another; results do not revert to the old term.
- Open from search, then immediately open a different file from the tree; final editor content is the final user action.
- Trigger autosave, switch notes before save returns; old save result does not overwrite the new note state.
- Click a preview Wiki link or backlink, then quickly open another note; final editor content is the final user action.

- [ ] **Step 5: Commit any final fixes**

If review or verification requires small fixes, commit them:

```bash
cd /Users/lijun/mynote && git status --short
cd /Users/lijun/mynote && git add src/hooks/useOpenNote.ts src/hooks/useSearch.ts src/hooks/useAutoSave.ts src/store/useEditorStore.ts src/components/LeftSidebar/FileTreePanel.tsx src/components/SearchOverlay.tsx src/components/EditorWorkspace/MarkdownPreview.tsx src/components/RightSidebar/BacklinksPanel.tsx
cd /Users/lijun/mynote && git commit -m "fix: complete async race guards"
```

Skip this step if no final fixes are needed.

- [ ] **Step 6: Request code review**

Ask `code-reviewer` to review the implementation against:

- `docs/superpowers/specs/2026-05-30-frontend-async-race-design.md`
- `docs/superpowers/plans/2026-05-30-frontend-async-race.md`

Review range should start at the plan baseline commit and end at the final implementation commit.

- [ ] **Step 7: Finish branch**

After review approval and fresh verification, use `finishing-a-development-branch` to choose merge/PR/keep/discard workflow.
