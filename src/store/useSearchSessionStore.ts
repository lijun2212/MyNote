import { create } from "zustand";
import type { SearchHistoryHitItem, SearchResult, SearchSession } from "../types";

const STORAGE_KEY = "mynote-search-session-history";
const MAX_RECENT_QUERIES = 8;
const MAX_RECENT_HITS = 8;

interface SearchSessionStoreState {
  recentQueries: string[];
  recentHits: SearchHistoryHitItem[];
  session: SearchSession | null;
  recordQuery: (query: string) => void;
  removeRecentQuery: (query: string) => void;
  clearRecentQueries: () => void;
  recordOpenedHit: (query: string, result: SearchResult) => void;
  removeRecentHit: (query: string, noteId: string, lineStart: number, occurrenceOrder: number) => void;
  clearRecentHits: () => void;
  startSession: (input: { query: string; results: SearchResult[]; currentIndex: number }) => void;
  setCurrentIndex: (index: number) => void;
  clearSession: () => void;
  resetForTest: () => void;
}

interface PersistedSearchSessionState {
  recentQueries: string[];
  recentHits: SearchHistoryHitItem[];
  session: SearchSession | null;
}

function isSearchHistoryHitItem(value: unknown): value is SearchHistoryHitItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return typeof item.query === "string"
    && typeof item.note_id === "string"
    && typeof item.note_title === "string"
    && typeof item.note_path === "string"
    && typeof item.line_start === "number"
    && typeof item.line_end === "number"
    && typeof item.occurrence_order === "number"
    && typeof item.snippet === "string"
    && (item.source === "title" || item.source === "link" || item.source === "body");
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Record<string, unknown>;
  return typeof result.note_id === "string"
    && typeof result.title === "string"
    && typeof result.path === "string"
    && typeof result.snippet === "string"
    && typeof result.line_start === "number"
    && typeof result.line_end === "number"
    && typeof result.occurrence_order === "number"
    && typeof result.match_text === "string"
    && (result.source === "title" || result.source === "link" || result.source === "body")
    && typeof result.score === "number";
}

function isSearchSession(value: unknown): value is SearchSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Record<string, unknown>;
  const currentIndex = session.currentIndex;
  const results = session.results;
  if (!Array.isArray(results)) {
    return false;
  }

  if (!results.every(isSearchResult)) {
    return false;
  }

  if (typeof currentIndex !== "number" || !Number.isFinite(currentIndex)) {
    return false;
  }

  const maxIndex = results.length - 1;
  const isValidIndex = maxIndex < 0 ? currentIndex === -1 : currentIndex >= 0 && currentIndex <= maxIndex;

  return typeof session.query === "string"
    && isValidIndex
    && typeof session.active === "boolean";
}

const defaultPersistedState = (): PersistedSearchSessionState => ({
  recentQueries: [],
  recentHits: [],
  session: null,
});

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readPersistedState(): PersistedSearchSessionState {
  const storage = getStorage();
  if (!storage) {
    return defaultPersistedState();
  }

  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return defaultPersistedState();
  }

  if (!raw) {
    return defaultPersistedState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSearchSessionState>;
    return {
      recentQueries: Array.isArray(parsed.recentQueries)
        ? parsed.recentQueries.filter((item): item is string => typeof item === "string")
        : [],
      recentHits: Array.isArray(parsed.recentHits)
        ? parsed.recentHits.filter(isSearchHistoryHitItem)
        : [],
      session: isSearchSession(parsed.session) ? parsed.session : null,
    };
  } catch {
    return defaultPersistedState();
  }
}

function persistState(state: PersistedSearchSessionState) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore persistence failures so in-memory state updates still work.
  }
}

function dedupeQueries(recentQueries: string[], query: string) {
  return [query, ...recentQueries.filter((item) => item !== query)].slice(0, MAX_RECENT_QUERIES);
}

function buildRecentHitKey(hit: SearchHistoryHitItem) {
  return [hit.query, hit.note_id, hit.line_start, hit.occurrence_order].join("::");
}

function dedupeHits(recentHits: SearchHistoryHitItem[], hit: SearchHistoryHitItem) {
  const targetKey = buildRecentHitKey(hit);
  return [hit, ...recentHits.filter((item) => buildRecentHitKey(item) !== targetKey)].slice(0, MAX_RECENT_HITS);
}

export const useSearchSessionStore = create<SearchSessionStoreState>((set) => ({
  ...readPersistedState(),

  recordQuery: (query) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return;
    }

    set((state) => {
      const nextState = {
        recentQueries: dedupeQueries(state.recentQueries, normalizedQuery),
      };
      persistState({ ...state, ...nextState });
      return nextState;
    });
  },

  removeRecentQuery: (query) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return;
    }

    set((state) => {
      const nextState = {
        recentQueries: state.recentQueries.filter((item) => item !== normalizedQuery),
      };
      persistState({ ...state, ...nextState });
      return nextState;
    });
  },

  clearRecentQueries: () => {
    set((state) => {
      const nextState = { recentQueries: [] };
      persistState({ ...state, ...nextState });
      return nextState;
    });
  },

  recordOpenedHit: (query, result) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    set((state) => {
      const item: SearchHistoryHitItem = {
        query: trimmedQuery,
        note_id: result.note_id,
        note_title: result.title,
        note_path: result.path,
        line_start: result.line_start,
        line_end: result.line_end,
        occurrence_order: result.occurrence_order,
        snippet: result.snippet,
        source: result.source,
      };
      const nextState = {
        recentHits: dedupeHits(state.recentHits, item),
      };
      persistState({ ...state, ...nextState });
      return nextState;
    });
  },

  removeRecentHit: (query, noteId, lineStart, occurrenceOrder) => {
    const trimmedQuery = query.trim();
    set((state) => {
      const nextState = {
        recentHits: state.recentHits.filter((item) => !(item.query === trimmedQuery
          && item.note_id === noteId
          && item.line_start === lineStart
          && item.occurrence_order === occurrenceOrder)),
      };
      persistState({ ...state, ...nextState });
      return nextState;
    });
  },

  clearRecentHits: () => {
    set((state) => {
      const nextState = { recentHits: [] };
      persistState({ ...state, ...nextState });
      return nextState;
    });
  },

  startSession: ({ query, results, currentIndex }) => {
    const session: SearchSession = {
      query,
      results,
      currentIndex,
      active: true,
    };
    set((state) => {
      const nextState = { session };
      persistState({ ...state, ...nextState });
      return nextState;
    });
  },

  setCurrentIndex: (index) => {
    set((state) => {
      if (!state.session) {
        return state;
      }

      const maxIndex = state.session.results.length - 1;
      const nextIndex = maxIndex < 0 ? -1 : Math.min(Math.max(index, 0), maxIndex);
      const nextState = {
        session: {
          ...state.session,
          currentIndex: nextIndex,
        },
      };
      persistState({ ...state, ...nextState });
      return nextState;
    });
  },

  clearSession: () => {
    set((state) => {
      const nextState = { session: null };
      persistState({ ...state, ...nextState });
      return nextState;
    });
  },

  resetForTest: () => {
    const nextState = defaultPersistedState();
    const storage = getStorage();
    try {
      storage?.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures in restricted environments.
    }
    set(nextState);
  },
}));