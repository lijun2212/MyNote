import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import {
  PROJECTION_CLOSED_EVENT,
  type ProjectionErrorPayload,
  type ProjectionLifecyclePayload,
  PROJECTION_ERROR_EVENT,
  PROJECTION_READY_EVENT,
} from "../projection/events";
import { useProjectionStore } from "../store/useProjectionStore";

function matchesProjectionSession(expectedSessionId: number, payload: unknown): payload is ProjectionLifecyclePayload {
  return typeof payload === "object"
    && payload !== null
    && "sessionId" in payload
    && typeof (payload as { sessionId?: unknown }).sessionId === "number"
    && (payload as { sessionId: number }).sessionId === expectedSessionId;
}

export function useProjectionLifecycle() {
  useEffect(() => {
    let disposed = false;
    const pendingUnlisten: Array<() => void> = [];

    const registerListeners = async () => {
      const readyUnlisten = await listen(PROJECTION_READY_EVENT, (event) => {
        const store = useProjectionStore.getState();

        if (!store.projectionSessionRequested || !matchesProjectionSession(store.projectionSessionId, event.payload)) {
          return;
        }

        store.setReady(true);
        store.setEnabled(true);
      });

      if (disposed) {
        readyUnlisten();
      } else {
        pendingUnlisten.push(readyUnlisten);
      }

      const closedUnlisten = await listen(PROJECTION_CLOSED_EVENT, (event) => {
        const store = useProjectionStore.getState();

        if (!store.projectionSessionRequested || !matchesProjectionSession(store.projectionSessionId, event.payload)) {
          return;
        }

        store.markClosed();
      });

      if (disposed) {
        closedUnlisten();
      } else {
        pendingUnlisten.push(closedUnlisten);
      }

      const errorUnlisten = await listen(PROJECTION_ERROR_EVENT, (event) => {
        const store = useProjectionStore.getState();

        if (!store.projectionSessionRequested || !matchesProjectionSession(store.projectionSessionId, event.payload)) {
          return;
        }

        const payload = event.payload as ProjectionErrorPayload;
        store.markClosed();
        store.setError(String(payload.message ?? "投影窗口启动失败"));
      });

      if (disposed) {
        errorUnlisten();
      } else {
        pendingUnlisten.push(errorUnlisten);
      }
    };

    void registerListeners();

    return () => {
      disposed = true;
      for (const unlisten of pendingUnlisten) {
        unlisten();
      }
    };
  }, []);
}