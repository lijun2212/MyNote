# Reading Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-state center workspace mode so users can switch between split, reading-only, and writing-only layouts, with an explicit icon-only action to return from single-column modes back to split.

**Architecture:** Promote the editor workspace from a boolean preview toggle to a `viewMode` state machine in the editor store, keep `showPreview` as a compatibility-derived value for existing consumers, and make `EditorWorkspace` render by `viewMode` rather than by a plain preview boolean. Opening a note remains the canonical reset point that restores the default `split` mode.

**Tech Stack:** React 19, Zustand, Vitest, inline style-based UI, existing editor/preview split resize hook.

---

## File Structure

- Modify: `src/store/useEditorStore.ts`
  - Add `EditorViewMode` and make store actions operate on three states while preserving compatibility helpers.
- Modify: `src/store/useEditorStore.test.ts`
  - Replace the old boolean-only assumption with explicit three-state store tests.
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
  - Rework the third toolbar button, add the icon-only “return to split” action, and conditionally render editor / preview / split layouts by `viewMode`.
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
  - Cover three render states, toolbar copy, return-to-split icon visibility, and split ratio recovery behavior at the component boundary.
- Modify: `src/hooks/useOpenNote.ts`
  - Ensure opening any note restores `split` mode.
- Modify: `src/hooks/useOpenNote.test.tsx`
  - Keep the open-note regression explicit around default split restoration.

## Task 1: Upgrade Editor Workspace State Model

**Files:**
- Modify: `src/store/useEditorStore.ts`
- Modify: `src/store/useEditorStore.test.ts`
- Test: `src/store/useEditorStore.test.ts`

- [ ] **Step 1: Write the failing store tests**

Add explicit tests for the three-state model in `src/store/useEditorStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "./useEditorStore";

describe("useEditorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({ viewMode: "split", showPreview: true });
  });

  it("derives compatibility flags from the active view mode", () => {
    useEditorStore.getState().setViewMode("preview");
    expect(useEditorStore.getState().viewMode).toBe("preview");
    expect(useEditorStore.getState().showPreview).toBe(true);

    useEditorStore.getState().setViewMode("editor");
    expect(useEditorStore.getState().viewMode).toBe("editor");
    expect(useEditorStore.getState().showPreview).toBe(false);

    useEditorStore.getState().setViewMode("split");
    expect(useEditorStore.getState().getEditorMode()).toBe("split");
    expect(useEditorStore.getState().showPreview).toBe(true);
  });

  it("maps legacy editor-mode setters onto the new view modes", () => {
    useEditorStore.getState().setEditorMode("editor");
    expect(useEditorStore.getState().viewMode).toBe("editor");

    useEditorStore.getState().setEditorMode("split");
    expect(useEditorStore.getState().viewMode).toBe("split");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/store/useEditorStore.test.ts`

Expected: FAIL because `viewMode` / `setViewMode` do not exist yet and the store still only models a boolean preview toggle.

- [ ] **Step 3: Write the minimal store implementation**

Update `src/store/useEditorStore.ts` to add a three-state mode while preserving current consumers:

```ts
export type EditorMode = "editor" | "split";
export type EditorViewMode = "split" | "preview" | "editor";

function deriveEditorMode(viewMode: EditorViewMode): EditorMode {
  return viewMode === "editor" ? "editor" : "split";
}

function deriveShowPreview(viewMode: EditorViewMode): boolean {
  return viewMode !== "editor";
}

interface EditorState {
  viewMode: EditorViewMode;
  showPreview: boolean;
  getEditorMode: () => EditorMode;
  setViewMode: (mode: EditorViewMode) => void;
  togglePreview: () => void;
  setEditorMode: (mode: EditorMode) => void;
}

viewMode: "split",
showPreview: true,
getEditorMode: () => deriveEditorMode(get().viewMode),
setViewMode: (mode) => set({ viewMode: mode, showPreview: deriveShowPreview(mode) }),
togglePreview: () => set((s) => {
  const nextMode = s.viewMode === "editor" ? "split" : "editor";
  return { viewMode: nextMode, showPreview: deriveShowPreview(nextMode) };
}),
setEditorMode: (mode) => {
  const nextMode = mode === "split" ? "split" : "editor";
  set({ viewMode: nextMode, showPreview: deriveShowPreview(nextMode) });
},
```

Also extend `sessionResetState` with:

```ts
viewMode: "split" as const,
showPreview: true,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/store/useEditorStore.test.ts`

Expected: PASS with 2/2 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/store/useEditorStore.ts src/store/useEditorStore.test.ts
git commit -m "feat: add editor workspace view mode state"
```

## Task 2: Render Three Workspace Layouts and Toolbar Actions

**Files:**
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
- Test: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`

