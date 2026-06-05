import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchOverlay } from "./SearchOverlay";
import { makeSearchResult } from "../test/testData";
import type { SearchResult } from "../types";
import { useEditorStore } from "../store/useEditorStore";
import { useSearchSessionStore } from "../store/useSearchSessionStore";

const searchState = vi.hoisted((): { results: SearchResult[]; isLoading: boolean } => ({
  results: [],
  isLoading: false,
}));

const hookMocks = vi.hoisted(() => ({
  useSearch: vi.fn(),
  openNote: vi.fn(),
  beginOpenNote: vi.fn(),
  isOpenNoteRequestCurrent: vi.fn(),
}));

vi.mock("../hooks/useSearch", () => ({
  useSearch: hookMocks.useSearch,
}));

vi.mock("../hooks/useOpenNote", () => ({
  useOpenNote: () => ({
    openNote: hookMocks.openNote,
    beginOpenNote: hookMocks.beginOpenNote,
    isOpenNoteRequestCurrent: hookMocks.isOpenNoteRequestCurrent,
  }),
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
  hookMocks.openNote.mockImplementation(async (path: string) => {
    useEditorStore.setState({
      currentNote: {
        id: path,
        path,
        title: path.split("/").pop() ?? path,
        summary: null,
        content_hash: "hash",
        word_count: 0,
        created_at: "2026-06-03T00:00:00Z",
        updated_at: "2026-06-03T00:00:00Z",
        indexed_at: "2026-06-03T00:00:00Z",
        deleted_at: null,
      },
    });
  });
  hookMocks.beginOpenNote.mockReset();
  hookMocks.beginOpenNote.mockReturnValue(101);
  hookMocks.isOpenNoteRequestCurrent.mockReset();
  hookMocks.isOpenNoteRequestCurrent.mockReturnValue(true);
  useEditorStore.setState({ currentNote: null, searchNavigationTarget: null });
  useSearchSessionStore.getState().resetForTest();
});

describe("SearchOverlay", () => {
  it("focuses the search input on mount", () => {
    renderSearchOverlay();

    expect(screen.getByPlaceholderText("输入关键词搜索笔记")).toHaveFocus();
  });

  it("shows recent queries and recent hits when query is empty, and restores query from history", async () => {
    const user = userEvent.setup();
    useSearchSessionStore.setState({
      recentQueries: ["alpha", "beta"],
      recentHits: [
        {
          query: "project",
          note_id: "note-project",
          note_title: "Project Plan",
          note_path: "notes/project.md",
          line_start: 7,
          line_end: 7,
          occurrence_order: 1,
          snippet: "Plan <mark>project</mark>",
          source: "body",
        },
      ],
    });

    renderSearchOverlay();

    const input = screen.getByPlaceholderText("输入关键词搜索笔记");

    expect(screen.getByText("最近搜索")).toBeInTheDocument();
    expect(screen.getByText("最近查看命中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复最近查看命中 Project Plan" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "alpha" }));
    expect(input).toHaveValue("alpha");

    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "恢复最近查看命中 Project Plan" }));
    expect(input).toHaveValue("project");
  });

  it("styles history delete buttons like notebook delete actions and updates on hover", async () => {
    const user = userEvent.setup();
    useSearchSessionStore.setState({
      recentQueries: ["alpha"],
      recentHits: [
        {
          query: "project",
          note_id: "note-project",
          note_title: "Project Plan",
          note_path: "notes/project.md",
          line_start: 7,
          line_end: 7,
          occurrence_order: 1,
          snippet: "Plan <mark>project</mark>",
          source: "body",
        },
      ],
    });

    renderSearchOverlay();

    const queryDeleteButton = screen.getByLabelText("删除最近搜索 alpha", { selector: "button" });
    const hitDeleteButton = screen.getByLabelText("删除最近查看命中 Project Plan", { selector: "button" });
    const queryHistoryButton = screen.getByRole("button", { name: "alpha" });

    expect(queryDeleteButton).not.toBeVisible();
    expect(hitDeleteButton).toHaveTextContent("×");

    await user.hover(queryHistoryButton);

    expect(queryDeleteButton).toHaveTextContent("×");
    expect(queryDeleteButton).toBeVisible();
    expect(queryDeleteButton).toHaveStyle({
      width: "22px",
      height: "22px",
      borderRadius: "999px",
      border: "1px solid #93c5fd",
      background: "#eff6ff",
      color: "#334155",
    });

    await user.unhover(queryHistoryButton);
    expect(queryDeleteButton).not.toBeVisible();
  });

  it("only shows history delete buttons while hovering the target history item", async () => {
    const user = userEvent.setup();
    useSearchSessionStore.setState({
      recentQueries: ["alpha"],
      recentHits: [
        {
          query: "project",
          note_id: "note-project",
          note_title: "Project Plan",
          note_path: "notes/project.md",
          line_start: 7,
          line_end: 7,
          occurrence_order: 1,
          snippet: "Plan <mark>project</mark>",
          source: "body",
        },
      ],
    });

    renderSearchOverlay();

    const queryHistoryButton = screen.getByRole("button", { name: "alpha" });
    const hitHistoryButton = screen.getByRole("button", { name: "恢复最近查看命中 Project Plan" });
    const queryDeleteButton = screen.getByLabelText("删除最近搜索 alpha", { selector: "button" });
    const hitDeleteButton = screen.getByLabelText("删除最近查看命中 Project Plan", { selector: "button" });

    expect(queryDeleteButton).not.toBeVisible();
    expect(hitDeleteButton).not.toBeVisible();

    await user.hover(queryHistoryButton);
    expect(queryDeleteButton).toBeVisible();

    await user.unhover(queryHistoryButton);
    expect(queryDeleteButton).not.toBeVisible();

    await user.hover(hitHistoryButton);
    expect(hitDeleteButton).toBeVisible();

    await user.unhover(hitHistoryButton);
    expect(hitDeleteButton).not.toBeVisible();
  });

  it("removes a single recent query and hit without restoring the query", async () => {
    const user = userEvent.setup();
    useSearchSessionStore.setState({
      recentQueries: ["alpha", "beta"],
      recentHits: [
        {
          query: "project",
          note_id: "note-project",
          note_title: "Project Plan",
          note_path: "notes/project.md",
          line_start: 7,
          line_end: 7,
          occurrence_order: 1,
          snippet: "Plan <mark>project</mark>",
          source: "body",
        },
      ],
    });

    renderSearchOverlay();

    const input = screen.getByPlaceholderText("输入关键词搜索笔记");

    const queryDeleteButton = screen.getByLabelText("删除最近搜索 alpha", { selector: "button" });
    await user.hover(screen.getByRole("button", { name: "alpha" }));
    expect(queryDeleteButton).toBeVisible();
    fireEvent.click(queryDeleteButton);
    expect(useSearchSessionStore.getState().recentQueries).toEqual(["beta"]);
    expect(input).toHaveValue("");

    const hitDeleteButton = screen.getByLabelText("删除最近查看命中 Project Plan", { selector: "button" });
    await user.hover(screen.getByRole("button", { name: "恢复最近查看命中 Project Plan" }));
    expect(hitDeleteButton).toBeVisible();
    fireEvent.click(hitDeleteButton);
    expect(useSearchSessionStore.getState().recentHits).toEqual([]);
    expect(input).toHaveValue("");
  });

  it("clears recent queries and recent hits independently", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    useSearchSessionStore.setState({
      recentQueries: ["alpha", "beta"],
      recentHits: [
        {
          query: "project",
          note_id: "note-project",
          note_title: "Project Plan",
          note_path: "notes/project.md",
          line_start: 7,
          line_end: 7,
          occurrence_order: 1,
          snippet: "Plan <mark>project</mark>",
          source: "body",
        },
      ],
    });

    renderSearchOverlay();

    await user.click(screen.getByRole("button", { name: "清空最近搜索" }));
    expect(useSearchSessionStore.getState().recentQueries).toEqual([]);
    expect(useSearchSessionStore.getState().recentHits).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "清空最近查看命中" }));
    expect(useSearchSessionStore.getState().recentHits).toEqual([]);

    confirmSpy.mockRestore();
  });

  it("confirms before clearing recent queries", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    confirmSpy.mockReturnValueOnce(false).mockReturnValueOnce(true);
    useSearchSessionStore.setState({
      recentQueries: ["alpha", "beta"],
      recentHits: [],
    });

    renderSearchOverlay();

    await user.click(screen.getByRole("button", { name: "清空最近搜索" }));
    expect(confirmSpy).toHaveBeenCalledWith("确认清空最近搜索吗？");
    expect(useSearchSessionStore.getState().recentQueries).toEqual(["alpha", "beta"]);

    await user.click(screen.getByRole("button", { name: "清空最近搜索" }));
    expect(useSearchSessionStore.getState().recentQueries).toEqual([]);

    confirmSpy.mockRestore();
  });

  it("confirms before clearing recent hits", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    confirmSpy.mockReturnValueOnce(false).mockReturnValueOnce(true);
    useSearchSessionStore.setState({
      recentQueries: [],
      recentHits: [
        {
          query: "project",
          note_id: "note-project",
          note_title: "Project Plan",
          note_path: "notes/project.md",
          line_start: 7,
          line_end: 7,
          occurrence_order: 1,
          snippet: "Plan <mark>project</mark>",
          source: "body",
        },
      ],
    });

    renderSearchOverlay();

    await user.click(screen.getByRole("button", { name: "清空最近查看命中" }));
    expect(confirmSpy).toHaveBeenCalledWith("确认清空最近查看命中吗？");
    expect(useSearchSessionStore.getState().recentHits).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "清空最近查看命中" }));
    expect(useSearchSessionStore.getState().recentHits).toEqual([]);

    confirmSpy.mockRestore();
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

    expect(hookMocks.beginOpenNote).toHaveBeenCalledTimes(1);
    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/first.md", 101);
    expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
      note_id: "note1",
      note_path: "notes/first.md",
      note_title: "First Note",
      line_start: 3,
      line_end: 3,
      occurrence_order: 1,
      match_text: "note",
      source: "body",
      context_snippet: "A <mark>note</mark> result",
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("opens the clicked result and stores navigation target", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    setSearchResults([
      makeSearchResult({ note_id: "note1", title: "First Note", path: "notes/first.md" }),
      makeSearchResult({ note_id: "note2", title: "Second Note", path: "notes/second.md", line_start: 12, line_end: 12 }),
    ]);
    renderSearchOverlay(onClose);

    await user.click(screen.getByText("Second Note"));

    expect(hookMocks.beginOpenNote).toHaveBeenCalledTimes(1);
    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/second.md", 101);
    expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
      note_id: "note2",
      note_path: "notes/second.md",
      note_title: "Second Note",
      line_start: 12,
      line_end: 12,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("records recent query and opened hit, then starts a session when opening a result", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const results = [
      makeSearchResult({ note_id: "note1", title: "First Note", path: "notes/first.md" }),
      makeSearchResult({ note_id: "note2", title: "Second Note", path: "notes/second.md", line_start: 12, line_end: 12 }),
    ];
    setSearchResults(results);
    renderSearchOverlay(onClose);

    await user.type(screen.getByPlaceholderText("输入关键词搜索笔记"), "alpha");
    await user.click(screen.getByText("Second Note"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    expect(useSearchSessionStore.getState().recentQueries).toEqual(["alpha"]);
    expect(useSearchSessionStore.getState().recentHits).toEqual([
      expect.objectContaining({
        query: "alpha",
        note_id: "note2",
        note_title: "Second Note",
        note_path: "notes/second.md",
        line_start: 12,
        line_end: 12,
        occurrence_order: 1,
        source: "body",
      }),
    ]);
    expect(useSearchSessionStore.getState().session).toEqual({
      query: "alpha",
      results,
      currentIndex: 1,
      active: true,
    });
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

    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/second.md", 101);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("renders hit location hints for title and body matches", async () => {
    const user = userEvent.setup();
    setSearchResults([
      makeSearchResult({
        note_id: "note1",
        title: "Title Match",
        source: "title",
        snippet: "<mark>Alpha</mark> title",
      }),
      makeSearchResult({
        note_id: "note1",
        title: "Body Match",
        line_start: 12,
        line_end: 12,
        occurrence_order: 2,
        source: "body",
        snippet: "Body <mark>Alpha</mark>",
      }),
    ]);

    renderSearchOverlay();

    await user.type(screen.getByPlaceholderText("输入关键词搜索笔记"), "alpha");

    expect(screen.getByText("标题命中")).toBeInTheDocument();
    expect(screen.getByText("第 12 行")).toBeInTheDocument();
  });

  it("surfaces an explicit open-target action for link hits", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    setSearchResults([
      makeSearchResult({
        note_id: "source-note",
        title: "Source Note",
        path: "notes/source.md",
        line_start: 8,
        line_end: 8,
        source: "link",
        snippet: "See [[<mark>Target</mark> Note]] for details",
        link_target_path: "notes/target.md",
        link_target_title: "Target Note",
        link_target_href: "[[Target Note]]",
      }),
    ]);

    renderSearchOverlay(onClose);

    await user.type(screen.getByPlaceholderText("输入关键词搜索笔记"), "Target");

    expect(screen.getByText("链接命中")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开目标笔记 Target Note" }));

    expect(hookMocks.beginOpenNote).toHaveBeenCalledTimes(1);
    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/target.md", 101);
    expect(useEditorStore.getState().searchNavigationTarget).toBeNull();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("does not close or store navigation when the open request is stale", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    hookMocks.isOpenNoteRequestCurrent.mockReturnValue(false);
    setSearchResults([
      makeSearchResult({ note_id: "note1", title: "First Note", path: "notes/first.md" }),
    ]);

    renderSearchOverlay(onClose);

    await user.keyboard("{Enter}");

    expect(hookMocks.openNote).toHaveBeenCalledWith("notes/first.md", 101);
    expect(useEditorStore.getState().searchNavigationTarget).toBeNull();
    expect(useSearchSessionStore.getState().recentHits).toEqual([]);
    expect(useSearchSessionStore.getState().session).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close or store search session when the note fails to open", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    hookMocks.openNote.mockImplementation(async () => {
      // Simulate openNote resolving without updating editor state.
    });
    setSearchResults([
      makeSearchResult({ note_id: "note1", title: "First Note", path: "notes/first.md" }),
    ]);

    renderSearchOverlay(onClose);

    await user.type(screen.getByPlaceholderText("输入关键词搜索笔记"), "alpha");
    await user.keyboard("{Enter}");

    expect(useEditorStore.getState().searchNavigationTarget).toBeNull();
    expect(useSearchSessionStore.getState().recentHits).toEqual([]);
    expect(useSearchSessionStore.getState().session).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("records only stable non-empty queries", async () => {
    vi.useFakeTimers();
    try {
      renderSearchOverlay();

      const input = screen.getByPlaceholderText("输入关键词搜索笔记");
      fireEvent.change(input, { target: { value: "  alpha  " } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(useSearchSessionStore.getState().recentQueries).toEqual(["alpha"]);

      fireEvent.change(input, { target: { value: "   " } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(useSearchSessionStore.getState().recentQueries).toEqual(["alpha"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not search with unfinished IME composition text until composition ends", () => {
    renderSearchOverlay();

    const input = screen.getByPlaceholderText("输入关键词搜索笔记");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "na co" } });

    expect(input).toHaveValue("na co");
    expect(hookMocks.useSearch.mock.lastCall?.[0]).toBe("");

    fireEvent.compositionEnd(input, { data: "naco" });

    expect(hookMocks.useSearch.mock.lastCall?.[0]).toBe("na co");
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