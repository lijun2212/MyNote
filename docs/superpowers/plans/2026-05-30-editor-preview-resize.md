# Editor Preview Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable, globally persisted editor/preview split ratio to the note editing workspace.

**Architecture:** Keep resize state in a focused React hook backed by localStorage, then let `EditorWorkspace` own only layout composition. `MarkdownEditor` and `MarkdownPreview` remain content components and receive no persistence or drag logic.

**Tech Stack:** React 19, TypeScript, Zustand, CodeMirror, Vite, Tauri 2.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义编辑区与预览区可拖动分隔线的实施步骤。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 实施任务](#2-实施任务)
- [3. 自检清单](#3-自检清单)
- [4. 验证命令](#4-验证命令)

## 1. 文件结构

- Create: `src/hooks/useEditorSplitResize.ts`
  - Owns split ratio constants, localStorage read/write, pointer drag lifecycle, ratio clamping, and dragging state.
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
  - Adds split layout wrapper, pane sizing, separator element, and hook wiring.
- Modify: `src/components/EditorWorkspace/MarkdownEditor.tsx`
  - Changes root element sizing from flex ownership to width/height ownership so parent panes can control layout.
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
  - Changes root element sizing from flex ownership to width/height ownership and moves the left border responsibility to the separator.
- Verify only: `package.json`, `src-tauri/Cargo.toml`
  - No script or backend changes expected.

## 2. 实施任务

### Task 1: Split Resize Hook

**Files:**
- Create: `src/hooks/useEditorSplitResize.ts`

- [ ] **Step 1: Create the hook file with constants and safe persistence**

Add this file:

```ts
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "mynote.editorSplitRatio";
const DEFAULT_EDITOR_RATIO = 50;
const MIN_EDITOR_RATIO = 30;
const MAX_EDITOR_RATIO = 75;

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EDITOR_RATIO;
  return Math.min(MAX_EDITOR_RATIO, Math.max(MIN_EDITOR_RATIO, value));
}

function readStoredRatio(): number {
  if (typeof window === "undefined") return DEFAULT_EDITOR_RATIO;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_EDITOR_RATIO;
    return clampRatio(Number(stored));
  } catch {
    return DEFAULT_EDITOR_RATIO;
  }
}

function writeStoredRatio(value: number) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampRatio(value)));
  } catch {
    // Layout preference persistence is best-effort.
  }
}

interface UseEditorSplitResizeOptions {
  containerRef: React.RefObject<HTMLElement | null>;
}

export function useEditorSplitResize({ containerRef }: UseEditorSplitResizeOptions) {
  const [editorRatio, setEditorRatio] = useState(readStoredRatio);
  const [isResizing, setIsResizing] = useState(false);
  const latestRatioRef = useRef(editorRatio);

  useEffect(() => {
    latestRatioRef.current = editorRatio;
  }, [editorRatio]);

  const updateRatioFromClientX = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;

    const nextRatio = clampRatio(((clientX - rect.left) / rect.width) * 100);
    latestRatioRef.current = nextRatio;
    setEditorRatio(nextRatio);
  }, [containerRef]);

  const startResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
    updateRatioFromClientX(event.clientX);
  }, [updateRatioFromClientX]);

  const resize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!isResizing) return;
    updateRatioFromClientX(event.clientX);
  }, [isResizing, updateRatioFromClientX]);

  const stopResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!isResizing) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
    writeStoredRatio(latestRatioRef.current);
  }, [isResizing]);

  return {
    editorRatio,
    isResizing,
    minRatio: MIN_EDITOR_RATIO,
    maxRatio: MAX_EDITOR_RATIO,
    startResize,
    resize,
    stopResize,
  };
}
```

- [ ] **Step 2: Run TypeScript build to expose hook typing issues**

Run:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: build may fail only if React pointer event types or ref types need adjustment. No runtime behavior is wired yet.

- [ ] **Step 3: Commit the hook**

```bash
git add src/hooks/useEditorSplitResize.ts
git commit -m "feat: add editor split resize hook"
```

### Task 2: Editor Workspace Split Layout

**Files:**
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownEditor.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`

- [ ] **Step 1: Wire the hook into `EditorWorkspace`**

Change imports in `src/components/EditorWorkspace/EditorWorkspace.tsx`:

```ts
import { useCallback, useRef } from "react";
import { useEditorStore } from "../../store/useEditorStore";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useEditorSplitResize } from "../../hooks/useEditorSplitResize";
```

Inside `EditorWorkspace`, add after `useAutoSave();`:

```ts
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const {
    editorRatio,
    isResizing,
    minRatio,
    maxRatio,
    startResize,
    resize,
    stopResize,
  } = useEditorSplitResize({ containerRef: splitContainerRef });
```

Replace the editor/preview content area with:

```tsx
      <div
        ref={splitContainerRef}
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          userSelect: isResizing ? "none" : undefined,
        }}
      >
        <div style={{
          width: showPreview ? `${editorRatio}%` : "100%",
          minWidth: 0,
          height: "100%",
          overflow: "hidden",
        }}>
          <MarkdownEditor initialContent={content} onChange={handleChange} />
        </div>
        {showPreview && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={minRatio}
            aria-valuemax={maxRatio}
            aria-valuenow={Math.round(editorRatio)}
            tabIndex={0}
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerUp={stopResize}
            onPointerCancel={stopResize}
            style={{
              width: 6,
              flexShrink: 0,
              cursor: "col-resize",
              background: isResizing ? "#d9ddff" : "#eef0f5",
              borderLeft: "1px solid #e0e2e7",
              borderRight: "1px solid #e0e2e7",
            }}
          />
        )}
        {showPreview && (
          <div style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            overflow: "hidden",
          }}>
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
```

- [ ] **Step 2: Let `MarkdownEditor` fill its parent pane**

Change the return element in `src/components/EditorWorkspace/MarkdownEditor.tsx` to:

```tsx
  return (
    <div ref={editorRef} style={{ width: "100%", height: "100%", overflow: "auto" }} />
  );
