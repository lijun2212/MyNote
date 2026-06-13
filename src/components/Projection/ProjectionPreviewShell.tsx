import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { MarkdownPreview } from "../EditorWorkspace/MarkdownPreview";
import {
  PROJECTION_CLOSED_EVENT,
  type ProjectionScrollSyncPayload,
  type ProjectionStateSyncPayload,
  PROJECTION_READY_EVENT,
  PROJECTION_SCROLL_SYNC_EVENT,
  PROJECTION_STATE_REQUEST_EVENT,
  PROJECTION_STATE_SYNC_EVENT,
} from "../../projection/events";
import type { SourceLineSyncSignal } from "../EditorWorkspace/sourceLineSync";
import { useProjectionStore } from "../../store/useProjectionStore";

const MAIN_WINDOW_LABEL = "main";

export function ProjectionPreviewShell() {
  const projectionSessionId = useProjectionStore((state) => state.projectionSessionId);
  const noteTitle = useProjectionStore((state) => state.noteTitle);
  const content = useProjectionStore((state) => state.content);
  const searchNavigationTarget = useProjectionStore((state) => state.searchNavigationTarget);
  const tagNavigationTarget = useProjectionStore((state) => state.tagNavigationTarget);
  const [sourceLineSyncSignal, setSourceLineSyncSignal] = useState<SourceLineSyncSignal | null>(null);
  const lastReadySessionIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    let disposeSync: (() => void) | undefined;
    let disposeScrollSync: (() => void) | undefined;
    let requestedInitialState = false;

    const requestInitialState = () => {
      if (requestedInitialState || !active) {
        return;
      }

      requestedInitialState = true;
      void emitTo(MAIN_WINDOW_LABEL, PROJECTION_STATE_REQUEST_EVENT, null);
    };

    const listenResult = listen<ProjectionStateSyncPayload>(PROJECTION_STATE_SYNC_EVENT, (event) => {
      if (!active) {
        return;
      }

      useProjectionStore.getState().applyStateSync(event.payload);
    });

    if (typeof (listenResult as Promise<() => void> | undefined)?.then === "function") {
      void listenResult.then((unlisten) => {
        if (!active) {
          unlisten();
          return;
        }

        disposeSync = unlisten;
        requestInitialState();
      });
    } else {
      requestInitialState();
    }

    const scrollListenResult = listen<ProjectionScrollSyncPayload>(PROJECTION_SCROLL_SYNC_EVENT, (event) => {
      if (!active) {
        return;
      }

      if (event.payload.sessionId !== useProjectionStore.getState().projectionSessionId) {
        return;
      }

      setSourceLineSyncSignal({
        source: "editor",
        line: event.payload.topVisibleLine,
        revision: event.payload.revision,
      });
    });

    if (typeof (scrollListenResult as Promise<() => void> | undefined)?.then === "function") {
      void scrollListenResult.then((unlisten) => {
        if (!active) {
          unlisten();
          return;
        }

        disposeScrollSync = unlisten;
      });
    }

    return () => {
      active = false;
      disposeSync?.();
      disposeScrollSync?.();

      if (useProjectionStore.getState().projectionSessionId > 0) {
        void emitTo(MAIN_WINDOW_LABEL, PROJECTION_CLOSED_EVENT, {
          sessionId: useProjectionStore.getState().projectionSessionId,
        });
      }
    };
  }, []);

  useEffect(() => {
    if (projectionSessionId <= 0 || projectionSessionId === lastReadySessionIdRef.current) {
      return;
    }

    lastReadySessionIdRef.current = projectionSessionId;

    void emitTo(MAIN_WINDOW_LABEL, PROJECTION_READY_EVENT, {
      sessionId: projectionSessionId,
    });
  }, [projectionSessionId]);

  return (
    <main data-testid="projection-preview-shell" style={{ minHeight: "100vh", background: "#fff" }}>
      <div style={{ padding: "24px 32px" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{noteTitle ?? "投影预览"}</h1>
        <p style={{ margin: "12px 0 0", color: "#5b6472", lineHeight: 1.6 }}>
          当前窗口处于只读投影预览模式。
        </p>
      </div>
      <div style={{ height: "calc(100vh - 110px)", padding: "0 32px 32px" }}>
        <MarkdownPreview
          content={content}
          searchNavigationTarget={searchNavigationTarget}
          tagNavigationTarget={tagNavigationTarget}
          sourceLineSyncSignal={sourceLineSyncSignal}
          projectionMode
        />
      </div>
    </main>
  );
}