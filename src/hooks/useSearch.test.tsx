import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSearch } from "./useSearch";
import { useAppStore } from "../store/useAppStore";
import { deferred, makeKnowledgeBase, makeSearchResult } from "../test/testData";
import type { SearchResult } from "../types";

const invokeMock = vi.mocked(invoke);

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useSearch", () => {
  it("returns empty results for a blank query without invoking search", () => {
    vi.useFakeTimers();
    useAppStore.setState({ kb: makeKnowledgeBase() });

    const { result } = renderHook(() => useSearch("   "));

    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not enter loading for a non-empty query when no knowledge base is open", () => {
    vi.useFakeTimers();
    useAppStore.setState({ kb: null });

    const { result } = renderHook(() => useSearch("alpha"));

    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("debounces a non-empty query for 300ms before invoking search and populating results", async () => {
    vi.useFakeTimers();
    const kb = makeKnowledgeBase({ id: "kb1" });
    const searchResults = [
      makeSearchResult({
        note_id: "note2",
        title: "Second hit",
        summary: "A concise lookback summary",
        line_start: 8,
        occurrence_order: 2,
        score: 0.25,
      }),
      makeSearchResult({
        note_id: "note1",
        title: "Alpha",
        line_start: 2,
        occurrence_order: 1,
        score: -8.5,
        source: "title",
      }),
    ];
    useAppStore.setState({ kb });
    invokeMock.mockResolvedValueOnce(searchResults);

    const { result } = renderHook(() => useSearch("alpha"));

    expect(result.current.isLoading).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });

    expect(invokeMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(invokeMock).toHaveBeenCalledWith("search_notes", { query: "alpha", kbId: "kb1" });
    await flushMicrotasks();
    expect(result.current.results).toEqual(searchResults);
    expect(result.current.results[0]).toMatchObject({
      summary: "A concise lookback summary",
      line_start: 8,
      occurrence_order: 2,
      match_text: "note",
      source: "body",
      score: 0.25,
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("does not let an older search result overwrite a newer query result", async () => {
    vi.useFakeTimers();
    useAppStore.setState({ kb: makeKnowledgeBase({ id: "kb1" }) });
    const olderSearch = deferred<SearchResult[]>();
    const newerSearch = deferred<SearchResult[]>();
    const olderResults = [makeSearchResult({ note_id: "older", title: "Older" })];
    const newerResults = [makeSearchResult({ note_id: "newer", title: "Newer" })];
    invokeMock.mockReturnValueOnce(olderSearch.promise).mockReturnValueOnce(newerSearch.promise);

    const { result, rerender } = renderHook(({ query }) => useSearch(query), {
      initialProps: { query: "older" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(invokeMock).toHaveBeenCalledWith("search_notes", { query: "older", kbId: "kb1" });

    rerender({ query: "newer" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(invokeMock).toHaveBeenCalledWith("search_notes", { query: "newer", kbId: "kb1" });

    await act(async () => {
      newerSearch.resolve(newerResults);
      await newerSearch.promise;
    });

    await flushMicrotasks();
    expect(result.current.results).toEqual(newerResults);
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      olderSearch.resolve(olderResults);
      await olderSearch.promise;
    });

    expect(result.current.results).toEqual(newerResults);
    expect(result.current.isLoading).toBe(false);
  });

  it("does not let a pending result after a knowledge base change overwrite current results", async () => {
    vi.useFakeTimers();
    const firstKb = makeKnowledgeBase({ id: "kb1" });
    const secondKb = makeKnowledgeBase({ id: "kb2" });
    const firstSearch = deferred<SearchResult[]>();
    const secondSearch = deferred<SearchResult[]>();
    const firstResults = [makeSearchResult({ note_id: "kb1-note", title: "First KB" })];
    const secondResults = [makeSearchResult({ note_id: "kb2-note", title: "Second KB" })];
    useAppStore.setState({ kb: firstKb });
    invokeMock.mockReturnValueOnce(firstSearch.promise).mockReturnValueOnce(secondSearch.promise);

    const { result } = renderHook(() => useSearch("shared query"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(invokeMock).toHaveBeenCalledWith("search_notes", { query: "shared query", kbId: "kb1" });

    act(() => {
      useAppStore.getState().setKb(secondKb);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(invokeMock).toHaveBeenCalledWith("search_notes", { query: "shared query", kbId: "kb2" });

    await act(async () => {
      secondSearch.resolve(secondResults);
      await secondSearch.promise;
    });

    await flushMicrotasks();
    expect(result.current.results).toEqual(secondResults);
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      firstSearch.resolve(firstResults);
      await firstSearch.promise;
    });

    expect(result.current.results).toEqual(secondResults);
    expect(result.current.isLoading).toBe(false);
  });
});