```

- [ ] **Step 3: Let `MarkdownPreview` fill its parent pane**

Change the outer return style in `src/components/EditorWorkspace/MarkdownPreview.tsx` to:

```tsx
    <div style={{
      width: "100%",
      minWidth: 0,
      height: "100%",
      overflowY: "auto",
      background: "#fff",
    }}>
```

Remove the old preview `borderLeft` from this component because the separator now owns the center boundary.

- [ ] **Step 4: Run build**

Run:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: `tsc -b && vite build` succeeds. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 5: Commit layout wiring**

```bash
git add src/hooks/useEditorSplitResize.ts src/components/EditorWorkspace/EditorWorkspace.tsx src/components/EditorWorkspace/MarkdownEditor.tsx src/components/EditorWorkspace/MarkdownPreview.tsx
git commit -m "feat: make editor preview split resizable"
```

### Task 3: Verification And Review

**Files:**
- Verify: frontend build output
- Verify: Rust tests
- Review: changed TypeScript files

- [ ] **Step 1: Run frontend verification**

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

Expected: success with only the known Vite chunk-size warning.

- [ ] **Step 2: Run backend regression verification**

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

Expected: all existing Rust tests pass.

- [ ] **Step 3: Static review checklist**

Confirm in code review:

- `EditorWorkspace` is the only component that knows split pane layout.
- `MarkdownEditor` and `MarkdownPreview` do not read localStorage or pointer events.
- The split ratio is clamped before state update and before persistence.
- Invalid localStorage values fall back to 50.
- `showPreview === false` renders no separator and the editor takes 100% width.
- The separator includes `role="separator"` and vertical ARIA metadata.
- No note content mutation or save-state update is introduced by dragging.

- [ ] **Step 4: Manual smoke test when running the app**

Run:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri dev
```

Expected manual results:

- Dragging the divider changes editor and preview widths.
- Dragging cannot collapse either pane into an unusable width.
- Hiding preview makes the editor full-width.
- Showing preview restores the prior ratio.
- Switching notes keeps the same global ratio.
- Restarting the app keeps the saved ratio.

- [ ] **Step 5: Commit any review fixes**

If review finds issues, fix them and commit with a focused message such as:

```bash
git add src/hooks/useEditorSplitResize.ts src/components/EditorWorkspace/EditorWorkspace.tsx src/components/EditorWorkspace/MarkdownEditor.tsx src/components/EditorWorkspace/MarkdownPreview.tsx
git commit -m "fix: harden editor split resize behavior"
```

## 3. 自检清单

- Spec coverage: The plan implements global persisted ratio, 50/50 default, drag separator, preview hide/show restoration, minimum bounds, localStorage fallback, and no backend model changes.
- Placeholder scan: No TBD/TODO/fill-in placeholders are present.
- Type consistency: Hook return names match the `EditorWorkspace` wiring snippet.
- Scope check: This plan only covers editor/preview resize and does not include Front Matter preview hiding.

## 4. 验证命令

Run before merging:

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```
