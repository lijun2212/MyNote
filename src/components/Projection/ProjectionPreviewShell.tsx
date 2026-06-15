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
    <main
      data-testid="projection-preview-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflow: "hidden",
          padding: "32px",
        }}
      >
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