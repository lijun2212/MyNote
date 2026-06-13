import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  PROJECTION_SCROLL_SYNC_EVENT,
  PROJECTION_STATE_REQUEST_EVENT,
  PROJECTION_STATE_SYNC_EVENT,
} from "../projection/events";
import { emitProjectionState } from "../projection/windowApi";
import { useProjectionStore } from "../store/useProjectionStore";
import type { SearchNavigationTarget, TagNavigationTarget } from "../types";

type ProjectionScrollSource = "main-editor" | "main-preview";

interface UseProjectionSyncOptions {
  notePath: string | null;
  noteTitle: string | null;
  content: string;
  searchNavigationTarget: SearchNavigationTarget | null;
  tagNavigationTarget: TagNavigationTarget | null;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "投影同步失败";
}

export function useProjectionSync({
  notePath,
  noteTitle,
  content,
  searchNavigationTarget,
  tagNavigationTarget,
}: UseProjectionSyncOptions) {
  const projectionSessionRequested = useProjectionStore((state) => state.projectionSessionRequested);
  const projectionEnabled = useProjectionStore((state) => state.projectionEnabled);
  const projectionSessionId = useProjectionStore((state) => state.projectionSessionId);
  const projectionWindowReady = useProjectionStore((state) => state.projectionWindowReady);
  const revisionRef = useRef(0);

  const emitCurrentProjectionState = useCallback(() => {
    const store = useProjectionStore.getState();

    if (!store.projectionEnabled || !store.projectionSessionRequested) {
      return;
    }

    revisionRef.current += 1;

    void emitProjectionState(PROJECTION_STATE_SYNC_EVENT, {
      sessionId: store.projectionSessionId,
      revision: revisionRef.current,
      notePath,
      noteTitle,
      content,
      searchNavigationTarget,
      tagNavigationTarget,
    }).catch((error) => {
      store.setError(toErrorMessage(error));
    });
  }, [content, notePath, noteTitle, searchNavigationTarget, tagNavigationTarget]);

  useEffect(() => {
    if (!projectionEnabled || (!projectionWindowReady && !projectionSessionRequested)) {
      return;
    }

    emitCurrentProjectionState();
  }, [
    content,
    emitCurrentProjectionState,
    notePath,
    noteTitle,
    projectionEnabled,
    projectionSessionRequested,
    projectionSessionId,
    projectionWindowReady,
    searchNavigationTarget,
    tagNavigationTarget,
  ]);

  useEffect(() => {
    let disposed = false;
    let disposeRequestListener: (() => void) | undefined;

    const registerRequestListener = async () => {
      const unlisten = await listen(PROJECTION_STATE_REQUEST_EVENT, () => {
        emitCurrentProjectionState();
      });

      if (disposed) {
        unlisten();
        return;
      }

      disposeRequestListener = unlisten;
    };

    void registerRequestListener();

    return () => {
      disposed = true;
      disposeRequestListener?.();
    };
  }, [emitCurrentProjectionState]);

  const syncProjectionScroll = useCallback((source: ProjectionScrollSource, topVisibleLine: number) => {
    const store = useProjectionStore.getState();

    if (!store.projectionEnabled || !store.projectionWindowReady || !store.projectionFollowScroll) {
      return;
    }

    void emitProjectionState(PROJECTION_SCROLL_SYNC_EVENT, {
      sessionId: store.projectionSessionId,
      revision: revisionRef.current,
      source,
      topVisibleLine,
    }).catch((error) => {
      store.setError(toErrorMessage(error));
    });
  }, []);

  return {
    syncProjectionScroll,
  };
}