- [ ] **Step 1: Write the failing EditorWorkspace tests**

Add focused tests to `src/components/EditorWorkspace/EditorWorkspace.test.tsx`:

```ts
it("shows reading-mode entry in split mode and hides return-to-split action", () => {
  useEditorStore.setState({ viewMode: "split", showPreview: true });
  render(<EditorWorkspace />);

  expect(screen.getByRole("button", { name: "阅读模式" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "返回双列模式" })).not.toBeInTheDocument();
  expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
  expect(screen.getByTestId("mock-preview")).toBeInTheDocument();
});

it("shows preview only plus return-to-split action in reading mode", () => {
  useEditorStore.setState({ viewMode: "preview", showPreview: true });
  render(<EditorWorkspace />);

  expect(screen.getByRole("button", { name: "写作模式" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回双列模式" })).toBeInTheDocument();
  expect(screen.queryByTestId("mock-editor")).not.toBeInTheDocument();
  expect(screen.getByTestId("mock-preview")).toBeInTheDocument();
  expect(screen.queryByRole("separator")).not.toBeInTheDocument();
});

it("shows editor only plus return-to-split action in writing mode", () => {
  useEditorStore.setState({ viewMode: "editor", showPreview: false });
  render(<EditorWorkspace />);

  expect(screen.getByRole("button", { name: "阅读模式" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回双列模式" })).toBeInTheDocument();
  expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
  expect(screen.queryByTestId("mock-preview")).not.toBeInTheDocument();
  expect(screen.queryByRole("separator")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx -t "shows reading-mode entry in split mode and hides return-to-split action"`

Expected: FAIL because the third button still renders `显示预览/隐藏预览` and no return-to-split icon button exists.

- [ ] **Step 3: Write the minimal component implementation**

Update `src/components/EditorWorkspace/EditorWorkspace.tsx` so toolbar and content render by `viewMode`:

```tsx
const { viewMode, setViewMode } = useEditorStore();
const isSplitMode = viewMode === "split";
const isPreviewMode = viewMode === "preview";
const isEditorMode = viewMode === "editor";

function handleSingleColumnToggle() {
  if (viewMode === "split") {
    setViewMode("preview");
    return;
  }
  setViewMode(viewMode === "preview" ? "editor" : "preview");
}

function handleReturnToSplit() {
  setViewMode("split");
}
```

Replace the third toolbar button with:

```tsx
<button
  onClick={handleSingleColumnToggle}
  onMouseEnter={() => setHoveredToolbarAction("preview")}
  onMouseLeave={() => setHoveredToolbarAction((current) => (current === "preview" ? null : current))}
  style={buildToolbarButtonStyle(!isSplitMode, hoveredToolbarAction === "preview")}
>
  {viewMode === "preview" ? "写作模式" : "阅读模式"}
</button>
```

Render the icon-only exit action only outside split mode:

```tsx
{!isSplitMode && (
  <button
    aria-label="返回双列模式"
    title="返回双列模式"
    onClick={handleReturnToSplit}
    onMouseEnter={() => setHoveredToolbarAction("return-split")}
    onMouseLeave={() => setHoveredToolbarAction((current) => (current === "return-split" ? null : current))}
    style={buildToolbarButtonStyle(false, hoveredToolbarAction === "return-split")}
  >
    <ReturnToSplitIcon />
  </button>
)}
```

Add the extra hover discriminator:

```tsx
const [hoveredToolbarAction, setHoveredToolbarAction] = useState<
  "summary" | "projection" | "preview" | "return-split" | null
>(null);
```

Render the body by mode:

```tsx
{viewMode !== "preview" && (
  <div style={{ width: isSplitMode ? `${editorRatio}%` : "100%", minWidth: 0, height: "100%", overflow: "hidden" }}>
    <MarkdownEditor ... />
  </div>
)}

{isSplitMode && <div role="separator" ... />}

{viewMode !== "editor" && (
  <div style={{ width: isSplitMode ? `${100 - editorRatio}%` : "100%", minWidth: 0, height: "100%", overflow: "hidden", borderLeft: isSplitMode ? "1px solid #e0e2e7" : "none" }}>
    <MarkdownPreview ... />
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx`

