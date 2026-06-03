import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSearchResult } from "../test/testData";
import { useSearchSessionStore } from "./useSearchSessionStore";

const STORAGE_KEY = "mynote-search-session-history";

describe("useSearchSessionStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useSearchSessionStore.getState().resetForTest();
  });

  it("deduplicates recent queries and moves the newest one to the front", () => {
    const store = useSearchSessionStore.getState();

    store.recordQuery("nacos");
    store.recordQuery("agent");
    store.recordQuery("nacos");

    expect(useSearchSessionStore.getState().recentQueries).toEqual(["nacos", "agent"]);
  });

  it("creates a search session with results and current index", () => {
    const results = [
      makeSearchResult({ note_id: "n1", path: "notes/a.md" }),
      makeSearchResult({ note_id: "n2", path: "notes/b.md" }),
    ];

    useSearchSessionStore.getState().startSession({
      query: "nacos",
      results,
      currentIndex: 1,
    });

    expect(useSearchSessionStore.getState().session).toMatchObject({
      query: "nacos",
      currentIndex: 1,
      active: true,
    });
    expect(useSearchSessionStore.getState().session?.results).toHaveLength(2);
  });

  it("deduplicates recent hits by query and hit location", () => {
    const result = makeSearchResult({
      note_id: "note-1",
      title: "First Note",
      path: "notes/first.md",
      line_start: 8,
      occurrence_order: 2,
    });

    useSearchSessionStore.getState().recordOpenedHit("nacos", result);
    useSearchSessionStore.getState().recordOpenedHit("nacos", result);

    expect(useSearchSessionStore.getState().recentHits).toHaveLength(1);
    expect(useSearchSessionStore.getState().recentHits[0]).toMatchObject({
      query: "nacos",
      note_id: "note-1",
      snippet: result.snippet,
    });
  });

  it("removes individual history items and clears each history section without affecting session", () => {
    const resultA = makeSearchResult({
      note_id: "note-1",
      title: "First Note",
      path: "notes/first.md",
      line_start: 8,
      occurrence_order: 1,
    });
    const resultB = makeSearchResult({
      note_id: "note-2",
      title: "Second Note",
      path: "notes/second.md",
      line_start: 12,
      occurrence_order: 2,
    });
    const store = useSearchSessionStore.getState() as ReturnType<typeof useSearchSessionStore.getState> & {
      removeRecentQuery: (query: string) => void;
      clearRecentQueries: () => void;
      removeRecentHit: (query: string, noteId: string, lineStart: number, occurrenceOrder: number) => void;
      clearRecentHits: () => void;
    };

    store.recordQuery("alpha");
    store.recordQuery("beta");
    store.recordOpenedHit("alpha", resultA);
    store.recordOpenedHit("beta", resultB);
    store.startSession({
      query: "beta",
      results: [resultA, resultB],
      currentIndex: 1,
    });

    store.removeRecentQuery("alpha");
    expect(useSearchSessionStore.getState().recentQueries).toEqual(["beta"]);

    store.removeRecentHit("alpha", "note-1", 8, 1);
    expect(useSearchSessionStore.getState().recentHits).toEqual([
      expect.objectContaining({ query: "beta", note_id: "note-2" }),
    ]);

    store.clearRecentQueries();
    expect(useSearchSessionStore.getState().recentQueries).toEqual([]);
    expect(useSearchSessionStore.getState().recentHits).toHaveLength(1);

    store.clearRecentHits();
    expect(useSearchSessionStore.getState().recentHits).toEqual([]);
    expect(useSearchSessionStore.getState().session).toMatchObject({
      query: "beta",
      currentIndex: 1,
      active: true,
    });
  });

  it("clamps the current index within the session result range", () => {
    const results = [
      makeSearchResult({ note_id: "n1", path: "notes/a.md" }),
      makeSearchResult({ note_id: "n2", path: "notes/b.md" }),
    ];

    useSearchSessionStore.getState().startSession({
      query: "nacos",
      results,
      currentIndex: 0,
    });

    useSearchSessionStore.getState().setCurrentIndex(99);
    expect(useSearchSessionStore.getState().session?.currentIndex).toBe(1);

    useSearchSessionStore.getState().setCurrentIndex(-5);
    expect(useSearchSessionStore.getState().session?.currentIndex).toBe(0);
  });

  it("falls back safely when persisted session data is malformed", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      recentQueries: ["nacos", 123, null],
      recentHits: [],
      session: {
        query: "nacos",
        results: [{ bogus: true }],
        currentIndex: 99,
        active: true,
      },
    }));

    vi.resetModules();
    const { useSearchSessionStore: reloadedStore } = await import("./useSearchSessionStore");

    expect(reloadedStore.getState().recentQueries).toEqual(["nacos"]);
    expect(reloadedStore.getState().session).toBeNull();
    reloadedStore.getState().resetForTest();
  });

  it("falls back safely when localStorage is unavailable", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });

    vi.resetModules();
    const { useSearchSessionStore: reloadedStore } = await import("./useSearchSessionStore");

    expect(reloadedStore.getState().recentQueries).toEqual([]);
    expect(reloadedStore.getState().recentHits).toEqual([]);
    expect(reloadedStore.getState().session).toBeNull();

    reloadedStore.getState().recordQuery("nacos");
    expect(reloadedStore.getState().recentQueries).toEqual(["nacos"]);

    if (originalDescriptor) {
      Object.defineProperty(window, "localStorage", originalDescriptor);
    }
    reloadedStore.getState().resetForTest();
  });
});