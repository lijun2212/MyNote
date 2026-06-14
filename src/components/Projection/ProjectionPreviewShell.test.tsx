import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenuHost } from "../ContextMenu/ContextMenuHost";
import { ContextMenuProvider } from "../ContextMenu/useContextMenu";
import {
  PROJECTION_CLOSED_EVENT,
  PROJECTION_READY_EVENT,
  PROJECTION_SCROLL_SYNC_EVENT,
  PROJECTION_STATE_SYNC_EVENT,
} from "../../projection/events";
import { useProjectionStore } from "../../store/useProjectionStore";
import { tauriMocks } from "../../test/setup";

type ProjectionStateSyncHandler = (event: { payload: {
  sessionId: number;
  revision: number;
  notePath: string | null;
  noteTitle: string | null;
  content: string;
  searchNavigationTarget: null;
  tagNavigationTarget: null;
} }) => void;

type ProjectionScrollSyncHandler = (event: { payload: {
  sessionId: number;
  revision: number;
  source: "main-editor" | "main-preview";
  topVisibleLine: number;
} }) => void;

describe("ProjectionPreviewShell", () => {
  beforeEach(() => {
    useProjectionStore.getState().resetForTest();
  });

  it("renders the projection shell for the projection window role and passes projectionMode to MarkdownPreview", async () => {
    vi.resetModules();

    vi.doMock("../../projection/windowRole", () => ({
      getCurrentWindowRole: () => "projection-preview",
    }));
    vi.doMock("../EditorWorkspace/MarkdownPreview", () => ({
      MarkdownPreview: (props: { projectionMode?: boolean; sourceLineSyncSignal?: { line: number; revision: number } | null }) => (
        <div
          data-line={String(props.sourceLineSyncSignal?.line ?? "")}
          data-projection-mode={String(props.projectionMode)}
          data-revision={String(props.sourceLineSyncSignal?.revision ?? "")}
          data-testid="projection-markdown-preview"
        />
      ),
    }));

    const { default: App } = await import("../../App");

    render(<App />);

    expect(screen.getByTestId("projection-preview-shell")).toBeInTheDocument();
    expect(screen.getByTestId("projection-markdown-preview")).toHaveAttribute("data-projection-mode", "true");
  });

  it("hydrates the shell when a projection sync event arrives and emits ready/closed lifecycle events", async () => {
    vi.resetModules();
    const { ProjectionPreviewShell } = await import("./ProjectionPreviewShell");
    const { useProjectionStore: projectionStore } = await import("../../store/useProjectionStore");
    projectionStore.getState().resetForTest();

    let syncHandler: ProjectionStateSyncHandler | undefined;
    let scrollHandler: ProjectionScrollSyncHandler | undefined;
    const readyUnlisten = vi.fn();

    tauriMocks.listen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === PROJECTION_STATE_SYNC_EVENT) {
        syncHandler = handler as ProjectionStateSyncHandler;
      } else if (eventName === PROJECTION_SCROLL_SYNC_EVENT) {
        scrollHandler = handler as ProjectionScrollSyncHandler;
      }

      return readyUnlisten;
    });

    const { unmount } = render(
      <ContextMenuProvider>
        <ProjectionPreviewShell />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    await waitFor(() => {
      expect(syncHandler).toBeTypeOf("function");
      expect(scrollHandler).toBeTypeOf("function");
    });

    await act(async () => {
      syncHandler?.({
        payload: {
          sessionId: 7,
          notePath: "notes/demo.md",
          noteTitle: "演示稿",
          content: "# Hello Projection",
          searchNavigationTarget: null,
          tagNavigationTarget: null,
          revision: 1,
        },
      });
    });

    await waitFor(() => {
      expect(tauriMocks.emitTo).toHaveBeenCalledWith(
        "main",
        PROJECTION_READY_EVENT,
        expect.objectContaining({ sessionId: 7 }),
      );
    });

    expect(projectionStore.getState()).toMatchObject({
      projectionSessionId: 7,
      notePath: "notes/demo.md",
      noteTitle: "演示稿",
      content: "# Hello Projection",
      lastRevision: 1,
    });
    expect(screen.getByTestId("projection-markdown-preview")).toBeInTheDocument();

    await act(async () => {
      scrollHandler?.({
        payload: {
          sessionId: 7,
          revision: 5,
          source: "main-preview",
          topVisibleLine: 22,
        },
      });
    });

    expect(screen.getByTestId("projection-markdown-preview")).toHaveAttribute("data-line", "22");
    expect(screen.getByTestId("projection-markdown-preview")).toHaveAttribute("data-revision", "5");

    unmount();

    expect(readyUnlisten).toHaveBeenCalledTimes(2);
    expect(tauriMocks.emitTo).toHaveBeenCalledWith(
      "main",
      PROJECTION_CLOSED_EVENT,
      expect.objectContaining({ sessionId: 7 }),
    );
  });

  it("does not apply a scroll sync event before the shell learns the active projection session", async () => {
    vi.resetModules();
    vi.doMock("../EditorWorkspace/MarkdownPreview", () => ({
      MarkdownPreview: (props: { sourceLineSyncSignal?: { line: number; revision: number } | null }) => (
        <div
          data-line={String(props.sourceLineSyncSignal?.line ?? "")}
          data-revision={String(props.sourceLineSyncSignal?.revision ?? "")}
          data-testid="projection-markdown-preview"
        />
      ),
    }));

    const { ProjectionPreviewShell } = await import("./ProjectionPreviewShell");

    let scrollHandler: ProjectionScrollSyncHandler | undefined;

    tauriMocks.listen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === PROJECTION_SCROLL_SYNC_EVENT) {
        scrollHandler = handler as ProjectionScrollSyncHandler;
      }

      return () => undefined;
    });

    render(
      <ContextMenuProvider>
        <ProjectionPreviewShell />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    await waitFor(() => {
      expect(scrollHandler).toBeTypeOf("function");
    });

    await act(async () => {
      scrollHandler?.({
        payload: {
          sessionId: 1,
          revision: 3,
          source: "main-editor",
          topVisibleLine: 18,
        },
      });
    });

    expect(screen.getByTestId("projection-markdown-preview")).toHaveAttribute("data-line", "");
    expect(screen.getByTestId("projection-markdown-preview")).toHaveAttribute("data-revision", "");
  });

  it("keeps projection preview read-only while still opening external links and suppressing internal navigation side effects", async () => {
    vi.resetModules();
    vi.doUnmock("../EditorWorkspace/MarkdownPreview");
    vi.doUnmock("../../store/useAppStore");
    const { ProjectionPreviewShell } = await import("./ProjectionPreviewShell");

    let syncHandler: ProjectionStateSyncHandler | undefined;
    let scrollHandler: ProjectionScrollSyncHandler | undefined;

    tauriMocks.listen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === PROJECTION_STATE_SYNC_EVENT) {
        syncHandler = handler as ProjectionStateSyncHandler;
      } else if (eventName === PROJECTION_SCROLL_SYNC_EVENT) {
        scrollHandler = handler as ProjectionScrollSyncHandler;
      }

      return () => undefined;
    });

    const { container } = render(
      <ContextMenuProvider>
        <ProjectionPreviewShell />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    await act(async () => {
      syncHandler?.({
        payload: {
          sessionId: 9,
          notePath: "notes/projection.md",
          noteTitle: "Projection",
          content: [
            "[External](https://example.com)",
            "",
            "[Internal](notes/linked-note.md)",
            "",
            "| A | B |",
            "| --- | --- |",
            "| left | right |",
          ].join("\n"),
          searchNavigationTarget: null,
          tagNavigationTarget: null,
          revision: 1,
        },
      });
    });

    expect(scrollHandler).toBeTypeOf("function");

    const previewContent = screen.getByTestId("markdown-preview-content");
    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 80,
    });
    previewContent.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "返回编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "显示侧栏" })).not.toBeInTheDocument();

    const externalLink = screen.getByRole("link", { name: "External" });
    const externalClickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    externalLink.dispatchEvent(externalClickEvent);
    expect(externalClickEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://example.com");
    });

    const internalLink = screen.getByRole("link", { name: "Internal" });
    const internalClickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    internalLink.dispatchEvent(internalClickEvent);
    expect(internalClickEvent.defaultPrevented).toBe(true);

    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(1);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".markdown-table-resize-handle")).toHaveLength(0);
  });

  it("throws for invalid injected roles in test mode instead of silently falling back", async () => {
    vi.resetModules();
    vi.doUnmock("../../projection/windowRole");

    const { resolveWindowRole } = await import("../../projection/windowRole");

    expect(() => resolveWindowRole("unexpected-role", "test")).toThrow(
      'Invalid MyNote window role "unexpected-role". Expected "main" or "projection-preview".',
    );
  });

  it("reads the projection role from the URL query when no global role is injected", async () => {
    vi.resetModules();
    vi.doUnmock("../../projection/windowRole");

    const originalHref = window.location.href;
    window.history.replaceState({}, "", "/?windowRole=projection-preview");

    const { getCurrentWindowRole } = await import("../../projection/windowRole");

    expect(getCurrentWindowRole()).toBe("projection-preview");

    window.history.replaceState({}, "", originalHref);
  });

  it("hydrates the projection shell even when the first state snapshot is emitted before the shell mounts", async () => {
    vi.resetModules();
    vi.doMock("../EditorWorkspace/MarkdownPreview", () => ({
      MarkdownPreview: (props: { content: string }) => (
        <div data-content={props.content} data-testid="projection-markdown-preview" />
      ),
    }));

    const projectionEvents = await import("../../projection/events");
    const { useProjectionStore: projectionStore } = await import("../../store/useProjectionStore");
    const { useProjectionSync } = await import("../../hooks/useProjectionSync");
    const { ProjectionPreviewShell } = await import("./ProjectionPreviewShell");

    projectionStore.getState().resetForTest();

    let syncHandler: ProjectionStateSyncHandler | undefined;
    tauriMocks.listen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === projectionEvents.PROJECTION_STATE_SYNC_EVENT) {
        syncHandler = handler as ProjectionStateSyncHandler;
      }

      return () => undefined;
    });

    projectionStore.getState().beginSession();
    renderHookWrapper(() => useProjectionSync({
      notePath: "notes/demo.md",
      noteTitle: "延迟挂载",
      content: "# Late mount snapshot",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
    }));

    tauriMocks.emitTo.mockImplementation(async (label: string, eventName: string, _payload: unknown) => {
      if (label === "main" && eventName === projectionEvents.PROJECTION_STATE_REQUEST_EVENT) {
        syncHandler?.({
          payload: {
            sessionId: 1,
            notePath: "notes/demo.md",
            noteTitle: "延迟挂载",
            content: "# Late mount snapshot",
            searchNavigationTarget: null,
            tagNavigationTarget: null,
            revision: 2,
          },
        });
      }

      return undefined;
    });

    render(
      <ContextMenuProvider>
        <ProjectionPreviewShell />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    await waitFor(() => {
      expect(syncHandler).toBeTypeOf("function");
    });

    await waitFor(() => {
      expect(tauriMocks.emitTo).toHaveBeenCalledWith(
        "main",
        projectionEvents.PROJECTION_STATE_REQUEST_EVENT,
        null,
      );
    });

    expect(screen.getByTestId("projection-markdown-preview")).toHaveAttribute("data-content", "# Late mount snapshot");
  });
});

function renderHookWrapper(callback: () => void) {
  const HookHarness = () => {
    callback();
    return null;
  };

  return render(<HookHarness />);
}