import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagPanel } from "./TagPanel";
import { ContextMenuHost } from "../ContextMenu/ContextMenuHost";
import { ContextMenuProvider } from "../ContextMenu/useContextMenu";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { makeKnowledgeBase, makeNote } from "../../test/testData";
import { getActiveDraggedTagName, clearActiveDraggedTagName } from "../EditorWorkspace/tagDragState";

function renderWithContextMenu() {
  return render(
    <ContextMenuProvider>
      <TagPanel />
      <ContextMenuHost />
    </ContextMenuProvider>,
  );
}

const apiMocks = vi.hoisted(() => ({
  listTags: vi.fn(),
  getTagContext: vi.fn(),
  getNoteByPath: vi.fn(),
  deleteTag: vi.fn(),
}));

vi.mock("../../api/commands", () => ({
  api: apiMocks,
}));

describe("TagPanel", () => {
  beforeEach(() => {
    apiMocks.listTags.mockReset();
    apiMocks.getTagContext.mockReset();
    apiMocks.getNoteByPath.mockReset();
    apiMocks.deleteTag.mockReset();
    vi.restoreAllMocks();

    useAppStore.setState({
      kb: makeKnowledgeBase({ id: "kb-1" }),
      selectedTagIds: [],
      activeTagContext: null,
    });
    useEditorStore.setState({
      currentNote: makeNote({ id: "note-1", path: "notes/current.md", title: "Current" }),
      content: "# Current\n\nBody",
      isDirty: false,
      isSaving: false,
      saveError: null,
      saveStatus: "saved",
      showPreview: true,
      tagNavigationTarget: null,
    });
    apiMocks.getNoteByPath.mockResolvedValue({
      note: makeNote({ id: "note-1", path: "notes/current.md", title: "Current" }),
      content: "# Current\n\nBody",
    });
    clearActiveDraggedTagName();
  });

  it("loads tag context after clicking a tag and stores the active tag state", async () => {
    const user = userEvent.setup();

    apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 6 }]);
    apiMocks.getTagContext.mockResolvedValue({
      tag_id: "tag-1",
      tag_name: "项目报告",
      total_notes: 6,
      visible_count: 1,
      has_more: true,
      items: [],
    });

    render(<TagPanel />);

    await user.click(await screen.findByRole("button", { name: "标签 项目报告 6" }));

    await waitFor(() => expect(apiMocks.getTagContext).toHaveBeenCalledWith("tag-1"));
    expect(useAppStore.getState().activeTagContext?.tag_id).toBe("tag-1");
  });

  it("renders up to five context items and shows the has-more hint", async () => {
    const user = userEvent.setup();

    apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 6 }]);
    apiMocks.getTagContext.mockResolvedValue({
      tag_id: "tag-1",
      tag_name: "项目报告",
      total_notes: 6,
      visible_count: 6,
      has_more: true,
      items: Array.from({ length: 6 }, (_, index) => ({
        note_id: `note-${index + 1}`,
        note_path: `notes/note-${index + 1}.md`,
        note_title: `笔记 ${index + 1}`,
        note_updated_at: "2026-06-01T10:00:00Z",
        source: "inline" as const,
        occurrence_order: index + 1,
        line_start: index + 1,
        line_end: index + 1,
        heading_context: index === 0 ? "章节一" : null,
        context_snippet: `片段 ${index + 1}`,
      })),
    });

    render(<TagPanel />);

    await user.click(await screen.findByRole("button", { name: "标签 项目报告 6" }));

    expect(await screen.findByText("项目报告 · 6 篇")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /打开标签上下文笔记/ })).toHaveLength(5);
    expect(screen.getByText("... 还有更多")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开标签上下文笔记 笔记 6/ })).not.toBeInTheDocument();
  });

  it("opens a context note and stores tagNavigationTarget after clicking a context item", async () => {
    const user = userEvent.setup();

    apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 2 }]);
    apiMocks.getTagContext.mockResolvedValue({
      tag_id: "tag-1",
      tag_name: "项目报告",
      total_notes: 2,
      visible_count: 1,
      has_more: false,
      items: [
        {
          note_id: "note-2",
          note_path: "notes/project-report.md",
          note_title: "项目周报",
          note_updated_at: "2026-06-01T10:00:00Z",
          source: "front_matter" as const,
          occurrence_order: 0,
          line_start: 12,
          line_end: 12,
          heading_context: "执行摘要",
          context_snippet: "这里提到了项目报告标签。",
        },
      ],
    });
    apiMocks.getNoteByPath.mockResolvedValue({
      note: makeNote({ id: "note-2", path: "notes/project-report.md", title: "项目周报" }),
      content: "# 项目周报\n\n这里提到了项目报告标签。",
    });

    render(<TagPanel />);

    await user.click(await screen.findByRole("button", { name: "标签 项目报告 2" }));
    await user.click(await screen.findByRole("button", { name: /打开标签上下文笔记 项目周报/ }));

    await waitFor(() => expect(apiMocks.getNoteByPath).toHaveBeenCalledWith("notes/project-report.md"));
    expect(useAppStore.getState().selectedNodePath).toBe("notes/project-report.md");
    expect(useEditorStore.getState().currentNote?.path).toBe("notes/project-report.md");
    expect(useEditorStore.getState().content).toContain("项目周报");
    expect(useEditorStore.getState().tagNavigationTarget).toMatchObject({
      note_path: "notes/project-report.md",
      note_title: "项目周报",
      occurrence_order: 0,
      tag_name: "项目报告",
    });
    expect(useEditorStore.getState().tagNavigationTarget?.revision).toEqual(expect.any(Number));
  });

  it("shows a delete icon beside selected tags instead of a global clear-filter action", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    apiMocks.listTags
      .mockResolvedValueOnce([
        { id: "tag-1", name: "项目报告", note_count: 3 },
        { id: "tag-2", name: "阶段一", note_count: 1 },
      ])
      .mockResolvedValueOnce([{ id: "tag-2", name: "阶段一", note_count: 1 }]);
    apiMocks.deleteTag.mockResolvedValue(undefined);

    render(<TagPanel />);

    const tagButton = await screen.findByRole("button", { name: "标签 项目报告 3" });
    await user.click(tagButton);

    expect(screen.queryByText("清除过滤")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除标签 项目报告" }));

    expect(confirmSpy).toHaveBeenCalledWith("删除标签“项目报告”会从所有笔记中移除，确认继续？");
    await waitFor(() => expect(apiMocks.deleteTag).toHaveBeenCalledWith("tag-1"));
    await waitFor(() => expect(apiMocks.listTags).toHaveBeenCalledTimes(2));
    expect(useAppStore.getState().selectedTagIds).toEqual([]);
  });

  it("reveals an inline tag creator instead of relying on window.prompt", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("新的标签");

    apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 3 }]);

    render(<TagPanel />);

    await screen.findByRole("button", { name: "标签 项目报告 3" });
    await user.click(screen.getByRole("button", { name: "新增标签" }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "新标签名称" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加标签" })).toBeInTheDocument();
  });

  it("adds a new tag to the sidebar immediately after confirming the inline creator", async () => {
    const user = userEvent.setup();
    const insertListener = vi.fn();

    apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 3 }]);
    window.addEventListener("mynote:insert-tag", insertListener as EventListener);

    render(<TagPanel />);

    await screen.findByRole("button", { name: "标签 项目报告 3" });
    await user.click(screen.getByRole("button", { name: "新增标签" }));

    await user.type(screen.getByRole("textbox", { name: "新标签名称" }), "法律适用");
    await user.click(screen.getByRole("button", { name: "添加标签" }));

    expect(insertListener).toHaveBeenCalledTimes(1);
    const event = insertListener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ tagName: "法律适用", source: "panel-add" });

    const list = screen.getByTestId("tag-panel-list");
    expect(within(list).getByRole("button", { name: "标签 法律适用 1" })).toBeInTheDocument();

    window.removeEventListener("mynote:insert-tag", insertListener as EventListener);
  });

  it("stores the dragged tag name in shared drag state on drag start", async () => {
    const user = userEvent.setup();
    apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 3 }]);

    render(<TagPanel />);

    const tagButton = await screen.findByRole("button", { name: "标签 项目报告 3" });
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: "none",
    } as unknown as DataTransfer;

    await user.pointer([{ target: tagButton, keys: "[MouseLeft>]" }]);
    fireEvent.dragStart(tagButton, { dataTransfer });

    expect(getActiveDraggedTagName()).toBe("项目报告");
  });

  it("shows a tag-shaped drag preview while dragging a tag", async () => {
    apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 3 }]);

    render(<TagPanel />);

    const tagButton = await screen.findByRole("button", { name: "标签 项目报告 3" });
    fireEvent.mouseDown(tagButton, { button: 0, clientX: 20, clientY: 80 });
    fireEvent.mouseMove(window, { button: 0, clientX: 92, clientY: 112 });

    const preview = screen.getByTestId("tag-drag-preview");
    expect(preview).toHaveTextContent("# 项目报告");
    expect(preview).toHaveStyle({ left: "80px", top: "100px" });
    expect(preview).toHaveStyle({ background: "rgb(255, 255, 255)" });
    expect(preview).toHaveStyle({ transform: "translate3d(0, 0, 0) rotate(-1deg)" });
  });

  it("opens a tag context menu on right click and keeps unavailable actions disabled", async () => {
    apiMocks.listTags.mockResolvedValue([{ id: "tag-1", name: "项目报告", note_count: 3 }]);

    renderWithContextMenu();

    fireEvent.contextMenu(await screen.findByRole("button", { name: "标签 项目报告 3" }), {
      clientX: 100,
      clientY: 72,
    });

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除标签" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveAttribute("aria-disabled", "true");
  });
});