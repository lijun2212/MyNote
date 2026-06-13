import { render, fireEvent, waitFor, screen, createEvent } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import userEvent from "@testing-library/user-event";
import { MarkdownEditor } from "./MarkdownEditor";
import { setActiveDraggedTagName, clearActiveDraggedTagName } from "./tagDragState";
import { api } from "../../api/commands";
import type { SearchNavigationTarget, TagNavigationTarget } from "../../types";
import { useEditorStore } from "../../store/useEditorStore";
import { ContextMenuHost } from "../ContextMenu/ContextMenuHost";
import { ContextMenuProvider } from "../ContextMenu/useContextMenu";
import { useAppStore } from "../../store/useAppStore";
import { deferred, makeKnowledgeBase, makeNote, makeSearchResult } from "../../test/testData";
import { StatusBar } from "../StatusBar";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("MarkdownEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearActiveDraggedTagName();
    useEditorStore.setState({ currentNote: null, isComposing: false, statusNotice: null });
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

    expect(await screen.findByRole("menuitem", { name: "转为 Markdown 链接" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "添加标签" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "转为双链" })).toBeInTheDocument();
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
    await user.click(await screen.findByRole("menuitem", { name: "转为双链" }));

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

    await user.click(await screen.findByRole("menuitem", { name: "转为双链" }));

    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("[[项目周报]] 第二段");
    });
  });

  it("inserts an image markdown at the selected range from the selection context menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.spyOn(api, "insertImageForNote").mockResolvedValue({ markdownPath: "../assets/diagram.png" });
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

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
    await user.click(await screen.findByRole("menuitem", { name: "插入图片" }));

    expect(api.insertImageForNote).toHaveBeenCalledWith("notes/current.md");
    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toBe("![图片](../assets/diagram.png) 第二段");
    });
  });

  it("inserts an image markdown at the current cursor from the blank context menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.spyOn(api, "insertImageForNote").mockResolvedValue({ markdownPath: "../assets/diagram.png" });
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorRoot);
    view?.dispatch({ selection: { anchor: 2, head: 2 } });

    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });
    await user.click(await screen.findByRole("menuitem", { name: "插入图片" }));

    expect(api.insertImageForNote).toHaveBeenCalledWith("notes/current.md");
    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toBe("正文![图片](../assets/diagram.png)");
    });
  });

  it("does not modify the editor when image insertion is cancelled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.spyOn(api, "insertImageForNote").mockResolvedValue(null);
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });
    await user.click(await screen.findByRole("menuitem", { name: "插入图片" }));

    expect(api.insertImageForNote).toHaveBeenCalledWith("notes/current.md");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not modify the editor when image insertion fails", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.spyOn(api, "insertImageForNote").mockRejectedValue(new Error("insert failed"));
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });
    await user.click(await screen.findByRole("menuitem", { name: "插入图片" }));

    expect(api.insertImageForNote).toHaveBeenCalledWith("notes/current.md");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables insert image when there is no current note", async () => {
    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="项目周报" onChange={vi.fn()} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorRoot);

    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });
    expect(await screen.findByRole("menuitem", { name: "插入图片" })).toHaveAttribute("aria-disabled", "true");

    view?.dispatch({ selection: { anchor: 0, head: 4 } });
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });
    const menuItems = await screen.findAllByRole("menuitem", { name: "插入图片" });
    expect(menuItems[menuItems.length - 1]).toHaveAttribute("aria-disabled", "true");
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

    expect(await screen.findByRole("menuitem", { name: "插入 Markdown 链接..." })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "插入双链..." })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "刷新索引" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "显示侧栏" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "新建笔记" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "粘贴" })).toHaveAttribute("aria-disabled", "false");

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

  it("pastes clipboard text from the blank editor context menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue("粘贴文本"),
      },
    });

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="原文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });
    await user.click(await screen.findByRole("menuitem", { name: "粘贴" }));

    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("粘贴文本");
    });

    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    }
  });

  it("prefers clipboard text over native image on context-menu paste", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const nativeClipboardPaste = vi.spyOn(api, "insertPastedImageFromClipboardForNote").mockResolvedValue({
      markdownPath: "../assets/native-clipboard.png",
    });
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue("复制出来的文字"),
      },
    });

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="原文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });
    await user.click(await screen.findByRole("menuitem", { name: "粘贴" }));

    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("复制出来的文字");
    });

    expect(nativeClipboardPaste).not.toHaveBeenCalled();

    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    }
  });

  it("pastes clipboard image from paste event data as markdown image syntax", async () => {
    const onChange = vi.fn();
    const insertPastedImageForNote = vi.spyOn(api, "insertPastedImageForNote").mockResolvedValue({
      markdownPath: "../assets/pasted.png",
    });
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));
    const imageBlob = new Blob(["png-binary"], { type: "image/png" });

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const pasteEvent = createEvent.paste(editorContent);
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => imageBlob,
          },
        ],
        getData: () => "",
      },
    });
    fireEvent(editorContent, pasteEvent);

    await waitFor(() => {
      expect(insertPastedImageForNote).toHaveBeenCalledWith("notes/current.md", "image/png", expect.any(Uint8Array));
    });
    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("![图片](../assets/pasted.png)");
    });
  });

  it("pastes plain text from paste event data explicitly", async () => {
    const onChange = vi.fn();

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const pasteEvent = createEvent.paste(editorContent);
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        items: [],
        getData: (type: string) => (type === "text/plain" ? "来自剪贴板的文字" : ""),
      },
    });
    fireEvent(editorContent, pasteEvent);

    expect(pasteEvent.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("来自剪贴板的文字");
    });
  });

  it("downloads remote images referenced by pasted markdown text and rewrites them to local assets", async () => {
    const onChange = vi.fn();
    const rewriteRemoteImages = vi.spyOn(api, "rewritePastedRemoteImages")
      .mockResolvedValueOnce(["### 业务流程设计", "![图片](../assets/remote-1.png)", "![图片](../assets/remote-2.png)"].join("\n"));
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const pastedMarkdown = [
      "### 业务流程设计",
      "![](https://cdn.example.com/a.png)",
      '<img src="https://cdn.example.com/b.png" width="640">',
    ].join("\n");
    const pasteEvent = createEvent.paste(editorContent);
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        items: [],
        getData: (type: string) => (type === "text/plain" ? pastedMarkdown : ""),
      },
    });

    fireEvent(editorContent, pasteEvent);

    await waitFor(() => {
      expect(rewriteRemoteImages).toHaveBeenCalledWith("notes/current.md", pastedMarkdown);
    });
    await waitFor(() => {
      const inserted = onChange.mock.lastCall?.[0] ?? "";
      expect(inserted).toContain("![图片](../assets/remote-1.png)");
      expect(inserted).toContain("![图片](../assets/remote-2.png)");
      expect(inserted).not.toContain("https://cdn.example.com/a.png");
      expect(inserted).not.toContain("https://cdn.example.com/b.png");
    });
  });

  it("downloads remote images referenced by multiline markdown image syntax", async () => {
    const onChange = vi.fn();
    const rewriteRemoteImages = vi.spyOn(api, "rewritePastedRemoteImages")
      .mockResolvedValueOnce(["### 业务流程设计", "![图片](../assets/feishu-remote.svg)"].join("\n"));
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const pastedMarkdown = [
      "### 业务流程设计",
      "![](",
      "https://cdn.example.com/diagram.svg",
      ")",
    ].join("\n");
    const pasteEvent = createEvent.paste(editorContent);
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        items: [],
        getData: (type: string) => (type === "text/plain" ? pastedMarkdown : ""),
      },
    });

    fireEvent(editorContent, pasteEvent);

    await waitFor(() => {
      expect(rewriteRemoteImages).toHaveBeenCalledWith("notes/current.md", pastedMarkdown);
    });
    await waitFor(() => {
      const inserted = onChange.mock.lastCall?.[0] ?? "";
      expect(inserted).toContain("![图片](../assets/feishu-remote.svg)");
      expect(inserted).not.toContain("https://cdn.example.com/diagram.svg");
    });
  });

  it("downloads remote images referenced by multiline html image syntax in plain text", async () => {
    const onChange = vi.fn();
    const rewriteRemoteImages = vi.spyOn(api, "rewritePastedRemoteImages")
      .mockResolvedValueOnce("![图片](../assets/feishu-html.png)");
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const pastedText = [
      "<img",
      'src="https://cdn.example.com/feishu.png" width="1251" title=""',
      'crop="0,0,1,1" id="uff1c0cc2" class="ne-image">',
    ].join("\n");
    const pasteEvent = createEvent.paste(editorContent);
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        items: [],
        getData: (type: string) => (type === "text/plain" ? pastedText : ""),
      },
    });

    fireEvent(editorContent, pasteEvent);

    await waitFor(() => {
      expect(rewriteRemoteImages).toHaveBeenCalledWith("notes/current.md", pastedText);
    });
    await waitFor(() => {
      const inserted = onChange.mock.lastCall?.[0] ?? "";
      expect(inserted).toContain("![图片](../assets/feishu-html.png)");
      expect(inserted).not.toContain("https://cdn.example.com/feishu.png");
      expect(inserted).not.toContain("<img");
    });
  });

  it("downloads remote images referenced by pasted html when plain text is unavailable", async () => {
    const onChange = vi.fn();
    const rewriteRemoteImages = vi.spyOn(api, "rewritePastedRemoteImages")
      .mockResolvedValueOnce(["流程图", "![图片](../assets/html-remote.png)"].join("\n"));
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const pastedHtml = "<section><p>流程图</p><img src=\"https://cdn.example.com/html.png\" width=\"600\"></section>";
    const pasteEvent = createEvent.paste(editorContent);
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        items: [],
        getData: (type: string) => {
          if (type === "text/html") return pastedHtml;
          return "";
        },
      },
    });

    fireEvent(editorContent, pasteEvent);

    await waitFor(() => {
      expect(rewriteRemoteImages).toHaveBeenCalledWith(
        "notes/current.md",
        ["流程图", "", '<img src="https://cdn.example.com/html.png">'].join("\n"),
      );
    });
    await waitFor(() => {
      const inserted = onChange.mock.lastCall?.[0] ?? "";
      expect(inserted).toContain("流程图");
      expect(inserted).toContain("![图片](../assets/html-remote.png)");
      expect(inserted).not.toContain("https://cdn.example.com/html.png");
    });
  });

  it("closes an open editor context menu when paste starts", async () => {
    const onChange = vi.fn();

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });

    expect(await screen.findByRole("menuitem", { name: "粘贴" })).toBeInTheDocument();

    fireEvent.paste(editorContent);

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("suppresses the editor context menu during a keyboard paste shortcut", async () => {
    const onChange = vi.fn();

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });

    expect(await screen.findByRole("menuitem", { name: "粘贴" })).toBeInTheDocument();

    fireEvent.keyDown(editorContent, { key: "v", metaKey: true });

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("falls back to the native clipboard image command when the paste event exposes no text or file items", async () => {
    const onChange = vi.fn();
    const nativeClipboardPaste = vi.spyOn(api, "insertPastedImageFromClipboardForNote").mockResolvedValue({
      markdownPath: "../assets/native-clipboard.png",
    });
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const pasteEvent = createEvent.paste(editorContent);
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        items: [],
        getData: () => "",
      },
    });
    fireEvent(editorContent, pasteEvent);

    await waitFor(() => {
      expect(nativeClipboardPaste).toHaveBeenCalledWith("notes/current.md");
    });

    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("![图片](../assets/native-clipboard.png)");
    });
  });

  it("does not trigger a keyboard fallback read before the native paste event", async () => {
    const onChange = vi.fn();
    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const nativeClipboardPaste = vi.spyOn(api, "insertPastedImageFromClipboardForNote");
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue("键盘粘贴的文字"),
      },
    });

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const keydownEvent = createEvent.keyDown(editorContent, { key: "v", metaKey: true });
    fireEvent(editorContent, keydownEvent);

    expect(keydownEvent.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(nativeClipboardPaste).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("正在处理粘贴...");

    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    }
  });

  it("does not run keyboard fallback before a delayed paste event arrives", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const rewriteRemoteImages = vi.spyOn(api, "rewritePastedRemoteImages").mockResolvedValue("![图片](../assets/delayed.png)");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue("键盘兜底原始文本"),
      },
    });

    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    fireEvent.keyDown(editorContent, { key: "v", metaKey: true });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(rewriteRemoteImages).not.toHaveBeenCalled();

    vi.useRealTimers();

    const pasteEvent = createEvent.paste(editorContent);
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        items: [],
        getData: (type: string) => (type === "text/plain" ? "![](https://cdn.example.com/delayed.png)" : ""),
      },
    });
    fireEvent(editorContent, pasteEvent);

    await waitFor(() => {
      expect(rewriteRemoteImages).toHaveBeenCalledWith("notes/current.md", "![](https://cdn.example.com/delayed.png)");
    });
    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("![图片](../assets/delayed.png)");
    });

    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    }
  });

  it("shows immediate feedback as soon as keyboard paste starts", async () => {
    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue(""),
      },
    });

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={vi.fn()} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    fireEvent.keyDown(editorContent, { key: "v", metaKey: true });

    expect(screen.getByRole("status")).toHaveTextContent("正在处理粘贴...");

    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    }
  });

  it("falls back to keyboard clipboard text when no paste event arrives after the safety delay", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const readClipboardTextForPaste = vi.spyOn(api, "readClipboardTextForPaste").mockResolvedValue("键盘粘贴的文字");
    const nativeClipboardPaste = vi.spyOn(api, "insertPastedImageFromClipboardForNote").mockResolvedValue(null);
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="正文" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    fireEvent.keyDown(editorContent, { key: "v", metaKey: true });

    expect(screen.getByRole("status")).toHaveTextContent("正在处理粘贴...");

    await act(async () => {
      vi.advanceTimersByTime(1300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readClipboardTextForPaste).toHaveBeenCalledWith("notes/current.md");
    expect(onChange.mock.lastCall?.[0]).toContain("键盘粘贴的文字");
    expect(nativeClipboardPaste).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("does not prevent the native copy shortcut when text is selected", () => {
    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="项目周报 第二段" onChange={vi.fn()} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorRoot);
    view?.dispatch({ selection: { anchor: 0, head: 4 } });

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const keydownEvent = createEvent.keyDown(editorContent, { key: "c", metaKey: true });

    fireEvent(editorContent, keydownEvent);

    expect(keydownEvent.defaultPrevented).toBe(false);
  });

  it("mirrors the selected text into navigator.clipboard on keyboard copy", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText,
      },
    });

    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="项目周报 第二段" onChange={vi.fn()} />
        <StatusBar />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorRoot);
    view?.dispatch({ selection: { anchor: 0, head: 4 } });

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const keydownEvent = createEvent.keyDown(editorContent, { key: "c", metaKey: true });

    fireEvent(editorContent, keydownEvent);

    expect(keydownEvent.defaultPrevented).toBe(false);

    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("项目周报");

    expect(screen.getByText("● 已拷贝")).toBeInTheDocument();
    expect(screen.getByText("● 已拷贝")).toHaveStyle({ color: "#0969da" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(screen.queryByText("● 已拷贝")).not.toBeInTheDocument();

    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
    }

    vi.useRealTimers();
  });

  it("writes selected text into clipboardData on copy events", () => {
    const { container } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="项目周报 第二段" onChange={vi.fn()} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(editorRoot);
    view?.dispatch({ selection: { anchor: 0, head: 4 } });

    const editorContent = container.querySelector(".cm-content") as HTMLElement;
    const copyEvent = createEvent.copy(editorContent);
    const setData = vi.fn();
    Object.defineProperty(copyEvent, "clipboardData", {
      configurable: true,
      value: {
        setData,
      },
    });

    fireEvent(editorContent, copyEvent);

    expect(setData).toHaveBeenCalledWith("text/plain", "项目周报");
    expect(copyEvent.defaultPrevented).toBe(true);
  });

  it("inserts a wiki link from the blank editor context menu using the note picker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const searchNotes = vi.spyOn(api, "searchNotes").mockResolvedValue([
      makeSearchResult({
        note_id: "note-target",
        title: "目标笔记",
        path: "notes/target.md",
      }),
      makeSearchResult({
        note_id: "note-target",
        title: "目标笔记",
        path: "notes/target.md",
        occurrence_order: 2,
      }),
    ]);
    const previousState = useAppStore.getState();

    useAppStore.setState({
      kb: makeKnowledgeBase({ id: "kb-picker" }),
    });

    const { container, unmount } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });

    await user.click(await screen.findByRole("menuitem", { name: "插入双链..." }));
    await user.type(await screen.findByPlaceholderText("搜索笔记标题或直接输入"), "目标");
    await user.click(await screen.findByRole("button", { name: "目标笔记" }));

    expect(searchNotes).toHaveBeenCalledWith("目标", "kb-picker");

    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("[[目标笔记]]");
    });

    unmount();
    useAppStore.setState({
      kb: previousState.kb,
    });
  });

  it("inserts a markdown link from the blank editor context menu using the note picker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const searchNotes = vi.spyOn(api, "searchNotes").mockResolvedValue([
      makeSearchResult({
        note_id: "note-target",
        title: "目标笔记",
        path: "notes/target.md",
      }),
    ]);
    const previousState = useAppStore.getState();

    useAppStore.setState({
      kb: makeKnowledgeBase({ id: "kb-picker" }),
    });

    const { container, unmount } = render(
      <ContextMenuProvider>
        <MarkdownEditor initialContent="" onChange={onChange} />
        <ContextMenuHost />
      </ContextMenuProvider>,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    fireEvent.contextMenu(editorRoot, { clientX: 24, clientY: 32 });

    await user.click(await screen.findByRole("menuitem", { name: "插入 Markdown 链接..." }));
    await user.type(await screen.findByPlaceholderText("搜索笔记标题或直接输入"), "目标");
    await user.click(await screen.findByRole("button", { name: "目标笔记" }));

    expect(searchNotes).toHaveBeenCalledWith("目标", "kb-picker");

    await waitFor(() => {
      expect(onChange.mock.lastCall?.[0]).toContain("[目标笔记](notes/target.md)");
    });

    unmount();
    useAppStore.setState({
      kb: previousState.kb,
    });
  });
});