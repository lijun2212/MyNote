# Dual-Screen Preview Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform second Tauri projection window that shows a read-only Markdown preview on another screen while the main window remains the editing workspace on macOS, Windows, and Linux.

**Architecture:** The main window remains the single editor state source. A new projection window bootstraps a dedicated preview shell, receives note/content/navigation snapshots over a small Tauri event protocol, and optionally follows main-window scroll updates. Window lifecycle and menu state are coordinated through a focused projection store and a thin window API wrapper that exposes capability detection so platform-specific enhancements can degrade cleanly without breaking the core flow.

**Tech Stack:** React 19, Zustand, Vitest, Tauri 2, Tauri event/window APIs, existing MarkdownPreview and EditorWorkspace components.

---

## File Structure

### New files

- `src/components/Projection/ProjectionPreviewShell.tsx`
  - Read-only projection shell that renders current projected note title and `MarkdownPreview`.
- `src/components/Projection/ProjectionPreviewShell.test.tsx`
  - Tests projection shell event hydration, revision ordering, and scroll follow behavior.
- `src/projection/events.ts`
  - Shared projection event names, payload types, revision helpers.
- `src/projection/windowRole.ts`
  - Detects whether the current webview is `main` or `projection-preview`.
- `src/projection/windowApi.ts`
  - Thin wrapper around Tauri window APIs for opening/focusing/closing projection window and sending events.
- `src/store/useProjectionStore.ts`
  - Projection session state for main and projection windows.
- `src/store/useProjectionStore.test.ts`
  - Store tests for lifecycle, follow-scroll toggle, revision application.
- `src/hooks/useProjectionSync.ts`
  - Main-window hook that pushes note/content/navigation snapshots and optional scroll sync to projection window.
- `src/hooks/useProjectionSync.test.tsx`
  - Tests throttled sync behavior and follow-scroll gating.
- `src/hooks/useProjectionLifecycle.ts`
  - Main-window hook that subscribes to projection ready/closed/error events.
- `src/hooks/useProjectionLifecycle.test.tsx`
  - Tests event subscription and store updates.

### Modified files

- `src/App.tsx`
  - Render `ProjectionPreviewShell` when current window role is `projection-preview`.
- `src/components/AppShell.tsx`
  - Wire projection menu handlers and projection lifecycle hook.
- `src/components/EditorWorkspace/EditorWorkspace.tsx`
  - Add toolbar button to open/close projection window and call projection sync hook.
- `src/components/EditorWorkspace/MarkdownPreview.tsx`
  - Add a minimal read-only mode to suppress editor-return/context actions in projection usage.
- `src/menu/menuIds.ts`
  - Add projection-related menu action ids.
- `src/menu/menuSchema.ts`
  - Add projection actions to the `视图` menu with checked/enabled state.
- `src/menu/menuActionRunner.ts`
  - Add projection action handlers.
- `src/components/AppShell.test.tsx`
  - Verify menu wiring / projection action exposure if needed.
- `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
  - Verify projection button behavior and sync hook wiring.
- `src/test/setup.ts`
  - Mock Tauri window/event APIs used by the new projection path.
- `src-tauri/capabilities/default.json`
  - Allow `projection-preview` window label.
- `src-tauri/src/lib.rs`
  - Register projection window commands if Rust command layer is used in MVP.
- `src-tauri/tauri.conf.json`
  - Add projection window metadata only if static config is needed; otherwise leave static window list unchanged.

### Notes on scope

- MVP should prefer frontend Tauri window APIs over new Rust commands unless a concrete platform blocker appears.
- Auto-move-to-external-monitor and fullscreen should be scaffolded behind the API wrapper, but can be deferred if Tauri plugin surface is not yet available in repo.
- Treat cross-platform support as a release requirement: core flow means open projection window, sync content, close projection window, and manually place the window on a second display. Auto-place/fullscreen are optional enhancements and must never block macOS, Windows, or Linux support.
- Do not put platform checks in UI components. Any `platform`, monitor, or fullscreen branching must live in `src/projection/windowApi.ts` or a Rust adapter if the frontend API surface is insufficient.

---

### Task 1: Define projection protocol and store

**Files:**
- Create: `src/projection/events.ts`
- Create: `src/store/useProjectionStore.ts`
- Test: `src/store/useProjectionStore.test.ts`

- [ ] **Step 1: Write the failing store tests**

```ts
import { describe, expect, it } from "vitest";
import { useProjectionStore } from "./useProjectionStore";
import type { ProjectionStateSyncPayload } from "../projection/events";

