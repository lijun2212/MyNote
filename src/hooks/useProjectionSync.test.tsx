import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROJECTION_SCROLL_SYNC_EVENT,
  PROJECTION_STATE_REQUEST_EVENT,
  PROJECTION_STATE_SYNC_EVENT,
} from "../projection/events";
import { useProjectionStore } from "../store/useProjectionStore";
import { useProjectionSync } from "./useProjectionSync";
import { tauriMocks } from "../test/setup";

const projectionWindowApiMocks = vi.hoisted(() => ({
  emitProjectionState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../projection/windowApi", () => ({
  emitProjectionState: projectionWindowApiMocks.emitProjectionState,
}));

function makeSearchNavigationTarget() {
  return {
    note_id: "note-1",
    note_path: "notes/demo.md",
    note_title: "Demo",
    line_start: 3,
    line_end: 3,
    occurrence_order: 0,
    match_text: "demo",
    source: "body" as const,
    context_snippet: "demo context",
    revision: 1,
  };
}

function makeTagNavigationTarget() {
  return {
    note_id: "note-1",
    note_path: "notes/demo.md",
    note_title: "Demo",
    note_updated_at: "2026-06-13T00:00:00.000Z",
    source: "inline" as const,
    occurrence_order: 0,
    line_start: 4,
    line_end: 4,
    heading_context: "Heading",
    context_snippet: "#demo",
    tag_id: "tag-1",
    tag_name: "demo",
    revision: 1,
  };
}

describe("useProjectionSync", () => {
  beforeEach(() => {
    useProjectionStore.getState().resetForTest();
    projectionWindowApiMocks.emitProjectionState.mockReset();
    projectionWindowApiMocks.emitProjectionState.mockResolvedValue(undefined);
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockResolvedValue(() => undefined);
  });

  it("emits a projection state snapshot when projection is enabled and ready", async () => {
    useProjectionStore.getState().beginSession();
    useProjectionStore.getState().setReady(true);

    renderHook(() => useProjectionSync({
      notePath: "notes/demo.md",
      noteTitle: "Demo",
      content: "# Demo",
      searchNavigationTarget: makeSearchNavigationTarget(),
      tagNavigationTarget: makeTagNavigationTarget(),
    }));

    await waitFor(() => {
      expect(projectionWindowApiMocks.emitProjectionState).toHaveBeenCalledWith(
        PROJECTION_STATE_SYNC_EVENT,
        expect.objectContaining({
          sessionId: 1,
          revision: 1,
          notePath: "notes/demo.md",
          noteTitle: "Demo",
          content: "# Demo",
        }),
      );
    });
  });

  it("does not emit a projection state snapshot when no projection session is active", async () => {
    renderHook(() => useProjectionSync({
      notePath: "notes/demo.md",
      noteTitle: "Demo",
      content: "# Demo",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
    }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(projectionWindowApiMocks.emitProjectionState).not.toHaveBeenCalled();
  });

  it("emits the initial projection state snapshot for a newly requested session before ready", async () => {
    useProjectionStore.getState().beginSession();

    renderHook(() => useProjectionSync({
      notePath: "notes/demo.md",
      noteTitle: "Demo",
      content: "# Demo",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
    }));

    await waitFor(() => {
      expect(projectionWindowApiMocks.emitProjectionState).toHaveBeenCalledWith(
        PROJECTION_STATE_SYNC_EVENT,
        expect.objectContaining({
          sessionId: 1,
          revision: 1,
          notePath: "notes/demo.md",
          noteTitle: "Demo",
          content: "# Demo",
        }),
      );
    });
  });

  it("emits scroll sync only when follow-scroll remains enabled", async () => {
    useProjectionStore.getState().beginSession();
    useProjectionStore.getState().setReady(true);

    const { result } = renderHook(() => useProjectionSync({
      notePath: "notes/demo.md",
      noteTitle: "Demo",
      content: "# Demo",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
    }));

    await waitFor(() => {
      expect(projectionWindowApiMocks.emitProjectionState).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      result.current.syncProjectionScroll("main-editor", 12);
    });

    expect(projectionWindowApiMocks.emitProjectionState).toHaveBeenLastCalledWith(
      PROJECTION_SCROLL_SYNC_EVENT,
      {
        sessionId: 1,
        revision: 1,
        source: "main-editor",
        topVisibleLine: 12,
      },
    );

    act(() => {
      useProjectionStore.getState().setFollowScroll(false);
    });

    await act(async () => {
      result.current.syncProjectionScroll("main-preview", 18);
    });

    expect(projectionWindowApiMocks.emitProjectionState).toHaveBeenCalledTimes(2);
  });

  it("records a sync error when projection state sync fails", async () => {
    projectionWindowApiMocks.emitProjectionState.mockRejectedValueOnce(new Error("同步失败"));
    useProjectionStore.getState().beginSession();
    useProjectionStore.getState().setReady(true);

    renderHook(() => useProjectionSync({
      notePath: "notes/demo.md",
      noteTitle: "Demo",
      content: "# Demo",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
    }));

    await waitFor(() => {
      expect(useProjectionStore.getState().projectionLastError).toBe("同步失败");
    });
  });

  it("replays the current projection state when the projection window requests it after mount", async () => {
    useProjectionStore.getState().beginSession();

    let requestHandler: (() => void) | undefined;
    tauriMocks.listen.mockImplementation(async (eventName: string, handler: unknown) => {
      if (eventName === PROJECTION_STATE_REQUEST_EVENT) {
        requestHandler = handler as () => void;
      }

      return () => undefined;
    });

    renderHook(() => useProjectionSync({
      notePath: "notes/demo.md",
      noteTitle: "Demo",
      content: "# Demo",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
    }));

    await waitFor(() => {
      expect(projectionWindowApiMocks.emitProjectionState).toHaveBeenCalledWith(
        PROJECTION_STATE_SYNC_EVENT,
        expect.objectContaining({
          sessionId: 1,
          revision: 1,
          notePath: "notes/demo.md",
          noteTitle: "Demo",
          content: "# Demo",
        }),
      );
    });

    await act(async () => {
      requestHandler?.();
    });

    expect(projectionWindowApiMocks.emitProjectionState).toHaveBeenLastCalledWith(
      PROJECTION_STATE_SYNC_EVENT,
      expect.objectContaining({
        sessionId: 1,
        revision: 2,
        notePath: "notes/demo.md",
        noteTitle: "Demo",
        content: "# Demo",
      }),
    );
  });
});