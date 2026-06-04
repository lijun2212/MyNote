import { render, fireEvent, waitFor, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import userEvent from "@testing-library/user-event";
import { MarkdownEditor } from "./MarkdownEditor";
import { setActiveDraggedTagName, clearActiveDraggedTagName } from "./tagDragState";
import type { SearchNavigationTarget, TagNavigationTarget } from "../../types";
import { useEditorStore } from "../../store/useEditorStore";
import { ContextMenuHost } from "../ContextMenu/ContextMenuHost";
import { ContextMenuProvider } from "../ContextMenu/useContextMenu";
import { useAppStore } from "../../store/useAppStore";

describe("MarkdownEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearActiveDraggedTagName();
    if (typeof Range !== "undefined") {
      Object.defineProperty(Range.prototype, "getClientRects", {
        configurable: true,
        value: () => ({
          length: 0,
          item: () => null,
          [Symbol.iterator]: function* iterator() {
            yield* [] as DOMRect[];
          },
        }),
      });
      Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          toJSON: () => ({}),
        }),
      });
    }
  });

  it("inserts a dragged tag at the drop location", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    expect(editorRoot).toBeTruthy();

    fireEvent.dragOver(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["application/x-mynote-tag"],
        getData: (type: string) => (type === "application/x-mynote-tag" ? "阶段一" : ""),
      },
    });

    fireEvent.drop(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["application/x-mynote-tag"],
        getData: (type: string) => (type === "application/x-mynote-tag" ? "阶段一" : ""),
      },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#阶段一");
  });

  it("accepts a dragged tag from text/plain when custom drag mime is unavailable", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    const editorRoot = container.firstElementChild as HTMLElement;
    fireEvent.dragOver(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "#法律适用" : ""),
      },
    });

    fireEvent.drop(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "#法律适用" : ""),
      },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#法律适用");
  });

  it("falls back to the shared dragged tag when drag payload data is unavailable", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    setActiveDraggedTagName("阶段一");

    const editorRoot = container.firstElementChild as HTMLElement;
    fireEvent.dragOver(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: [],
        getData: () => "",
      },
    });

    fireEvent.drop(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: [],
        getData: () => "",
      },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#阶段一");
  });

  it("inserts a dragged tag through the pointer fallback when native drag events are unavailable", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    setActiveDraggedTagName("阶段一");

    const editorRoot = container.firstElementChild as HTMLElement;
    fireEvent.pointerUp(editorRoot, {
      pointerType: "mouse",
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#阶段一");
  });

  it("inserts a dragged tag through the global pointer fallback", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    setActiveDraggedTagName("阶段一");

    const editorRoot = container.firstElementChild as HTMLElement;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => editorRoot),
    });
    fireEvent.pointerUp(window, {
      pointerType: "mouse",
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#阶段一");
  });

  it("inserts a dragged tag through the global mouse fallback", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    setActiveDraggedTagName("阶段一");

    const editorRoot = container.firstElementChild as HTMLElement;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => editorRoot),
    });
    fireEvent.mouseUp(window, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#阶段一");
  });

  it("inserts a tag when the sidebar add button dispatches an insert event", async () => {
    const onChange = vi.fn();
    render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    window.dispatchEvent(new CustomEvent("mynote:insert-tag", {
      detail: { tagName: "项目报告", source: "panel-add" },
    }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#项目报告");
  });

  it("tracks IME composition state so autosave can wait for committed input", () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    const contentRoot = container.querySelector(".cm-content") as HTMLElement;
    fireEvent.compositionStart(contentRoot);
    expect(useEditorStore.getState().isComposing).toBe(true);

    fireEvent.compositionEnd(contentRoot);
    expect(useEditorStore.getState().isComposing).toBe(false);
  });

  it("highlights the navigation target tag when tagNavigationTarget is provided", async () => {
    const onChange = vi.fn();
    const tagNavigationTarget: TagNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      note_updated_at: "2026-06-01T00:00:00Z",
      source: "inline",
      occurrence_order: 1,
      line_start: 3,
      line_end: 3,
      heading_context: null,
      context_snippet: "Body #阶段一",
      tag_name: "阶段一",
      revision: 1,
    };

    const { container } = render(
      <MarkdownEditor
        initialContent={["# Title", "", "Body #阶段一"].join("\n")}
        onChange={onChange}
        tagNavigationTarget={tagNavigationTarget}
      />,
    );

    await waitFor(() => {
      const highlightedTag = container.querySelector(".cm-inline-tag-navigation-target");
      expect(highlightedTag).toHaveTextContent("#阶段一");
    });
  });

  it("scrolls to the search navigation target line when searchNavigationTarget is provided", async () => {
    const onChange = vi.fn();
    const lineBlockAtSpy = vi.spyOn(EditorView.prototype, "lineBlockAt").mockImplementation((position) => ({
      from: Number(position),
      to: Number(position),
      top: 240,
      bottom: 264,
      height: 24,
      type: 0,
      widgetLineBreaks: 0,
      length: 0,
    } as ReturnType<EditorView["lineBlockAt"]>));
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 11,
      line_end: 11,
      occurrence_order: 2,
      match_text: "alpha",
      source: "body",
      context_snippet: "alpha target",
      revision: 1,
    };

    const { container } = render(
      <MarkdownEditor
        initialContent={Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join("\n")}
        onChange={onChange}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      const scroller = container.querySelector(".cm-scroller") as HTMLElement;
      expect(scroller.scrollTop).toBe(240);
    });

    lineBlockAtSpy.mockRestore();
  });

  it("highlights the active search navigation target in the editor", async () => {
    const onChange = vi.fn();
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 3,
      line_end: 3,
      occurrence_order: 1,
      match_text: "alpha",
      source: "body",
      context_snippet: "Body alpha target",
      revision: 2,
    };

    const { container } = render(
      <MarkdownEditor
        initialContent={["# Title", "", "Body alpha target"].join("\n")}
        onChange={onChange}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      const highlightedSearchHit = container.querySelector(".cm-search-navigation-target");
      expect(highlightedSearchHit).toHaveTextContent("alpha");
    });
  });

  it("highlights the occurrence selected by occurrence_order in the editor", async () => {
    const onChange = vi.fn();
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 3,
      line_end: 3,
      occurrence_order: 2,
      match_text: "alpha",
      source: "body",
      context_snippet: "alpha middle alpha end",
      revision: 3,
    };

    const { container } = render(
      <MarkdownEditor
        initialContent={["# Title", "", "alpha middle alpha end"].join("\n")}
        onChange={onChange}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      const highlightedSearchHit = container.querySelector(".cm-search-navigation-target");
      expect(highlightedSearchHit).toHaveTextContent("alpha");
      expect(highlightedSearchHit?.previousSibling?.textContent).toContain("alpha middle ");
    });
  });

  it("matches search highlights case-insensitively in the editor", async () => {
    const onChange = vi.fn();
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 3,
      line_end: 3,
      occurrence_order: 1,
      match_text: "alpha",
      source: "body",
      context_snippet: "Alpha middle alpha end",
      revision: 4,
    };

    const { container } = render(
      <MarkdownEditor
        initialContent={["# Title", "", "Alpha middle alpha end"].join("\n")}
        onChange={onChange}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      const highlightedSearchHit = container.querySelector(".cm-search-navigation-target");
      expect(highlightedSearchHit).toHaveTextContent("Alpha");
    });
  });

  it("does not hijack plain text input for N and B while editing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const { container } = render(
      <MarkdownEditor
        initialContent=""
        onChange={onChange}
      />,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    editorContent.focus();
    await user.keyboard("nb");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(container.querySelector(".cm-content")?.textContent?.toLowerCase()).toContain("nb");
  });

  it("shows selection context menu for formatting and knowledge actions", async () => {
    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="项目周报" onChange={vi.fn()} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    expect(editorRoot).toBeTruthy();

    const view = EditorView.findFromDOM(editorRoot);
    expect(view).toBeTruthy();

    view?.dispatch({ selection: { anchor: 0, head: 4 } });
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });

    expect(await screen.findByRole("menuitem", { name: "添加链接" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "添加标签" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "创建双链" })).toBeInTheDocument();
  });

  it("applies the selected knowledge action from the context menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="项目周报" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorRoot);
    view?.dispatch({ selection: { anchor: 0, head: 4 } });

    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });
    await user.click(await screen.findByRole("menuitem", { name: "创建双链" }));

    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("[[项目周报]]");
    });
  });

  it("applies selection actions to the snapshot that was active when the menu opened", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="项目周报 第二段" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorRoot);
    view?.dispatch({ selection: { anchor: 0, head: 4 } });

    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });
    view?.dispatch({ selection: { anchor: 5, head: 8 } });

    await user.click(await screen.findByRole("menuitem", { name: "创建双链" }));

    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("[[项目周报]] 第二段");
    });
  });

  it("shows editor blank actions and routes implemented ones through the shared context menu host", async () => {
    const user = userEvent.setup();
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    const setLeftSidebarVisible = vi.fn();
    const previousState = useAppStore.getState();

    useAppStore.setState({
      refreshTree,
      setLeftSidebarVisible,
    });

    const { container, unmount } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="项目周报" onChange={vi.fn()} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });

    expect(await screen.findByRole("menuitem", { name: "刷新索引" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "显示侧栏" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "新建笔记" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "粘贴" })).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("menuitem", { name: "刷新索引" }));
    expect(refreshTree).toHaveBeenCalledOnce();

    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });
    await user.click(await screen.findByRole("menuitem", { name: "显示侧栏" }));
    expect(setLeftSidebarVisible).toHaveBeenCalledWith(true);

    unmount();
    useAppStore.setState({
      refreshTree: previousState.refreshTree,
      setLeftSidebarVisible: previousState.setLeftSidebarVisible,
    });
  });
});