Expected: PASS with the new three-state rendering cases plus the existing toolbar and layout regressions still green.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorWorkspace/EditorWorkspace.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx
git commit -m "feat: add reading and writing workspace modes"
```

## Task 3: Restore Split Mode on Note Open

**Files:**
- Modify: `src/hooks/useOpenNote.ts`
- Modify: `src/hooks/useOpenNote.test.tsx`
- Test: `src/hooks/useOpenNote.test.tsx`

- [ ] **Step 1: Write the failing open-note regression test**

Keep or update the focused regression in `src/hooks/useOpenNote.test.tsx`:

```ts
it("restores split mode when opening a note", async () => {
  const detail = makeNoteDetail({
    note: makeNoteWithSummary("摘要", { path: "notes/demo.md" }),
    content: "# Demo\n\nBody",
  });
  apiMocks.getNoteByPath.mockResolvedValue(detail);
  useEditorStore.setState({ viewMode: "preview", showPreview: true });

  const { result } = renderHook(() => useOpenNote());

  await act(async () => {
    await result.current.openNote("notes/demo.md");
  });

  expect(useEditorStore.getState().viewMode).toBe("split");
  expect(useEditorStore.getState().showPreview).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/hooks/useOpenNote.test.tsx -t "restores split mode when opening a note"`

Expected: FAIL if the open-note flow does not explicitly set `viewMode` back to `split`.

- [ ] **Step 3: Write the minimal hook implementation**

Update `src/hooks/useOpenNote.ts` so a successful open always resets the workspace view before hydrating the note:

```ts
const setViewMode = useEditorStore((s) => s.setViewMode);

const openNote = useCallback(async (path: string, existingRequestId?: number) => {
  const requestId = existingRequestId ?? beginOpenNote();
  if (requestId !== latestOpenRequestId) return;

  setSelectedNodePath(path);
  setNoteOpening(true, path);

  try {
    const detail = await api.getNoteByPath(path);
    if (requestId !== latestOpenRequestId) return;
    setViewMode("split");
    setCurrentNote(detail.note);
    setContent(detail.content);
    recordLookbackOpen(detail.note.path);
  } finally {
    if (requestId === latestOpenRequestId) {
      setNoteOpening(false);
    }
  }
}, [beginOpenNote, recordLookbackOpen, setContent, setCurrentNote, setNoteOpening, setSelectedNodePath, setViewMode]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/hooks/useOpenNote.test.tsx`

Expected: PASS with the split-reset regression and the existing stale-request / failure-path coverage all green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOpenNote.ts src/hooks/useOpenNote.test.tsx
git commit -m "fix: reset reading mode when opening a note"
```

## Task 4: Full Reading-Mode Verification Pass

**Files:**
- Modify: `docs/superpowers/specs/2026-06-14-reading-mode-design.md` only if implementation diverges from approved design.
- Test: `src/store/useEditorStore.test.ts`
- Test: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
- Test: `src/hooks/useOpenNote.test.tsx`

- [ ] **Step 1: Run the focused frontend regression suite**

Run: `corepack pnpm vitest run src/store/useEditorStore.test.ts src/components/EditorWorkspace/EditorWorkspace.test.tsx src/hooks/useOpenNote.test.tsx`

Expected: PASS with all reading-mode state, rendering, and note-open regressions green.

- [ ] **Step 2: Run the full targeted frontend build check**

Run: `corepack pnpm build`

Expected: build completes successfully with no TypeScript or bundling errors.

- [ ] **Step 3: Update the design doc only if names or boundaries changed during implementation**

If implementation exactly matches the approved design, make no doc change. If a name changed, update the exact lines in `docs/superpowers/specs/2026-06-14-reading-mode-design.md` to match, for example:

```md
- 在纯阅读或纯写作时，在其右侧出现一个仅图标的“返回双列”按钮。
```

- [ ] **Step 4: Re-run the focused frontend regression suite if the doc or code changed in this verification task**

Run: `corepack pnpm vitest run src/store/useEditorStore.test.ts src/components/EditorWorkspace/EditorWorkspace.test.tsx src/hooks/useOpenNote.test.tsx`

Expected: PASS again after any final alignment edits.

- [ ] **Step 5: Commit**

```bash
git add src/store/useEditorStore.ts src/store/useEditorStore.test.ts src/components/EditorWorkspace/EditorWorkspace.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx src/hooks/useOpenNote.ts src/hooks/useOpenNote.test.tsx docs/superpowers/specs/2026-06-14-reading-mode-design.md
git commit -m "feat: add reading mode workspace controls"
```

## Self-Review

- Spec coverage: the plan covers the approved three-state model, the new icon-only return-to-split control, the single-column toggle copy rules, split restoration on note open, and the focused test surface defined in the spec.
- Placeholder scan: no task uses TBD/TODO language; each task includes explicit files, commands, and code snippets.
- Type consistency: `EditorViewMode` is consistently defined as `split | preview | editor`, and the component, store, and hook tasks all use the same naming.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-14-reading-mode-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**