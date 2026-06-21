import { create } from "zustand";
import type { ProjectionStateSyncPayload } from "../projection/events";
import type { SearchNavigationTarget, TagNavigationTarget } from "../types";

interface ProjectionStoreState {
  projectionSessionRequested: boolean;
  projectionSessionId: number;
  projectionEnabled: boolean;
  projectionFollowScroll: boolean;
  projectionWindowReady: boolean;
  projectionLastError: string | null;
  notePath: string | null;
  noteTitle: string | null;
  kbRootPath: string | null;
  content: string;
  searchNavigationTarget: SearchNavigationTarget | null;
  tagNavigationTarget: TagNavigationTarget | null;
  lastRevision: number;
  beginSession: () => number;
  setEnabled: (enabled: boolean) => void;
  setSessionRequested: (requested: boolean) => void;
  setReady: (ready: boolean) => void;
  setFollowScroll: (followScroll: boolean) => void;
  setError: (error: string | null) => void;
  markClosed: () => void;
  applyStateSync: (payload: ProjectionStateSyncPayload) => void;
  resetForTest: () => void;
}

const initialState = {
  projectionSessionRequested: false,
  projectionSessionId: 0,
  projectionEnabled: false,
  projectionFollowScroll: true,
  projectionWindowReady: false,
  projectionLastError: null,
  notePath: null,
  noteTitle: null,
  kbRootPath: null,
  content: "",
  searchNavigationTarget: null,
  tagNavigationTarget: null,
  lastRevision: 0,
};

export const useProjectionStore = create<ProjectionStoreState>((set) => ({
  ...initialState,

  beginSession: () => {
    let nextSessionId = initialState.projectionSessionId;

    set((state) => {
      nextSessionId = state.projectionSessionId + 1;

      return {
        projectionSessionRequested: true,
        projectionSessionId: nextSessionId,
        projectionEnabled: true,
        projectionWindowReady: false,
        projectionLastError: null,
      };
    });

    return nextSessionId;
  },

  setEnabled: (enabled) => set({ projectionEnabled: enabled }),

  setSessionRequested: (requested) => set({ projectionSessionRequested: requested }),

  setReady: (ready) => set({ projectionWindowReady: ready }),

  setFollowScroll: (followScroll) => set({ projectionFollowScroll: followScroll }),

  setError: (error) => set({ projectionLastError: error }),

  markClosed: () => set({
    projectionSessionRequested: false,
    projectionEnabled: false,
    projectionWindowReady: false,
    notePath: initialState.notePath,
    noteTitle: initialState.noteTitle,
    kbRootPath: initialState.kbRootPath,
    content: initialState.content,
    searchNavigationTarget: initialState.searchNavigationTarget,
    tagNavigationTarget: initialState.tagNavigationTarget,
    lastRevision: initialState.lastRevision,
  }),

  applyStateSync: (payload) => set((state) => {
    if (payload.revision < state.lastRevision) {
      return state;
    }

    return {
      projectionSessionId: payload.sessionId,
      notePath: payload.notePath,
      noteTitle: payload.noteTitle,
      kbRootPath: payload.kbRootPath,
      content: payload.content,
      searchNavigationTarget: payload.searchNavigationTarget,
      tagNavigationTarget: payload.tagNavigationTarget,
      lastRevision: payload.revision,
    };
  }),

  resetForTest: () => set(initialState),
}));