describe("useProjectionStore", () => {
  it("applies a newer projection snapshot and ignores an older revision", () => {
    const newer: ProjectionStateSyncPayload = {
      notePath: "notes/demo.md",
      noteTitle: "演示稿",
      content: "# 新版本",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
      revision: 2,
    };
    const older: ProjectionStateSyncPayload = { ...newer, content: "# 旧版本", revision: 1 };

    useProjectionStore.getState().applyStateSync(newer);
    useProjectionStore.getState().applyStateSync(older);

    expect(useProjectionStore.getState().content).toBe("# 新版本");
    expect(useProjectionStore.getState().lastRevision).toBe(2);
  });

  it("toggles follow scroll and resets readiness on close", () => {
    useProjectionStore.getState().setReady(true);
    useProjectionStore.getState().setEnabled(true);
    useProjectionStore.getState().setFollowScroll(false);
    useProjectionStore.getState().markClosed();

    expect(useProjectionStore.getState().projectionEnabled).toBe(false);
    expect(useProjectionStore.getState().projectionWindowReady).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/store/useProjectionStore.test.ts`
Expected: FAIL because `useProjectionStore` and projection event types do not exist yet.

- [ ] **Step 3: Write minimal protocol file**

```ts
import type { SearchNavigationTarget, TagNavigationTarget } from "../types";

export const PROJECTION_STATE_SYNC_EVENT = "projection:state-sync";
export const PROJECTION_SCROLL_SYNC_EVENT = "projection:scroll-sync";
export const PROJECTION_READY_EVENT = "projection:ready";
export const PROJECTION_CLOSED_EVENT = "projection:closed";
export const PROJECTION_ERROR_EVENT = "projection:error";

export interface ProjectionStateSyncPayload {
  notePath: string | null;
  noteTitle: string | null;
  content: string;
  searchNavigationTarget: SearchNavigationTarget | null;
  tagNavigationTarget: TagNavigationTarget | null;
  revision: number;
}

export interface ProjectionScrollSyncPayload {
  source: "main-editor" | "main-preview";
  topVisibleLine: number;
  revision: number;
}
```

- [ ] **Step 4: Write minimal projection store**

```ts
import { create } from "zustand";
import type { SearchNavigationTarget, TagNavigationTarget } from "../types";
import type { ProjectionStateSyncPayload } from "../projection/events";

interface ProjectionStoreState {
  projectionEnabled: boolean;
  projectionFollowScroll: boolean;
  projectionWindowReady: boolean;
  projectionLastError: string | null;
  notePath: string | null;
  noteTitle: string | null;
  content: string;
  searchNavigationTarget: SearchNavigationTarget | null;
  tagNavigationTarget: TagNavigationTarget | null;
  lastRevision: number;
  setEnabled: (enabled: boolean) => void;
  setReady: (ready: boolean) => void;
  setFollowScroll: (follow: boolean) => void;
  setError: (message: string | null) => void;
  markClosed: () => void;
  applyStateSync: (payload: ProjectionStateSyncPayload) => void;
}

export const useProjectionStore = create<ProjectionStoreState>((set, get) => ({
  projectionEnabled: false,
  projectionFollowScroll: true,
  projectionWindowReady: false,
  projectionLastError: null,
  notePath: null,
  noteTitle: null,
  content: "",
  searchNavigationTarget: null,
  tagNavigationTarget: null,
  lastRevision: 0,
  setEnabled: (enabled) => set({ projectionEnabled: enabled }),
  setReady: (ready) => set({ projectionWindowReady: ready }),
  setFollowScroll: (follow) => set({ projectionFollowScroll: follow }),
  setError: (message) => set({ projectionLastError: message }),
  markClosed: () => set({ projectionEnabled: false, projectionWindowReady: false }),
  applyStateSync: (payload) => {
    if (payload.revision < get().lastRevision) {
      return;
    }
    set({
      notePath: payload.notePath,
      noteTitle: payload.noteTitle,
      content: payload.content,
      searchNavigationTarget: payload.searchNavigationTarget,
      tagNavigationTarget: payload.tagNavigationTarget,
      lastRevision: payload.revision,
    });
  },
}));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm vitest run src/store/useProjectionStore.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/projection/events.ts src/store/useProjectionStore.ts src/store/useProjectionStore.test.ts
git commit -m "feat: add projection protocol store"
```

### Task 2: Detect window role and branch App shell

**Files:**
- Create: `src/projection/windowRole.ts`
- Create: `src/components/Projection/ProjectionPreviewShell.tsx`
- Create: `src/components/Projection/ProjectionPreviewShell.test.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/Projection/ProjectionPreviewShell.test.tsx`

- [ ] **Step 1: Write the failing app/shell tests**

```ts
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../projection/windowRole", () => ({
  getCurrentWindowRole: () => "projection-preview",
}));

import App from "../../App";

describe("ProjectionPreviewShell", () => {
  it("renders the projection shell for the projection window role", () => {
    render(<App />);
    expect(screen.getByTestId("projection-preview-shell")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/components/Projection/ProjectionPreviewShell.test.tsx`
Expected: FAIL because role detection and projection shell do not exist yet.

- [ ] **Step 3: Add window role detection**

```ts
export type WindowRole = "main" | "projection-preview";

export function getCurrentWindowRole(): WindowRole {
  const role = globalThis.window?.__MYNOTE_WINDOW_ROLE__;
  return role === "projection-preview" ? "projection-preview" : "main";
}
```

- [ ] **Step 4: Add minimal projection shell and App switch**

```tsx
import { MarkdownPreview } from "../EditorWorkspace/MarkdownPreview";
import { useProjectionStore } from "../../store/useProjectionStore";

export function ProjectionPreviewShell() {
  const { noteTitle, content, searchNavigationTarget, tagNavigationTarget } = useProjectionStore();

  return (
    <div data-testid="projection-preview-shell" style={{ height: "100vh", background: "#fff" }}>
      <MarkdownPreview
        content={content}
        searchNavigationTarget={searchNavigationTarget}
        tagNavigationTarget={tagNavigationTarget}
        projectionMode
      />
      {noteTitle ? <div style={{ display: "none" }}>{noteTitle}</div> : null}
    </div>
  );
}
```

```tsx
import { getCurrentWindowRole } from "./projection/windowRole";
import { ProjectionPreviewShell } from "./components/Projection/ProjectionPreviewShell";

export default function App() {
  const role = getCurrentWindowRole();
  const kb = useAppStore((s) => s.kb);

  return (
    <ErrorBoundary>
      {role === "projection-preview" ? <ProjectionPreviewShell /> : kb ? <AppShell /> : <WelcomeScreen />}
    </ErrorBoundary>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm vitest run src/components/Projection/ProjectionPreviewShell.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/projection/windowRole.ts src/components/Projection/ProjectionPreviewShell.tsx src/components/Projection/ProjectionPreviewShell.test.tsx src/App.tsx
git commit -m "feat: add projection window app shell"
```

### Task 3: Add a projection-safe preview mode

**Files:**
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Modify: `src/components/Projection/ProjectionPreviewShell.tsx`
- Test: `src/components/Projection/ProjectionPreviewShell.test.tsx`

- [ ] **Step 1: Write the failing preview-mode test**

```ts
it("suppresses editor-return actions in projection mode", async () => {
  render(<ProjectionPreviewShell />);
  expect(screen.queryByRole("menuitem", { name: "返回编辑" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/components/Projection/ProjectionPreviewShell.test.tsx -t "suppresses editor-return actions in projection mode"`
Expected: FAIL because `MarkdownPreview` does not yet know about projection mode.

- [ ] **Step 3: Add a `projectionMode` prop to MarkdownPreview**

```ts
interface Props {
  content: string;
  searchNavigationTarget?: SearchNavigationTarget | null;
  tagNavigationTarget?: TagNavigationTarget | null;
  sourceLineSyncSignal?: SourceLineSyncSignal | null;
  onTopVisibleLineChange?: (line: number) => void;
  projectionMode?: boolean;
}
```

```ts
if (projectionMode) {
  return;
}
```

Apply that guard only around behaviors that open editor-specific context menus or trigger return-to-editor actions. Keep rendering, external links, and source-line attributes intact.

- [ ] **Step 4: Update shell to pass the prop**

```tsx
<MarkdownPreview
  content={content}
  searchNavigationTarget={searchNavigationTarget}
  tagNavigationTarget={tagNavigationTarget}
  projectionMode
/>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm vitest run src/components/Projection/ProjectionPreviewShell.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/EditorWorkspace/MarkdownPreview.tsx src/components/Projection/ProjectionPreviewShell.tsx src/components/Projection/ProjectionPreviewShell.test.tsx
git commit -m "feat: add projection-safe markdown preview mode"
```

### Task 4: Wrap Tauri projection window APIs and mocks

**Files:**
- Create: `src/projection/windowApi.ts`
- Modify: `src/test/setup.ts`
- Test: `src/hooks/useProjectionLifecycle.test.tsx`

- [ ] **Step 1: Write the failing window API test**

```ts
import { describe, expect, it, vi } from "vitest";
import { openProjectionWindow } from "../projection/windowApi";
import { tauriMocks } from "../test/setup";

describe("windowApi", () => {
  it("opens a projection window with the projection label", async () => {
    await openProjectionWindow();
    expect(tauriMocks.createWebviewWindow).toHaveBeenCalledWith("projection-preview", expect.any(Object));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/hooks/useProjectionLifecycle.test.tsx`
Expected: FAIL because Tauri window mocks and window API wrapper do not exist.

- [ ] **Step 3: Extend test setup mocks**

```ts
const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((filePath: string) => `asset://${filePath}`),
  openDialog: vi.fn(),
  openUrl: vi.fn(),
  listen: vi.fn(),
  emitTo: vi.fn(),
  createWebviewWindow: vi.fn(),
  getCurrentWebviewWindow: vi.fn(),
}));
```

Also mock `@tauri-apps/api/event` and `@tauri-apps/api/webviewWindow` from this shared setup.

- [ ] **Step 4: Add minimal window API wrapper**

```ts
import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export async function openProjectionWindow() {
  return new WebviewWindow("projection-preview", {
    title: "MyNote Preview",
    width: 1200,
    height: 800,
    visible: true,
  });
}

export async function closeProjectionWindow() {
  await emitTo("projection-preview", "projection:command", { type: "close" });
}

export async function emitProjectionState(event: string, payload: unknown) {
  await emitTo("projection-preview", event, payload);
}
```

Extend this wrapper in the real implementation with capability helpers that return safe defaults on all platforms, for example:

```ts
export interface ProjectionWindowCapabilities {
  supportsExternalMonitorPlacement: boolean;
  supportsFullscreenProjection: boolean;
}

export async function getProjectionWindowCapabilities(): Promise<ProjectionWindowCapabilities> {
  return {
    supportsExternalMonitorPlacement: false,
    supportsFullscreenProjection: true,
  };
}
```

The first production implementation should default to the conservative path unless capability detection is explicitly verified on the target platform.

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm vitest run src/hooks/useProjectionLifecycle.test.tsx`
Expected: PASS for the new wrapper test.

- [ ] **Step 6: Commit**

```bash
git add src/projection/windowApi.ts src/test/setup.ts
git commit -m "feat: add projection window api wrapper"
```

### Task 5: Track projection lifecycle in the main window

**Files:**
- Create: `src/hooks/useProjectionLifecycle.ts`
- Create: `src/hooks/useProjectionLifecycle.test.tsx`
- Modify: `src/components/AppShell.tsx`
- Test: `src/hooks/useProjectionLifecycle.test.tsx`

- [ ] **Step 1: Write the failing lifecycle hook test**

```ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { tauriMocks } from "../test/setup";
import { useProjectionLifecycle } from "./useProjectionLifecycle";
import { useProjectionStore } from "../store/useProjectionStore";

describe("useProjectionLifecycle", () => {
  it("marks the projection window ready when the ready event arrives", async () => {
    let readyHandler: ((event: { payload: unknown }) => void) | undefined;
    tauriMocks.listen.mockImplementation(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
      if (eventName === "projection:ready") readyHandler = handler;
      return () => {};
    });

    renderHook(() => useProjectionLifecycle());
    readyHandler?.({ payload: null });

    expect(useProjectionStore.getState().projectionWindowReady).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/hooks/useProjectionLifecycle.test.tsx`
Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the lifecycle hook**

```ts
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  PROJECTION_READY_EVENT,
  PROJECTION_CLOSED_EVENT,
  PROJECTION_ERROR_EVENT,
} from "../projection/events";
import { useProjectionStore } from "../store/useProjectionStore";

export function useProjectionLifecycle() {
  const setReady = useProjectionStore((state) => state.setReady);
  const markClosed = useProjectionStore((state) => state.markClosed);
  const setError = useProjectionStore((state) => state.setError);

  useEffect(() => {
    let disposeReady: (() => void) | undefined;
    let disposeClosed: (() => void) | undefined;
    let disposeError: (() => void) | undefined;
    let active = true;

    listen(PROJECTION_READY_EVENT, () => {
      if (active) {
        setReady(true);
        useProjectionStore.getState().setEnabled(true);
      }
    }).then((unlisten) => { disposeReady = unlisten; });

    listen(PROJECTION_CLOSED_EVENT, () => {
      if (active) {
        markClosed();
      }
    }).then((unlisten) => { disposeClosed = unlisten; });

    listen<string>(PROJECTION_ERROR_EVENT, (event) => {
      if (active) {
        setError(String(event.payload ?? "投影窗口启动失败"));
      }
    }).then((unlisten) => { disposeError = unlisten; });

    return () => {
      active = false;
      disposeReady?.();
      disposeClosed?.();
      disposeError?.();
    };
  }, [markClosed, setError, setReady]);
}
```

- [ ] **Step 4: Mount the hook in AppShell**

```tsx
export function AppShell() {
  useProjectionLifecycle();
  // existing code...
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm vitest run src/hooks/useProjectionLifecycle.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useProjectionLifecycle.ts src/hooks/useProjectionLifecycle.test.tsx src/components/AppShell.tsx
git commit -m "feat: track projection window lifecycle"
```

### Task 6: Add projection menu actions and stateful wiring

**Files:**
- Modify: `src/menu/menuIds.ts`
- Modify: `src/menu/menuSchema.ts`
- Modify: `src/menu/menuActionRunner.ts`
- Modify: `src/components/AppShell.tsx`
- Test: `src/menu/useAppMenu.test.tsx`

- [ ] **Step 1: Write the failing menu test**

```ts
it("shows projection actions in the view menu", () => {
  const schema = buildAppMenuSchema({
    hasKnowledgeBase: true,
    hasCurrentNote: true,
    leftSidebarVisible: true,
    rightSidebarVisible: false,
    editorMode: "split",
    hasDefaultAiProfile: false,
    autoSummaryAgentEnabled: false,
    projectionEnabled: false,
    projectionFollowScroll: true,
  });

  expect(schema[2]?.children?.some((item) => item.id === "view.openProjection")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/menu/useAppMenu.test.tsx`
Expected: FAIL because projection menu options are not defined.

- [ ] **Step 3: Extend menu ids/schema options**

```ts
"view.openProjection",
"view.closeProjection",
"view.projectionFollowScroll",
```

```ts
projectionEnabled: boolean;
projectionFollowScroll: boolean;
```

Add three view items:

```ts
item("view.openProjection", "开启投影预览", hasKnowledgeBase && !projectionEnabled),
item("view.closeProjection", "关闭投影预览", projectionEnabled),
{ id: "view.projectionFollowScroll", label: "投影窗口跟随滚动", enabled: projectionEnabled, checked: projectionFollowScroll },
```

- [ ] **Step 4: Wire AppShell handlers**

```tsx
const projectionEnabled = useProjectionStore((s) => s.projectionEnabled);
const projectionFollowScroll = useProjectionStore((s) => s.projectionFollowScroll);
const setProjectionFollowScroll = useProjectionStore((s) => s.setFollowScroll);
const setProjectionEnabled = useProjectionStore((s) => s.setEnabled);

openProjection: async () => {
  await openProjectionWindow();
  setProjectionEnabled(true);
},
closeProjection: async () => {
  await closeProjectionWindow();
  useProjectionStore.getState().markClosed();
},
setProjectionFollowScroll: () => setProjectionFollowScroll(!projectionFollowScroll),
```

Also extend `createMenuActionRunner` handler types and action map accordingly.

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm vitest run src/menu/useAppMenu.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/menu/menuIds.ts src/menu/menuSchema.ts src/menu/menuActionRunner.ts src/components/AppShell.tsx
git commit -m "feat: add projection menu actions"
```

### Task 7: Add projection toolbar button in EditorWorkspace

**Files:**
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`
- Test: `src/components/EditorWorkspace/EditorWorkspace.test.tsx`

- [ ] **Step 1: Write the failing toolbar test**

```ts
it("shows an open-projection button and toggles to close when enabled", () => {
  useProjectionStore.setState({ projectionEnabled: false });
  const { rerender } = render(<EditorWorkspace />);
  expect(screen.getByRole("button", { name: "开启投影" })).toBeInTheDocument();

  useProjectionStore.setState({ projectionEnabled: true });
  rerender(<EditorWorkspace />);
  expect(screen.getByRole("button", { name: "关闭投影" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx`
Expected: FAIL because the toolbar button does not exist.

- [ ] **Step 3: Add the button with injected handlers**

```tsx
const projectionEnabled = useProjectionStore((state) => state.projectionEnabled);
const openProjection = useProjectionStore((state) => state.openProjection);
const closeProjection = useProjectionStore((state) => state.closeProjection);
```

If you do not want async actions inside the store, accept callbacks from AppShell via a thin context/provider. MVP can keep the simpler store-free button contract by passing the current toggle function from a new hook.

Render:

```tsx
<button
  onClick={() => void (projectionEnabled ? closeProjection() : openProjection())}
  style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer", borderRadius: 4, border: "1px solid #ccc" }}
>
  {projectionEnabled ? "关闭投影" : "开启投影"}
</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/EditorWorkspace.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/EditorWorkspace/EditorWorkspace.tsx src/components/EditorWorkspace/EditorWorkspace.test.tsx
git commit -m "feat: add projection toolbar toggle"
```

### Task 8: Push content/navigation snapshots from the main window

**Files:**
- Create: `src/hooks/useProjectionSync.ts`
- Create: `src/hooks/useProjectionSync.test.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Test: `src/hooks/useProjectionSync.test.tsx`

- [ ] **Step 1: Write the failing sync hook test**

```ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { tauriMocks } from "../test/setup";
import { useProjectionSync } from "./useProjectionSync";

describe("useProjectionSync", () => {
  it("emits projection state when projection is enabled and ready", async () => {
    renderHook(() => useProjectionSync({
      enabled: true,
      ready: true,
      notePath: "notes/demo.md",
      noteTitle: "演示稿",
      content: "# Hello",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
    }));

    expect(tauriMocks.emitTo).toHaveBeenCalledWith(
      "projection-preview",
      "projection:state-sync",
      expect.objectContaining({ notePath: "notes/demo.md", content: "# Hello" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/hooks/useProjectionSync.test.tsx`
Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement throttled sync hook**

```ts
import { useEffect, useRef } from "react";
import { PROJECTION_STATE_SYNC_EVENT } from "../projection/events";
import { emitProjectionState } from "../projection/windowApi";

interface UseProjectionSyncOptions {
  enabled: boolean;
  ready: boolean;
  notePath: string | null;
  noteTitle: string | null;
  content: string;
  searchNavigationTarget: SearchNavigationTarget | null;
  tagNavigationTarget: TagNavigationTarget | null;
}

export function useProjectionSync(options: UseProjectionSyncOptions) {
  const revisionRef = useRef(0);

  useEffect(() => {
    if (!options.enabled || !options.ready) {
      return;
    }

    const timer = window.setTimeout(() => {
      revisionRef.current += 1;
      void emitProjectionState(PROJECTION_STATE_SYNC_EVENT, {
        notePath: options.notePath,
        noteTitle: options.noteTitle,
        content: options.content,
        searchNavigationTarget: options.searchNavigationTarget,
        tagNavigationTarget: options.tagNavigationTarget,
        revision: revisionRef.current,
      });
    }, 200);

    return () => window.clearTimeout(timer);
  }, [
    options.enabled,
    options.ready,
    options.notePath,
    options.noteTitle,
    options.content,
    options.searchNavigationTarget,
    options.tagNavigationTarget,
  ]);
}
```

- [ ] **Step 4: Mount the hook in EditorWorkspace**

```tsx
useProjectionSync({
  enabled: projectionEnabled,
  ready: projectionWindowReady,
  notePath: currentNote?.path ?? null,
  noteTitle: currentNote?.title ?? null,
  content,
  searchNavigationTarget: activeSearchNavigationTarget,
  tagNavigationTarget: activeTagNavigationTarget,
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm vitest run src/hooks/useProjectionSync.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useProjectionSync.ts src/hooks/useProjectionSync.test.tsx src/components/EditorWorkspace/EditorWorkspace.tsx
git commit -m "feat: sync projection content from main window"
```

### Task 9: Apply projection state and ready event inside the projection shell

**Files:**
- Modify: `src/components/Projection/ProjectionPreviewShell.tsx`
- Modify: `src/components/Projection/ProjectionPreviewShell.test.tsx`
- Test: `src/components/Projection/ProjectionPreviewShell.test.tsx`

- [ ] **Step 1: Write the failing hydration test**

```ts
it("hydrates the shell when a projection sync event arrives", async () => {
  let syncHandler: ((event: { payload: ProjectionStateSyncPayload }) => void) | undefined;
  tauriMocks.listen.mockImplementation(async (eventName: string, handler: (event: { payload: ProjectionStateSyncPayload }) => void) => {
    if (eventName === "projection:state-sync") syncHandler = handler;
    return () => {};
  });

  render(<ProjectionPreviewShell />);
  syncHandler?.({
    payload: {
      notePath: "notes/demo.md",
      noteTitle: "演示稿",
      content: "# Hello Projection",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
      revision: 1,
    },
  });

  expect(useProjectionStore.getState().content).toBe("# Hello Projection");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/components/Projection/ProjectionPreviewShell.test.tsx`
Expected: FAIL because the shell is not subscribed to projection events.

- [ ] **Step 3: Subscribe inside the shell and emit ready**

```tsx
useEffect(() => {
  let disposeSync: (() => void) | undefined;
  let active = true;

  listen<ProjectionStateSyncPayload>(PROJECTION_STATE_SYNC_EVENT, (event) => {
    if (active) {
      applyStateSync(event.payload);
    }
  }).then((unlisten) => { disposeSync = unlisten; });

  void emit(PROJECTION_READY_EVENT);

  return () => {
    active = false;
    disposeSync?.();
    void emit(PROJECTION_CLOSED_EVENT);
  };
}, [applyStateSync]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/components/Projection/ProjectionPreviewShell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/Projection/ProjectionPreviewShell.tsx src/components/Projection/ProjectionPreviewShell.test.tsx
git commit -m "feat: hydrate projection shell from sync events"
```

### Task 10: Add optional scroll-follow sync

**Files:**
- Modify: `src/hooks/useProjectionSync.ts`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Modify: `src/components/Projection/ProjectionPreviewShell.tsx`
- Modify: `src/hooks/useProjectionSync.test.tsx`
- Modify: `src/components/Projection/ProjectionPreviewShell.test.tsx`

- [ ] **Step 1: Write the failing scroll sync test**

```ts
it("emits scroll sync only when follow-scroll is enabled", () => {
  renderHook(() => useProjectionSync({
    enabled: true,
    ready: true,
    followScroll: true,
    topVisibleLine: 12,
    notePath: "notes/demo.md",
    noteTitle: "演示稿",
    content: "# Hello",
    searchNavigationTarget: null,
    tagNavigationTarget: null,
  }));

  expect(tauriMocks.emitTo).toHaveBeenCalledWith(
    "projection-preview",
    "projection:scroll-sync",
    expect.objectContaining({ topVisibleLine: 12 }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/hooks/useProjectionSync.test.tsx src/components/Projection/ProjectionPreviewShell.test.tsx`
Expected: FAIL because scroll sync is not implemented.

- [ ] **Step 3: Extend the hook and shell**

Add to hook options:

```ts
followScroll?: boolean;
previewTopVisibleLine?: number | null;
```

Emit scroll payload on an 80ms timeout when all of these are true:
- `enabled`
- `ready`
- `followScroll`
- `previewTopVisibleLine !== null`

In `ProjectionPreviewShell`, subscribe to `projection:scroll-sync` and call the preview scroll helper or feed a `sourceLineSyncSignal` down to `MarkdownPreview`.

Use the existing source-line sync model rather than inventing a new scrolling mechanism inside the preview component.

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/hooks/useProjectionSync.test.tsx src/components/Projection/ProjectionPreviewShell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProjectionSync.ts src/components/EditorWorkspace/EditorWorkspace.tsx src/components/Projection/ProjectionPreviewShell.tsx src/hooks/useProjectionSync.test.tsx src/components/Projection/ProjectionPreviewShell.test.tsx
git commit -m "feat: add projection scroll follow sync"
```

### Task 11: Allow the projection window label in Tauri capability config

**Files:**
- Modify: `src-tauri/capabilities/default.json`
- Test: `src/tauriBundleLocalization.test.ts` or a new focused config test if needed

- [ ] **Step 1: Write the failing config test**

```ts
import capability from "../src-tauri/capabilities/default.json";
import { describe, expect, it } from "vitest";

describe("projection capability", () => {
  it("allows the projection-preview window label", () => {
    expect(capability.windows).toContain("projection-preview");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/tauriBundleLocalization.test.ts`
Expected: FAIL if you place the assertion there or in a new focused config test.

- [ ] **Step 3: Update capability config**

```json
"windows": ["main", "projection-preview"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm vitest run src/tauriBundleLocalization.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/capabilities/default.json src/tauriBundleLocalization.test.ts
git commit -m "chore: allow projection window capability"
```

### Task 12: Add cross-platform capability gating for enhanced window actions

**Files:**
- Modify: `src/projection/windowApi.ts`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/EditorWorkspace/EditorWorkspace.tsx`
- Test: `src/hooks/useProjectionLifecycle.test.tsx` or a new focused `src/projection/windowApi.test.ts`

- [ ] **Step 1: Write the failing capability gating test**

```ts
import { describe, expect, it, vi } from "vitest";
import { getProjectionWindowCapabilities } from "../projection/windowApi";

describe("projection window capabilities", () => {
  it("returns a conservative fallback capability set", async () => {
    await expect(getProjectionWindowCapabilities()).resolves.toEqual({
      supportsExternalMonitorPlacement: false,
      supportsFullscreenProjection: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/projection/windowApi.test.ts`
Expected: FAIL because the capability helper does not exist yet.

- [ ] **Step 3: Implement capability detection with safe fallback**

```ts
export interface ProjectionWindowCapabilities {
  supportsExternalMonitorPlacement: boolean;
  supportsFullscreenProjection: boolean;
}

export async function getProjectionWindowCapabilities(): Promise<ProjectionWindowCapabilities> {
  return {
    supportsExternalMonitorPlacement: false,
    supportsFullscreenProjection: true,
  };
}
```

If later platform-specific detection is added, keep the public return shape identical and preserve the same conservative fallback on unknown platforms.

- [ ] **Step 4: Gate enhanced actions in UI**

Only show or enable “移动到副屏并全屏” style actions when `supportsExternalMonitorPlacement` is true. When false, show the generic success state and optional helper text telling the user to drag the projection window manually.

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm vitest run src/projection/windowApi.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/projection/windowApi.ts src/projection/windowApi.test.ts src/components/AppShell.tsx src/components/EditorWorkspace/EditorWorkspace.tsx
git commit -m "feat: gate projection window enhancements by platform capability"
```

### Task 13: Full slice verification and documentation touch-up

**Files:**
- Modify: `docs/superpowers/specs/2026-06-13-dual-screen-preview-projection-design.md` (only if implementation-driven clarifications were needed)
- Test: all touched projection-related files

- [ ] **Step 1: Run focused projection tests**

Run:

```bash
corepack pnpm vitest run \
  src/components/Projection/ProjectionPreviewShell.test.tsx \
  src/store/useProjectionStore.test.ts \
  src/hooks/useProjectionLifecycle.test.tsx \
  src/hooks/useProjectionSync.test.tsx \
  src/components/EditorWorkspace/EditorWorkspace.test.tsx \
  src/menu/useAppMenu.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run broader frontend safety net**

Run:

```bash
corepack pnpm vitest run \
  src/components/EditorWorkspace/EditorWorkspace.test.tsx \
  src/components/EditorWorkspace/MarkdownEditor.test.tsx \
  src/menu/*.test.ts \
  src/menu/*.test.tsx
```

Expected: PASS

- [ ] **Step 3: Run build verification**

Run: `corepack pnpm build`
Expected: build completes successfully.

- [ ] **Step 4: Run backend verification**

Run: `cd src-tauri && cargo test`
Expected: PASS

- [ ] **Step 5: Record cross-platform manual verification checklist**

Document the following execution checklist in the implementation notes or PR description and do not mark the feature complete until it has been run on real or CI-backed target environments:

```text
macOS: open projection window, sync content, close projection window, verify manual second-screen placement works.
Windows: open projection window, sync content, close projection window, verify manual second-screen placement works.
Linux: open projection window, sync content, close projection window, verify manual second-screen placement works.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-06-13-dual-screen-preview-projection-design.md
git commit -m "test: verify projection preview feature slice"
```

---

## Self-Review

### Spec coverage

- Second projection window: Tasks 2, 4, 5, 11.
- Main window remains editor source of truth: Tasks 1, 8, 9.
- Read-only projection shell: Tasks 2, 3.
- View menu + toolbar entry: Tasks 6, 7.
- Follow-scroll option: Task 10.
- Capability/config change: Task 11.
- Cross-platform capability gating: Task 12.
- Test strategy and regression safety net: Task 13.

### Placeholder scan

- No `TODO` / `TBD` placeholders remain.
- Each code-changing task includes concrete code snippets or explicit change requirements constrained to existing APIs.

### Type consistency

- `ProjectionStateSyncPayload` and `ProjectionScrollSyncPayload` are defined once in `src/projection/events.ts` and reused everywhere.
- `projectionEnabled`, `projectionFollowScroll`, and `projectionWindowReady` naming is consistent between spec and plan.
- Window label is consistently `projection-preview`.

---

Plan complete and saved to `docs/superpowers/plans/2026-06-13-dual-screen-preview-projection.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?