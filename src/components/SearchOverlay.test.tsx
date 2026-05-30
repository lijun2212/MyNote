import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchOverlay } from "./SearchOverlay";
import { makeSearchResult } from "../test/testData";
import type { SearchResult } from "../types";

const searchState = vi.hoisted((): { results: SearchResult[]; isLoading: boolean } => ({
  results: [],
  isLoading: false,
}));

const hookMocks = vi.hoisted(() => ({
  useSearch: vi.fn(),
  openNote: vi.fn(),
}));

vi.mock("../hooks/useSearch", () => ({
  useSearch: hookMocks.useSearch,
}));

vi.mock("../hooks/useOpenNote", () => ({
  useOpenNote: () => ({ openNote: hookMocks.openNote }),
}));

function setSearchResults(results: SearchResult[], isLoading = false) {
  searchState.results = results;
  searchState.isLoading = isLoading;
}

function renderSearchOverlay(onClose = vi.fn()) {
  render(<SearchOverlay onClose={onClose} />);
  return { onClose };
}

beforeEach(() => {
  setSearchResults([]);
  hookMocks.useSearch.mockImplementation(() => searchState);
  hookMocks.openNote.mockReset();
  hookMocks.openNote.mockResolvedValue(undefined);
});

describe("SearchOverlay", () => {
  it("focuses the search input on mount", () => {
    renderSearchOverlay();

    expect(screen.getByPlaceholderText("输入关键词搜索笔记")).toHaveFocus();
  });

  it("opens the selected result and closes when Enter is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    setSearchResults([
      makeSearchResult({ note_id: "note1", title: "First Note", path: "notes/first.md" }),
      makeSearchResult({ note_id: "note2", title: "Second Note", path: "notes/second.md" }),
    ]);
    renderSearchOverlay(onClose);

    await user.keyboard("{Enter}");

    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/first.md");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderSearchOverlay(onClose);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("changes the selected result with ArrowDown and ArrowUp before Enter", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    setSearchResults([
      makeSearchResult({ note_id: "note1", title: "First Note", path: "notes/first.md" }),
      makeSearchResult({ note_id: "note2", title: "Second Note", path: "notes/second.md" }),
      makeSearchResult({ note_id: "note3", title: "Third Note", path: "notes/third.md" }),
    ]);
    renderSearchOverlay(onClose);

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");

    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/second.md");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("renders mark snippets as mark elements while leaving other raw HTML as text", () => {
    setSearchResults([
      makeSearchResult({
        note_id: "note1",
        title: "Safe Highlight",
        snippet: "Keep <mark>highlighted</mark> and <img src=x onerror=window.__searchXss=true>",
      }),
    ]);

    const { container } = render(<SearchOverlay onClose={vi.fn()} />);

    expect(screen.getByText("highlighted").tagName).toBe("MARK");
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=window\.__searchXss=true>/)).toBeInTheDocument();
  });
});