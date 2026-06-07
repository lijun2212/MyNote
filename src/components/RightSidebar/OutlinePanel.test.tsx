import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlinePanel } from "./OutlinePanel";
import { useEditorStore } from "../../store/useEditorStore";
import type { Note, NoteOutlineItem } from "../../types";

const apiMocks = vi.hoisted(() => ({
  getNoteOutline: vi.fn(),
}));

vi.mock("../../api/commands", () => ({
  api: apiMocks,
}));

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    path: "notes/current.md",
    title: "当前笔记",
    summary: null,
    content_hash: "hash-1",
    word_count: 42,
    created_at: "2026-06-06T00:00:00Z",
    updated_at: "2026-06-06T00:00:00Z",
    indexed_at: "2026-06-06T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

function makeOutlineItem(overrides: Partial<NoteOutlineItem> = {}): NoteOutlineItem {
  return {
    id: "alpha:1",
    text: "Alpha",
    level: 1,
    lineStart: 3,
    lineEnd: 8,
    anchor: "alpha",
    children: [],
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("OutlinePanel", () => {
  beforeEach(() => {
    apiMocks.getNoteOutline.mockReset();
    useEditorStore.setState({
      currentNote: null,
      content: "",
      searchNavigationTarget: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the empty state when there is no current note", () => {
    render(<OutlinePanel />);

    expect(screen.getByText("打开笔记后显示大纲")).toBeInTheDocument();
    expect(apiMocks.getNoteOutline).not.toHaveBeenCalled();
  });

  it("loads and renders outline items", async () => {
    apiMocks.getNoteOutline.mockResolvedValue([
      makeOutlineItem({
        text: "Alpha",
        children: [
          makeOutlineItem({
            id: "beta:5",
            text: "Beta",
            level: 2,
            lineStart: 5,
            lineEnd: 8,
          }),
        ],
      }),
    ]);
    useEditorStore.setState({ currentNote: makeNote() });

    render(<OutlinePanel />);

    await waitFor(() => expect(apiMocks.getNoteOutline).toHaveBeenCalledWith("notes/current.md"));
    expect(await screen.findByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
  });

  it("writes the existing search navigation target shape when an outline item is clicked", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteOutline.mockResolvedValue([
      makeOutlineItem({
        id: "beta:5",
        text: "Beta",
        level: 2,
        lineStart: 5,
        lineEnd: 9,
      }),
    ]);
    useEditorStore.setState({ currentNote: makeNote() });
    vi.spyOn(Date, "now").mockReturnValue(12345);

    render(<OutlinePanel />);

    await user.click(await screen.findByRole("button", { name: "Beta" }));

    expect(useEditorStore.getState().searchNavigationTarget).toEqual({
      note_id: "note-1",
      note_path: "notes/current.md",
      note_title: "当前笔记",
      line_start: 5,
      line_end: 9,
      occurrence_order: 1,
      match_text: "Beta",
      context_snippet: "Beta",
      source: "body",
      revision: 12345,
    });
  });

  it("marks the clicked outline item as active", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteOutline.mockResolvedValue([
      makeOutlineItem({ text: "Alpha", lineStart: 3, lineEnd: 6 }),
      makeOutlineItem({ id: "beta:8", text: "Beta", lineStart: 8, lineEnd: 12 }),
    ]);
    useEditorStore.setState({ currentNote: makeNote() });

    render(<OutlinePanel />);

    const alphaButton = await screen.findByRole("button", { name: "Alpha" });
    const betaButton = screen.getByRole("button", { name: "Beta" });

    expect(alphaButton).toHaveAttribute("aria-pressed", "false");
    expect(betaButton).toHaveAttribute("aria-pressed", "false");

    await user.click(betaButton);

    expect(alphaButton).toHaveAttribute("aria-pressed", "false");
    expect(betaButton).toHaveAttribute("aria-pressed", "true");
  });

  it("highlights the containing section for an external navigation target", async () => {
    apiMocks.getNoteOutline.mockResolvedValue([
      makeOutlineItem({
        text: "Alpha",
        lineStart: 3,
        lineEnd: 20,
        children: [
          makeOutlineItem({ id: "beta:8", text: "Beta", level: 2, lineStart: 8, lineEnd: 14 }),
        ],
      }),
    ]);
    useEditorStore.setState({
      currentNote: makeNote(),
      searchNavigationTarget: {
        note_id: "note-1",
        note_path: "notes/current.md",
        note_title: "当前笔记",
        line_start: 10,
        line_end: 10,
        occurrence_order: 1,
        match_text: "正文命中",
        context_snippet: "正文命中",
        source: "body",
        revision: 99,
      },
    });

    render(<OutlinePanel />);

    const alphaButton = await screen.findByRole("button", { name: "Alpha" });
    const betaButton = screen.getByRole("button", { name: "Beta" });

    expect(alphaButton).toHaveAttribute("aria-pressed", "false");
    expect(betaButton).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the error state when outline loading fails", async () => {
    apiMocks.getNoteOutline.mockRejectedValue(new Error("boom"));
    useEditorStore.setState({ currentNote: makeNote() });

    render(<OutlinePanel />);

    expect(await screen.findByText("大纲加载失败")).toBeInTheDocument();
  });

  it("shows the no-outline state when the note has no headings", async () => {
    apiMocks.getNoteOutline.mockResolvedValue([]);
    useEditorStore.setState({ currentNote: makeNote() });

    render(<OutlinePanel />);

    expect(await screen.findByText("当前笔记暂无可用标题")).toBeInTheDocument();
  });

  it("debounces rapid content changes and refreshes the outline once", async () => {
    vi.useFakeTimers();
    apiMocks.getNoteOutline.mockResolvedValue([makeOutlineItem()]);
    useEditorStore.setState({ currentNote: makeNote(), content: "# Alpha" });

    render(<OutlinePanel />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(apiMocks.getNoteOutline).toHaveBeenCalledTimes(1);
    apiMocks.getNoteOutline.mockClear();

    act(() => {
      useEditorStore.setState({ content: "# Alpha\n## Beta" });
      useEditorStore.setState({ content: "# Alpha\n## Beta\n### Gamma" });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(apiMocks.getNoteOutline).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(apiMocks.getNoteOutline).toHaveBeenCalledTimes(1);
    expect(apiMocks.getNoteOutline).toHaveBeenCalledWith("notes/current.md");
  });

  it("ignores stale outline responses after switching notes", async () => {
    const firstRequest = createDeferred<NoteOutlineItem[]>();
    const secondRequest = createDeferred<NoteOutlineItem[]>();

    apiMocks.getNoteOutline.mockImplementation((path: string) => {
      if (path === "notes/first.md") {
        return firstRequest.promise;
      }

      if (path === "notes/second.md") {
        return secondRequest.promise;
      }

      return Promise.resolve([]);
    });

    useEditorStore.setState({
      currentNote: makeNote({ id: "note-1", path: "notes/first.md", title: "第一篇" }),
    });

    render(<OutlinePanel />);

    await waitFor(() => expect(apiMocks.getNoteOutline).toHaveBeenCalledWith("notes/first.md"));

    act(() => {
      useEditorStore.setState({
        currentNote: makeNote({ id: "note-2", path: "notes/second.md", title: "第二篇" }),
      });
    });

    await waitFor(() => expect(apiMocks.getNoteOutline).toHaveBeenCalledWith("notes/second.md"));

    await act(async () => {
      firstRequest.resolve([makeOutlineItem({ text: "旧大纲", lineStart: 1, lineEnd: 4 })]);
      await Promise.resolve();
    });

    expect(screen.queryByRole("button", { name: "旧大纲" })).not.toBeInTheDocument();
    expect(screen.getByText("大纲加载中...")).toBeInTheDocument();

    await act(async () => {
      secondRequest.resolve([makeOutlineItem({ text: "新大纲", lineStart: 10, lineEnd: 18 })]);
      await Promise.resolve();
    });

    expect(await screen.findByRole("button", { name: "新大纲" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "旧大纲" })).not.toBeInTheDocument();
  });
});