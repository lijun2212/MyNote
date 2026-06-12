import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileTreePanel } from "./FileTreePanel";
import { ContextMenuHost } from "../ContextMenu/ContextMenuHost";
import { ContextMenuProvider } from "../ContextMenu/useContextMenu";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { makeKnowledgeBase, makeNoteDetail, makeNoteWithSummary } from "../../test/testData";
import type { NoteTreeNode } from "../../types";

function renderWithContextMenu() {
  return render(
    <ContextMenuProvider>
      <FileTreePanel />
      <ContextMenuHost />
    </ContextMenuProvider>,
  );
}

const hookMocks = vi.hoisted(() => ({
  createNote: vi.fn(),
  createNotebook: vi.fn(),
  moveNote: vi.fn(),
  renameNote: vi.fn(),
  renameNotebook: vi.fn(),
  updateNotebookVisual: vi.fn(),
  deleteNotebook: vi.fn(),
  deleteNote: vi.fn(),
  reorderNotebooks: vi.fn(),
  openNote: vi.fn(),
}));

const dialogMocks = vi.hoisted(() => ({
  open: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  listNotesByTag: vi.fn(),
  getNoteTree: vi.fn(),
  getNoteByPath: vi.fn(),
  importMarkdownSources: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: dialogMocks.open,
}));

vi.mock("../../hooks/useKnowledgeBase", () => ({
  useKnowledgeBase: () => ({
    createNote: hookMocks.createNote,
    createNotebook: hookMocks.createNotebook,
    moveNote: hookMocks.moveNote,
    renameNote: hookMocks.renameNote,
    renameNotebook: hookMocks.renameNotebook,
    updateNotebookVisual: hookMocks.updateNotebookVisual,
    deleteNotebook: hookMocks.deleteNotebook,
    deleteNote: hookMocks.deleteNote,
    reorderNotebooks: hookMocks.reorderNotebooks,
  }),
}));

vi.mock("../../hooks/useOpenNote", () => ({
  useOpenNote: () => ({
    openNote: hookMocks.openNote,
  }),
}));

vi.mock("../../api/commands", () => ({
  api: apiMocks,
}));

describe("FileTreePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: undefined,
    });
    hookMocks.createNote.mockReset();
    hookMocks.createNotebook.mockReset();
    hookMocks.moveNote.mockReset();
    hookMocks.renameNote.mockReset();
    hookMocks.renameNotebook.mockReset();
    hookMocks.updateNotebookVisual.mockReset();
    hookMocks.deleteNotebook.mockReset();
    hookMocks.deleteNote.mockReset();
    hookMocks.reorderNotebooks.mockReset();
    hookMocks.openNote.mockReset();
    apiMocks.listNotesByTag.mockReset();
    apiMocks.getNoteTree.mockReset();
    apiMocks.getNoteByPath.mockReset();
    apiMocks.importMarkdownSources.mockReset();
    dialogMocks.open.mockReset();
    apiMocks.listNotesByTag.mockResolvedValue([]);
    apiMocks.getNoteByPath.mockResolvedValue(makeNoteDetail());
    apiMocks.importMarkdownSources.mockResolvedValue({
      imported: [],
      warnings: [],
      failures: [],
    });

    const tree: NoteTreeNode[] = [
      {
        id: null,
        name: "notes",
        path: "notes",
        is_dir: true,
        children: [
          {
            id: null,
            name: "法律",
            path: "notes/法律",
            is_dir: true,
            children: [
              {
                id: "note-1",
                name: "案例.md",
                path: "notes/法律/案例.md",
                is_dir: false,
                has_summary: true,
                children: [],
              },
            ],
          },
          {
            id: "note-2",
            name: "我的笔记.md",
            path: "notes/我的笔记.md",
            is_dir: false,
            children: [],
          },
        ],
      },
    ];

    apiMocks.getNoteTree.mockResolvedValue(tree);

    useAppStore.setState({
      kb: makeKnowledgeBase(),
      tree,
      selectedNodePath: null,
      selectedTagIds: [],
      refreshTree: vi.fn().mockResolvedValue(undefined),
    });
    useEditorStore.setState({
      currentNote: null,
      content: "",
      isComposing: false,
      isDirty: false,
      isSaving: false,
      saveError: null,
      saveStatus: "saved",
      showPreview: true,
      searchNavigationTarget: null,
      tagNavigationTarget: null,
    });
  });

  it("renders notebooks and groups root notes under 未归档", () => {
    render(<FileTreePanel />);

    expect(screen.getByText("法律")).toBeInTheDocument();
    expect(screen.getByText("未归档")).toBeInTheDocument();
    expect(screen.getByText("我的笔记.md")).toBeInTheDocument();
  });

  it("shows directory color and article count while toggling with visible state changes", async () => {
    const user = userEvent.setup();

    render(<FileTreePanel />);

    expect(screen.queryByRole("button", { name: "切换目录 法律" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "切换目录 未归档" })).not.toBeInTheDocument();

    const directoryToggle = screen.getByRole("button", { name: "切换笔记本 法律" });
    const directoryTitle = screen.getByRole("button", { name: "法律" });
    const directoryContent = screen.getByTestId("directory-content:notes/法律");
    const notebookColorTrigger = screen.getByRole("button", { name: "编辑笔记本颜色 法律" });
    const directoryCount = screen.getByTestId("directory-count:notes/法律");
    const noteRow = screen.getByText("案例.md");

    expect(directoryContent).toHaveStyle({
      overflow: "hidden",
    });
    expect(directoryContent.style.transition).toContain("max-height");
    expect(directoryTitle.style.transition).toContain("background");
    expect(directoryTitle).toHaveStyle({ fontSize: "14px" });
    expect(noteRow).toHaveStyle({ fontSize: "13px" });
    expect(notebookColorTrigger).toHaveStyle({ width: "8px" });
    expect(notebookColorTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("notebook-icon:notes/法律")).not.toBeInTheDocument();
    expect(directoryCount).toHaveTextContent("1");
    expect(directoryCount).not.toHaveTextContent("篇");
    expect(directoryToggle).toHaveAttribute("aria-expanded", "true");
    expect(noteRow).toBeInTheDocument();

    await user.click(directoryToggle);
    expect(directoryToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("directory-count:notes/法律")).toHaveTextContent("1");
    expect(screen.getByTestId("directory-count:notes/法律")).not.toHaveTextContent("篇");
    await waitFor(() => expect(screen.queryByText("案例.md")).not.toBeInTheDocument());

    await user.click(directoryToggle);
    expect(directoryToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("案例.md")).toBeInTheDocument();
  });

  it("keeps notebook rows neutral and only uses notebook color on the leading color trigger", () => {
    render(<FileTreePanel />);

    const notebookColorTrigger = screen.getByRole("button", { name: "编辑笔记本颜色 法律" });
    const directoryTitle = screen.getByRole("button", { name: "法律" });
    const directoryToggle = screen.getByRole("button", { name: "切换笔记本 法律" });
    const directoryCount = screen.getByTestId("directory-count:notes/法律");
    const rowSurface = directoryTitle.closest("div");

    expect(rowSurface).toHaveStyle({
      background: "transparent",
      color: "#555",
      boxShadow: "none",
    });
    expect(directoryToggle).toHaveStyle({ color: "#555" });
    expect(directoryCount).toHaveStyle({
      background: "#f8fafc",
      color: "#667085",
    });
    expect(notebookColorTrigger).toHaveStyle({ background: "#4b5563" });
  });

  it("uses the default cursor for directories and notes", () => {
    render(<FileTreePanel />);

    const directoryToggle = screen.getByRole("button", { name: "法律" });
    const noteRow = screen.getByText("案例.md");

    expect(directoryToggle).toHaveStyle({ cursor: "default" });
    expect(noteRow).toHaveStyle({ cursor: "default" });
  });

  it("opens a notebook context menu on right click and enables reorder", async () => {
    renderWithContextMenu();

    fireEvent.contextMenu(screen.getByRole("button", { name: "法律" }), {
      clientX: 120,
      clientY: 80,
    });

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建笔记" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "调整顺序" })).toHaveAttribute("aria-disabled", "false");
  });

  it("opens a note context menu on right click and enables rename/move/delete", async () => {
    renderWithContextMenu();

    fireEvent.contextMenu(screen.getByText("案例.md"), {
      clientX: 140,
      clientY: 120,
    });

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开笔记" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "删除笔记" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "移动" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveAttribute("aria-disabled", "false");
  });

  it("renames a note from the note context menu when a new title is confirmed", async () => {
    const user = userEvent.setup();
    hookMocks.renameNote.mockResolvedValue(undefined);

    renderWithContextMenu();

    fireEvent.contextMenu(screen.getByText("案例.md"), {
      clientX: 140,
      clientY: 120,
    });

    await user.click(await screen.findByRole("menuitem", { name: "重命名" }));

    const input = screen.getByRole("textbox", { name: "重命名笔记 案例.md" });
    await user.clear(input);
    await user.type(input, "案例-新版{Enter}");

    await waitFor(() => expect(hookMocks.renameNote).toHaveBeenCalledWith("notes/法律/案例.md", "案例-新版"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "重命名笔记 案例.md" })).not.toBeInTheDocument());
  });

  it("moves a note from the note context menu when a target directory is confirmed", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("notes");

    renderWithContextMenu();

    fireEvent.contextMenu(screen.getByText("案例.md"), {
      clientX: 140,
      clientY: 120,
    });

    await user.click(await screen.findByRole("menuitem", { name: "移动" }));

    expect(promptSpy).toHaveBeenCalled();
    expect(hookMocks.moveNote).toHaveBeenCalledWith("notes/法律/案例.md", "notes");
  });

  it("responds to app menu events for create/import note actions", async () => {
    render(<FileTreePanel />);

    act(() => {
      window.dispatchEvent(new Event("mynote:menu-create-note"));
    });
    expect(await screen.findByPlaceholderText("笔记标题…")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("mynote:menu-create-notebook"));
    });
    expect(await screen.findByPlaceholderText("笔记本名称…")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("mynote:menu-import-note"));
    });
    expect(await screen.findByRole("menu", { name: "导入来源" })).toBeInTheDocument();
  });

  it("responds to app menu rename event for notes", async () => {
    const user = userEvent.setup();
    hookMocks.renameNote.mockResolvedValue(undefined);

    render(<FileTreePanel />);

    act(() => {
      window.dispatchEvent(new CustomEvent("mynote:menu-rename-note", {
        detail: { path: "notes/法律/案例.md", noteTitle: "案例" },
      }));
    });

    const input = await screen.findByRole("textbox", { name: "重命名笔记 案例.md" });
    await user.clear(input);
    await user.type(input, "案例-改名{Enter}");

    await waitFor(() => expect(hookMocks.renameNote).toHaveBeenCalledWith("notes/法律/案例.md", "案例-改名"));
  });

  it("keeps note rename draft and error inline when renameNote fails", async () => {
    const user = userEvent.setup();
    hookMocks.renameNote.mockRejectedValue(new Error("名称已存在"));

    renderWithContextMenu();

    fireEvent.contextMenu(screen.getByText("案例.md"), {
      clientX: 140,
      clientY: 120,
    });

    await user.click(await screen.findByRole("menuitem", { name: "重命名" }));

    const input = screen.getByRole("textbox", { name: "重命名笔记 案例.md" });
    await user.clear(input);
    await user.type(input, "冲突名称{Enter}");

    await waitFor(() => expect(hookMocks.renameNote).toHaveBeenCalledWith("notes/法律/案例.md", "冲突名称"));
    expect(screen.getByRole("textbox", { name: "重命名笔记 案例.md" })).toHaveValue("冲突名称");
    expect(screen.getByText("名称已存在")).toBeInTheDocument();
  });

  it("confirms before deleting a note from the note context menu", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithContextMenu();

    fireEvent.contextMenu(screen.getByText("案例.md"), {
      clientX: 140,
      clientY: 120,
    });

    await user.click(await screen.findByRole("menuitem", { name: "删除笔记" }));

    expect(confirmSpy).toHaveBeenCalledWith("确认删除笔记“案例”并同时删除其附件与图片吗？");
    expect(hookMocks.deleteNote).toHaveBeenCalledWith("notes/法律/案例.md");
  });

  it("shows refresh in the file-tree blank context menu and clears a deleted current note after refresh", async () => {
    const user = userEvent.setup();

    apiMocks.getNoteTree.mockResolvedValueOnce([
      {
        id: null,
        name: "notes",
        path: "notes",
        is_dir: true,
        children: [
          {
            id: null,
            name: "法律",
            path: "notes/法律",
            is_dir: true,
            children: [],
          },
        ],
      },
    ]);

    useAppStore.setState({ selectedNodePath: "notes/法律/案例.md" });
    useEditorStore.setState({
      currentNote: {
        id: "note-1",
        path: "notes/法律/案例.md",
        title: "案例",
        summary: null,
        contentHash: "hash-1",
        wordCount: 12,
        createdAt: "2026-06-09T00:00:00Z",
        updatedAt: "2026-06-09T00:00:00Z",
        indexedAt: "2026-06-09T00:00:00Z",
        deletedAt: null,
      },
      content: "# 案例\n\n正文",
    });

    const { container } = renderWithContextMenu();
    const blankArea = container.querySelector('[data-testid="file-tree-blank-area"]');
    expect(blankArea).not.toBeNull();

    fireEvent.contextMenu(blankArea as Element, {
      clientX: 120,
      clientY: 200,
    });

    expect(await screen.findByRole("menuitem", { name: "刷新笔记仓库" })).toHaveAttribute("aria-disabled", "false");

    await user.click(screen.getByRole("menuitem", { name: "刷新笔记仓库" }));

    await waitFor(() => expect(apiMocks.getNoteTree).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("案例.md")).not.toBeInTheDocument());
    expect(useAppStore.getState().selectedNodePath).toBeNull();
    expect(useEditorStore.getState().currentNote).toBeNull();
    expect(useEditorStore.getState().content).toBe("");
  });

  it("shows a summary badge before note titles when the note has a summary", () => {
    render(<FileTreePanel />);

    expect(screen.getByTestId("summary-badge:notes/法律/案例.md")).toHaveTextContent("摘要");
    expect(screen.queryByTestId("summary-badge:notes/我的笔记.md")).not.toBeInTheDocument();
  });

  it("does not fetch or show note summaries when hovering note titles", async () => {
    const user = userEvent.setup();
    apiMocks.getNoteByPath.mockResolvedValue(
      makeNoteDetail({
        note: makeNoteWithSummary("案例要点摘要", { path: "notes/法律/案例.md" }),
        content: "# 案例\n\nBody",
      }),
    );

    render(<FileTreePanel />);

    await user.hover(screen.getByText("案例.md"));

    expect(apiMocks.getNoteByPath).not.toHaveBeenCalled();
    expect(screen.queryByRole("status", { name: "笔记摘要预览 notes/法律/案例.md" })).not.toBeInTheDocument();
    expect(screen.queryByText("案例要点摘要")).not.toBeInTheDocument();
  });

  it("does not render top-level notebook icons or nested directory icons", () => {
    useAppStore.setState({
      tree: [
        {
          id: null,
          name: "notes",
          path: "notes",
          is_dir: true,
          children: [
            {
              id: null,
              name: "法律",
              path: "notes/法律",
              is_dir: true,
              notebook_icon: "book",
              notebook_color: "blue",
              children: [
                {
                  id: null,
                  name: "案例",
                  path: "notes/法律/案例",
                  is_dir: true,
                  children: [
                    {
                      id: "note-1",
                      name: "判例.md",
                      path: "notes/法律/案例/判例.md",
                      is_dir: false,
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    render(<FileTreePanel />);

    expect(screen.getByRole("button", { name: "编辑笔记本颜色 法律" })).toBeInTheDocument();
    expect(screen.getByTestId("directory-count:notes/法律")).toHaveTextContent("1");
    expect(screen.getByTestId("directory-count:notes/法律")).not.toHaveTextContent("篇");
    expect(screen.queryByTestId("notebook-icon:notes/法律")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notebook-icon:notes/法律/案例")).not.toBeInTheDocument();
  });

  it("does not render notebook icons when top-level notebook metadata is missing", () => {
    useAppStore.setState({
      tree: [
        {
          id: null,
          name: "notes",
          path: "notes",
          is_dir: true,
          children: [
            {
              id: null,
              name: "默认笔记本",
              path: "notes/默认笔记本",
              is_dir: true,
              children: [],
            },
          ],
        },
      ],
    });

    render(<FileTreePanel />);

    expect(screen.getByRole("button", { name: "编辑笔记本颜色 默认笔记本" })).toBeInTheDocument();
    expect(screen.getByTestId("directory-count:notes/默认笔记本")).toHaveTextContent("0");
    expect(screen.getByTestId("directory-count:notes/默认笔记本")).not.toHaveTextContent("篇");
    expect(screen.queryByTestId("notebook-icon:notes/默认笔记本")).not.toBeInTheDocument();
  });

  it("does not render a notebook marker for 未归档", () => {
    render(<FileTreePanel />);

    expect(screen.getByText("未归档")).toBeInTheDocument();
    expect(screen.queryByTestId("notebook-icon:notes/__unarchived__")).not.toBeInTheDocument();
  });

  it("shows inline notebook actions only for top-level notebooks", () => {
    useAppStore.setState({
      tree: [
        {
          id: null,
          name: "notes",
          path: "notes",
          is_dir: true,
          children: [
            {
              id: null,
              name: "项目",
              path: "notes/项目",
              is_dir: true,
              children: [
                {
                  id: null,
                  name: "子目录",
                  path: "notes/项目/子目录",
                  is_dir: true,
                  children: [
                    {
                      id: "note-1",
                      name: "说明.md",
                      path: "notes/项目/子目录/说明.md",
                      is_dir: false,
                      children: [],
                    },
                  ],
                },
              ],
            },
            {
              id: "note-2",
              name: "根笔记.md",
              path: "notes/根笔记.md",
              is_dir: false,
              children: [],
            },
          ],
        },
      ],
    });

    render(<FileTreePanel />);

    const moveUpButton = screen.getByRole("button", { name: "上移笔记本 项目" });
    const moveDownButton = screen.getByRole("button", { name: "下移笔记本 项目" });
    const moveGroup = screen.getByTestId("notebook-move-group:notes/项目");

    expect(moveUpButton).toBeInTheDocument();
    expect(moveDownButton).toBeInTheDocument();
    expect(moveGroup).toContainElement(moveUpButton);
    expect(moveGroup).toContainElement(moveDownButton);
    expect(moveGroup).not.toContainElement(screen.getByRole("button", { name: "删除笔记本 项目" }));
    expect(moveGroup).toHaveStyle({ flexDirection: "column" });
    expect(moveUpButton).toHaveTextContent("▲");
    expect(moveDownButton).toHaveTextContent("▼");
    expect(screen.getByRole("button", { name: "删除笔记本 项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑笔记本颜色 项目" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上移笔记本 子目录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除笔记本 未归档" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除笔记本 根笔记.md" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /更多操作/ })).not.toBeInTheDocument();
  });

  it("hides notebook inline actions until the notebook row is hovered", async () => {
    const user = userEvent.setup();

    render(<FileTreePanel />);

    const notebookTitle = screen.getByRole("button", { name: "法律" });
    const moveGroup = screen.getByTestId("notebook-move-group:notes/法律");
    const deleteButton = screen.getByRole("button", { name: "删除笔记本 法律" });

    expect(moveGroup).not.toBeVisible();
    expect(deleteButton).not.toBeVisible();

    await user.hover(notebookTitle);

    expect(moveGroup).toBeVisible();
    expect(deleteButton).toBeVisible();

    await user.unhover(notebookTitle);

    expect(moveGroup).not.toBeVisible();
    expect(deleteButton).not.toBeVisible();
  });

  it("enters inline rename mode on notebook title double click and saves on Enter", async () => {
    const user = userEvent.setup();
    hookMocks.renameNotebook.mockResolvedValue({
      notebook_path: "notes/项目管理",
      moved_note_paths: [],
    });

    render(<FileTreePanel />);

    await user.dblClick(screen.getByText("法律"));

    const input = screen.getByRole("textbox", { name: "重命名笔记本 法律" });
    await user.clear(input);
    await user.type(input, "项目管理{Enter}");

    await waitFor(() => expect(hookMocks.renameNotebook).toHaveBeenCalledWith("notes/法律", "项目管理"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "重命名笔记本 法律" })).not.toBeInTheDocument());
  });

  it("keeps the rename draft and error inline when renameNotebook fails", async () => {
    const user = userEvent.setup();
    hookMocks.renameNotebook.mockRejectedValue(new Error("名称已存在"));

    render(<FileTreePanel />);

    await user.dblClick(screen.getByText("法律"));

    const input = screen.getByRole("textbox", { name: "重命名笔记本 法律" });
    await user.clear(input);
    await user.type(input, "冲突名称{Enter}");

    await waitFor(() => expect(hookMocks.renameNotebook).toHaveBeenCalledWith("notes/法律", "冲突名称"));
    expect(screen.getByRole("textbox", { name: "重命名笔记本 法律" })).toHaveValue("冲突名称");
    expect(screen.getByText("名称已存在")).toBeInTheDocument();
  });

  it("opens the inline color strip from the accent bar and saves immediately on color click", async () => {
    const user = userEvent.setup();
    hookMocks.updateNotebookVisual.mockResolvedValue(undefined);

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "编辑笔记本颜色 法律" }));
    const orangeSwatch = screen.getByRole("button", { name: "笔记本颜色 橙色" });

    expect(orangeSwatch).not.toHaveTextContent("橙色");

    await user.click(orangeSwatch);

    await waitFor(() => expect(hookMocks.updateNotebookVisual).toHaveBeenCalledWith("notes/法律", "folder", "orange"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "笔记本颜色 橙色" })).not.toBeInTheDocument());
  });

  it("keeps the folder fallback when updating color for notebooks without icon metadata", async () => {
    const user = userEvent.setup();
    hookMocks.updateNotebookVisual.mockResolvedValue(undefined);

    useAppStore.setState({
      tree: [
        {
          id: null,
          name: "notes",
          path: "notes",
          is_dir: true,
          children: [
            {
              id: null,
              name: "默认笔记本",
              path: "notes/默认笔记本",
              is_dir: true,
              children: [],
            },
          ],
        },
      ],
    });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "编辑笔记本颜色 默认笔记本" }));
    await user.click(screen.getByRole("button", { name: "笔记本颜色 橙色" }));

    await waitFor(() => expect(hookMocks.updateNotebookVisual).toHaveBeenCalledWith("notes/默认笔记本", "folder", "orange"));
  });

  it("shows a lightweight delete confirmation inline and confirms deletion", async () => {
    const user = userEvent.setup();
    hookMocks.deleteNotebook.mockResolvedValue(undefined);
    useAppStore.setState({
      tree: [
        {
          id: null,
          name: "notes",
          path: "notes",
          is_dir: true,
          children: [
            {
              id: null,
              name: "空笔记本",
              path: "notes/空笔记本",
              is_dir: true,
              children: [],
            },
          ],
        },
      ],
    });

    render(<FileTreePanel />);

  await user.hover(screen.getByRole("button", { name: "空笔记本" }));
  const deleteNotebookButton = screen.getByRole("button", { name: "删除笔记本 空笔记本" });
  await waitFor(() => expect(deleteNotebookButton).toBeVisible());
  fireEvent.click(deleteNotebookButton);
    expect(screen.getByText("确认删除该笔记本？")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认删除笔记本 空笔记本" }));

    await waitFor(() => expect(hookMocks.deleteNotebook).toHaveBeenCalledWith("notes/空笔记本"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "确认删除笔记本 空笔记本" })).not.toBeInTheDocument());
  });

  it("shows a lightweight delete confirmation inline and keeps it open on delete failure", async () => {
    const user = userEvent.setup();
    hookMocks.deleteNotebook.mockRejectedValue(new Error("只能删除空笔记本"));

    render(<FileTreePanel />);

    await user.hover(screen.getByRole("button", { name: "法律" }));
  const deleteNotebookButton = screen.getByRole("button", { name: "删除笔记本 法律" });
  await waitFor(() => expect(deleteNotebookButton).toBeVisible());
    fireEvent.click(deleteNotebookButton);
    expect(screen.getByText("确认删除该笔记本？")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认删除笔记本 法律" }));

    await waitFor(() => expect(hookMocks.deleteNotebook).toHaveBeenCalledWith("notes/法律"));
    expect(screen.getByRole("button", { name: "确认删除笔记本 法律" })).toBeInTheDocument();
    expect(screen.getByText("只能删除空笔记本")).toBeInTheDocument();
  });

  it("reorders notebooks directly from inline arrow buttons", async () => {
    const user = userEvent.setup();
    hookMocks.reorderNotebooks.mockResolvedValue(undefined);
    useAppStore.setState({
      tree: [
        {
          id: null,
          name: "notes",
          path: "notes",
          is_dir: true,
          children: [
            {
              id: null,
              name: "法律",
              path: "notes/法律",
              is_dir: true,
              children: [],
            },
            {
              id: null,
              name: "产品",
              path: "notes/产品",
              is_dir: true,
              children: [],
            },
            {
              id: null,
              name: "研发",
              path: "notes/研发",
              is_dir: true,
              children: [],
            },
          ],
        },
      ],
    });

    render(<FileTreePanel />);

    expect(screen.getByRole("button", { name: "上移笔记本 法律" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移笔记本 研发" })).toBeDisabled();

    await user.hover(screen.getByRole("button", { name: "产品" }));
    const moveUpButton = screen.getByRole("button", { name: "上移笔记本 产品" });
    await waitFor(() => expect(moveUpButton).toBeVisible());
    fireEvent.click(moveUpButton);
    await waitFor(() => expect(hookMocks.reorderNotebooks).toHaveBeenCalledWith([
      "notes/产品",
      "notes/法律",
      "notes/研发",
    ]));

    hookMocks.reorderNotebooks.mockClear();
    await user.hover(screen.getByRole("button", { name: "产品" }));
    const moveDownButton = screen.getByRole("button", { name: "下移笔记本 产品" });
    await waitFor(() => expect(moveDownButton).toBeVisible());
    fireEvent.click(moveDownButton);
    await waitFor(() => expect(hookMocks.reorderNotebooks).toHaveBeenCalledWith([
      "notes/法律",
      "notes/研发",
      "notes/产品",
    ]));
  });

  it("shows notebook creation action beside the new note action", () => {
    render(<FileTreePanel />);

    expect(screen.getByRole("button", { name: "新建笔记本" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建笔记" })).toBeInTheDocument();
  });

  it("blocks new note creation when there is no notebook and asks the user to create one first", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      tree: [
        {
          id: null,
          name: "notes",
          path: "notes",
          is_dir: true,
          children: [],
        },
      ],
    });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记" }));

    expect(screen.getByText("请先创建笔记本")).toBeInTheDocument();
    expect(hookMocks.createNote).not.toHaveBeenCalled();
  });

  it("opens the notebook creation panel with default icon and color selected", async () => {
    const user = userEvent.setup();

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记本" }));

    expect(screen.getByRole("textbox", { name: "笔记本名称" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "图标 书本" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "颜色 蓝色" })).toHaveAttribute("aria-pressed", "true");
  });

  it("creates a notebook with the default icon and color when pressing Enter", async () => {
    const user = userEvent.setup();
    hookMocks.createNotebook.mockResolvedValue(undefined);

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记本" }));
    const input = screen.getByRole("textbox", { name: "笔记本名称" });
    await user.type(input, "法律");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(hookMocks.createNotebook).toHaveBeenCalledWith("法律", "book", "blue"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "笔记本名称" })).not.toBeInTheDocument());
  });

  it("creates a notebook with the user-selected icon and color", async () => {
    const user = userEvent.setup();
    hookMocks.createNotebook.mockResolvedValue(undefined);

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记本" }));
    await user.type(screen.getByRole("textbox", { name: "笔记本名称" }), "项目");
    await user.click(screen.getByRole("button", { name: "图标 代码" }));
    await user.click(screen.getByRole("button", { name: "颜色 橙色" }));
    await user.click(screen.getByRole("button", { name: "创建笔记本" }));

    await waitFor(() => expect(hookMocks.createNotebook).toHaveBeenCalledWith("项目", "code", "orange"));
  });

  it("cancels notebook creation, closes the panel, and discards draft input", async () => {
    const user = userEvent.setup();

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记本" }));
    await user.type(screen.getByRole("textbox", { name: "笔记本名称" }), "临时草稿");
    await user.click(screen.getByRole("button", { name: "取消创建笔记本" }));

    expect(hookMocks.createNotebook).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "笔记本名称" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建笔记本" }));
    expect(screen.getByRole("textbox", { name: "笔记本名称" })).toHaveValue("");
  });

  it("closes the notebook creation panel on Escape without creating a notebook", async () => {
    const user = userEvent.setup();

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记本" }));
    await user.type(screen.getByRole("textbox", { name: "笔记本名称" }), "临时草稿");
    await user.keyboard("{Escape}");

    expect(hookMocks.createNotebook).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "笔记本名称" })).not.toBeInTheDocument();
  });

  it("creates a note in the explicitly selected notebook", async () => {
    const user = userEvent.setup();
    hookMocks.createNote.mockResolvedValue(undefined);

    useAppStore.setState({
      tree: [
        {
          id: null,
          name: "notes",
          path: "notes",
          is_dir: true,
          children: [
            {
              id: null,
              name: "法律",
              path: "notes/法律",
              is_dir: true,
              children: [],
            },
            {
              id: null,
              name: "产品",
              path: "notes/产品",
              is_dir: true,
              children: [],
            },
          ],
        },
      ],
      selectedNodePath: "notes/产品",
    });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记" }));
    const notebookSelect = screen.getByRole("combobox", { name: "目标笔记本" });
    await user.selectOptions(notebookSelect, "notes/法律");

    const titleInput = screen.getByRole("textbox", { name: "笔记标题" });
    await user.type(titleInput, "合同审查");
    fireEvent.blur(titleInput);

    await waitFor(() => expect(hookMocks.createNote).toHaveBeenCalledWith("notes/法律", "合同审查"));
  });

  it("does not offer 未归档 as a notebook target", async () => {
    const user = userEvent.setup();

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记" }));

    const notebookSelect = screen.getByRole("combobox", { name: "目标笔记本" });
    expect(screen.getByRole("option", { name: "法律" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "未归档" })).not.toBeInTheDocument();
    expect(notebookSelect).toHaveValue("notes/法律");
  });

  it("supports directory import", async () => {
    const user = userEvent.setup();

    dialogMocks.open.mockResolvedValueOnce("/tmp/research");
    apiMocks.importMarkdownSources.mockResolvedValueOnce({
      imported: [
        {
          sourcePath: "/tmp/research/overview.md",
          note: {
            id: "note-imported-1",
            path: "notes/法律/research/overview.md",
            title: "overview",
            summary: null,
            contentHash: "hash-1",
            wordCount: 12,
            createdAt: "2026-06-09T00:00:00Z",
            updatedAt: "2026-06-09T00:00:00Z",
            indexedAt: "2026-06-09T00:00:00Z",
            deletedAt: null,
          },
        },
      ],
      warnings: [],
      failures: [],
    });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "导入笔记" }));
    await user.click(screen.getByRole("menuitem", { name: "导入文件夹" }));

    expect(dialogMocks.open).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(await screen.findByText("research")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "notes/法律" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => expect(apiMocks.importMarkdownSources).toHaveBeenCalledWith({
      sources: [{ kind: "directory", path: "/tmp/research" }],
      destDirectory: "notes",
    }));
  });

  it("anchors the import source menu inside the sidebar without clipping long labels", async () => {
    const user = userEvent.setup();

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "导入笔记" }));

    const menu = screen.getByRole("menu", { name: "导入来源" });
    expect(menu).toHaveStyle({
      left: "auto",
      right: "0px",
      minWidth: "188px",
    });
    expect(screen.getByRole("menuitem", { name: "导入 Markdown 文件" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "导入文件夹" })).toBeInTheDocument();
  });

  it("keeps newly imported nested directories collapsed after the tree refresh", async () => {
    const user = userEvent.setup();
    const refreshTree = vi.fn().mockImplementation(async () => {
      useAppStore.setState({
        tree: [
          {
            id: null,
            name: "notes",
            path: "notes",
            is_dir: true,
            children: [
              {
                id: null,
                name: "法律",
                path: "notes/法律",
                is_dir: true,
                children: [
                  {
                    id: null,
                    name: "research",
                    path: "notes/法律/research",
                    is_dir: true,
                    children: [
                      {
                        id: "note-imported-1",
                        name: "overview.md",
                        path: "notes/法律/research/overview.md",
                        is_dir: false,
                        children: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    useAppStore.setState({ refreshTree });

    dialogMocks.open.mockResolvedValueOnce(["/tmp/research/overview.md"]);
    apiMocks.importMarkdownSources.mockResolvedValueOnce({
      imported: [
        {
          sourcePath: "/tmp/research/overview.md",
          note: {
            id: "note-imported-1",
            path: "notes/法律/research/overview.md",
            title: "overview",
            summary: null,
            contentHash: "hash-1",
            wordCount: 12,
            createdAt: "2026-06-09T00:00:00Z",
            updatedAt: "2026-06-09T00:00:00Z",
            indexedAt: "2026-06-09T00:00:00Z",
            deletedAt: null,
          },
        },
      ],
      warnings: [],
      failures: [],
    });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "导入笔记" }));
    await user.click(screen.getByRole("menuitem", { name: "导入 Markdown 文件" }));
    await user.click(await screen.findByRole("button", { name: "确认导入" }));

    await waitFor(() => expect(refreshTree).toHaveBeenCalled());
    const importedDirectoryToggle = await screen.findByRole("button", { name: "research" });
    expect(importedDirectoryToggle).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByText("overview.md")).not.toBeInTheDocument());
  });

  it("opens the last imported note after a successful batch import with no warnings", async () => {
    const user = userEvent.setup();
    const refreshTree = vi.fn().mockResolvedValue(undefined);

    useAppStore.setState({ refreshTree });

    dialogMocks.open.mockResolvedValueOnce(["/tmp/research/overview.md"]);
    apiMocks.importMarkdownSources.mockResolvedValueOnce({
      imported: [
        {
          sourcePath: "/tmp/research/overview.md",
          note: {
            id: "note-imported-1",
            path: "notes/work/overview.md",
            title: "overview",
            summary: null,
            contentHash: "hash-1",
            wordCount: 12,
            createdAt: "2026-06-09T00:00:00Z",
            updatedAt: "2026-06-09T00:00:00Z",
            indexedAt: "2026-06-09T00:00:00Z",
            deletedAt: null,
          },
        },
      ],
      warnings: [],
      failures: [],
    });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "导入笔记" }));
    await user.click(screen.getByRole("menuitem", { name: "导入 Markdown 文件" }));
    await user.click(await screen.findByRole("button", { name: "确认导入" }));

    await waitFor(() => expect(refreshTree).toHaveBeenCalled());
    await waitFor(() => expect(hookMocks.openNote).toHaveBeenCalledWith("notes/work/overview.md"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("button", { name: "确认导入" })).not.toBeInTheDocument());
  });

  it("keeps warnings visible", async () => {
    const user = userEvent.setup();

    dialogMocks.open.mockResolvedValueOnce(["/tmp/research/overview.md"]);
    apiMocks.importMarkdownSources.mockResolvedValueOnce({
      imported: [
        {
          sourcePath: "/tmp/research/overview.md",
          note: {
            id: "note-imported-1",
            path: "notes/法律/overview.md",
            title: "overview",
            summary: null,
            contentHash: "hash-1",
            wordCount: 12,
            createdAt: "2026-06-09T00:00:00Z",
            updatedAt: "2026-06-09T00:00:00Z",
            indexedAt: "2026-06-09T00:00:00Z",
            deletedAt: null,
          },
        },
      ],
      warnings: [
        {
          sourcePath: "/tmp/research/overview.md",
          message: "Skipped external asset ../shared/cover.png",
        },
      ],
      failures: [],
    });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "导入笔记" }));
    await user.click(screen.getByRole("menuitem", { name: "导入 Markdown 文件" }));
    await user.click(await screen.findByRole("button", { name: "确认导入" }));

    expect(await screen.findByText("Skipped external asset ../shared/cover.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    await waitFor(() => expect(hookMocks.openNote).toHaveBeenCalledWith("notes/法律/overview.md"));
  });

  it("still refreshes and opens the last imported note when some imports fail", async () => {
    const user = userEvent.setup();

    dialogMocks.open.mockResolvedValueOnce(["/tmp/research/overview.md"]);
    apiMocks.importMarkdownSources.mockResolvedValueOnce({
      imported: [
        {
          sourcePath: "/tmp/research/overview.md",
          note: {
            id: "note-imported-1",
            path: "notes/法律/overview.md",
            title: "overview",
            summary: null,
            contentHash: "hash-1",
            wordCount: 12,
            createdAt: "2026-06-09T00:00:00Z",
            updatedAt: "2026-06-09T00:00:00Z",
            indexedAt: "2026-06-09T00:00:00Z",
            deletedAt: null,
          },
        },
      ],
      warnings: [],
      failures: [
        {
          sourcePath: "/tmp/research/broken.md",
          message: "Failed to import markdown file",
        },
      ],
    });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "导入笔记" }));
    await user.click(screen.getByRole("menuitem", { name: "导入 Markdown 文件" }));
    await user.click(await screen.findByRole("button", { name: "确认导入" }));

    expect(await screen.findByText("Failed to import markdown file")).toBeInTheDocument();
    await waitFor(() => expect(hookMocks.openNote).toHaveBeenCalledWith("notes/法律/overview.md"));
  });

  it("normalizes custom import directories under notes", async () => {
    const user = userEvent.setup();

    dialogMocks.open.mockResolvedValueOnce(["/tmp/research/overview.md"]);
    apiMocks.importMarkdownSources.mockResolvedValueOnce({
      imported: [],
      warnings: [],
      failures: [
        {
          sourcePath: "/tmp/research/overview.md",
          message: "Failed to import markdown file",
        },
      ],
    });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "导入笔记" }));
    await user.click(screen.getByRole("menuitem", { name: "导入 Markdown 文件" }));
    await user.click(await screen.findByRole("button", { name: "新目录…" }));

    const customDirInput = screen.getByRole("textbox");
    await user.clear(customDirInput);
    await user.type(customDirInput, "work/2024");
    await user.click(screen.getByRole("button", { name: "确认导入" }));

    await waitFor(() => expect(apiMocks.importMarkdownSources).toHaveBeenCalledWith({
      sources: [{ kind: "file", path: "/tmp/research/overview.md" }],
      destDirectory: "notes/work/2024",
    }));
  });

  it("still allows creating a note while tag filtering is active", async () => {
    const user = userEvent.setup();
    hookMocks.createNote.mockResolvedValue(undefined);
    apiMocks.listNotesByTag.mockResolvedValue([
      {
        id: "note-1",
        path: "notes/法律/案例.md",
        title: "案例.md",
        summary: "标签摘要",
      },
    ]);

    useAppStore.setState({ selectedTagIds: ["tag-1"] });

    render(<FileTreePanel />);

    await waitFor(() => expect(apiMocks.listNotesByTag).toHaveBeenCalledWith(["tag-1"]));
    expect(screen.getByTestId("summary-badge:notes/法律/案例.md")).toHaveTextContent("摘要");
    await user.click(screen.getByRole("button", { name: "新建笔记" }));

    const notebookSelect = screen.getByRole("combobox", { name: "目标笔记本" });
    expect(notebookSelect).toHaveValue("notes/法律");

    const titleInput = screen.getByRole("textbox", { name: "笔记标题" });
    await user.type(titleInput, "筛选态新建");
    fireEvent.blur(titleInput);

    await waitFor(() => expect(hookMocks.createNote).toHaveBeenCalledWith("notes/法律", "筛选态新建"));
  });

  it("recovers notebook choices on tag-filter cold start before creating a note", async () => {
    const user = userEvent.setup();
    hookMocks.createNote.mockResolvedValue(undefined);

    const fullTree: NoteTreeNode[] = [
      {
        id: null,
        name: "notes",
        path: "notes",
        is_dir: true,
        children: [
          {
            id: null,
            name: "法律",
            path: "notes/法律",
            is_dir: true,
            children: [],
          },
        ],
      },
    ];

    apiMocks.getNoteTree.mockResolvedValue(fullTree);
    apiMocks.listNotesByTag.mockResolvedValue([
      {
        id: "note-1",
        path: "notes/法律/案例.md",
        title: "案例.md",
      },
    ]);

    useAppStore.setState({
      tree: [
        {
          id: "note-1",
          name: "案例.md",
          path: "notes/法律/案例.md",
          is_dir: false,
          children: [],
        },
      ],
      selectedTagIds: ["tag-1"],
    });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记" }));

    await waitFor(() => expect(apiMocks.getNoteTree).toHaveBeenCalled());
    const notebookSelect = await screen.findByRole("combobox", { name: "目标笔记本" });
    expect(notebookSelect).toHaveValue("notes/法律");
  });

  it("falls back to the first notebook when the selected node is an unarchived root note", async () => {
    const user = userEvent.setup();

    useAppStore.setState({ selectedNodePath: "notes/我的笔记.md" });

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记" }));

    const notebookSelect = screen.getByRole("combobox", { name: "目标笔记本" });
    expect(notebookSelect).toHaveValue("notes/法律");
  });

  it("keeps the notebook creation draft open when creation fails", async () => {
    const user = userEvent.setup();
    hookMocks.createNotebook.mockResolvedValue(false);

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记本" }));
    await user.type(screen.getByRole("textbox", { name: "笔记本名称" }), "失败草稿");
    await user.click(screen.getByRole("button", { name: "图标 代码" }));
    await user.click(screen.getByRole("button", { name: "颜色 橙色" }));
    await user.click(screen.getByRole("button", { name: "创建笔记本" }));

    expect(hookMocks.createNotebook).toHaveBeenCalledWith("失败草稿", "code", "orange");
    expect(screen.getByRole("textbox", { name: "笔记本名称" })).toHaveValue("失败草稿");
    expect(screen.getByRole("button", { name: "图标 代码" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "颜色 橙色" })).toHaveAttribute("aria-pressed", "true");
  });

  it("moves a note when a file is dropped onto a notebook directory", async () => {
    hookMocks.moveNote.mockResolvedValue(undefined);

    render(<FileTreePanel />);

    const fileNode = screen.getByText("案例.md");
    const notebookNode = screen.getByText("法律");
    const transfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "notes/法律/案例.md"),
      effectAllowed: "",
      dropEffect: "",
    };

    fireEvent.dragStart(fileNode, { dataTransfer: transfer });
    fireEvent.dragOver(notebookNode, { dataTransfer: transfer });
    fireEvent.drop(notebookNode, { dataTransfer: transfer });

    await waitFor(() => expect(hookMocks.moveNote).toHaveBeenCalledWith("notes/法律/案例.md", "notes/法律"));
  });

  it("moves a note through the pointer fallback when native drag events are unavailable", async () => {
    hookMocks.moveNote.mockResolvedValue(undefined);

    render(<FileTreePanel />);

    const fileNode = screen.getByText("案例.md");
    const notebookNode = screen.getByText("法律");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => notebookNode),
    });

    fireEvent.pointerDown(fileNode, { button: 0, pointerType: "mouse", clientX: 20, clientY: 80 });
    fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 20, clientY: 40 });
    fireEvent.pointerUp(window, { pointerType: "mouse", clientX: 20, clientY: 40 });

    await waitFor(() => expect(hookMocks.moveNote).toHaveBeenCalledWith("notes/法律/案例.md", "notes/法律"));
  });

  it("moves a note through the global pointer fallback", async () => {
    hookMocks.moveNote.mockResolvedValue(undefined);

    render(<FileTreePanel />);

    const fileNode = screen.getByText("案例.md");
    const notebookNode = screen.getByText("法律");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => notebookNode),
    });

    fireEvent.pointerDown(fileNode, { button: 0, pointerType: "mouse", clientX: 20, clientY: 80 });
    fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 20, clientY: 40 });
    fireEvent.pointerUp(window, { pointerType: "mouse", clientX: 20, clientY: 40 });

    await waitFor(() => expect(hookMocks.moveNote).toHaveBeenCalledWith("notes/法律/案例.md", "notes/法律"));
  });

  it("moves a note through the global mouse fallback", async () => {
    hookMocks.moveNote.mockResolvedValue(undefined);

    render(<FileTreePanel />);

    const fileNode = screen.getByText("案例.md");
    const notebookNode = screen.getByText("法律");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => notebookNode),
    });

    fireEvent.mouseDown(fileNode, { button: 0, clientX: 20, clientY: 80 });
    fireEvent.mouseMove(window, { button: 0, clientX: 20, clientY: 40 });
    fireEvent.mouseUp(window, { button: 0, clientX: 20, clientY: 40 });

    await waitFor(() => expect(hookMocks.moveNote).toHaveBeenCalledWith("notes/法律/案例.md", "notes/法律"));
  });

  it("highlights a notebook while dragging over it", () => {
    render(<FileTreePanel />);

    const fileNode = screen.getByText("案例.md");
    const notebookNode = screen.getByRole("button", { name: "法律" });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => notebookNode),
    });

    fireEvent.mouseDown(fileNode, { button: 0, clientX: 20, clientY: 80 });
    fireEvent.mouseMove(window, { button: 0, clientX: 20, clientY: 40 });

    expect(notebookNode).toHaveStyle({ background: "rgb(219, 234, 254)" });
  });

  it("shows a note-shaped drag preview while dragging a file", () => {
    render(<FileTreePanel />);

    const fileNode = screen.getByText("案例.md");
    const notebookNode = screen.getByText("法律");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => notebookNode),
    });

    fireEvent.mouseDown(fileNode, { button: 0, clientX: 20, clientY: 80 });
    fireEvent.mouseMove(window, { button: 0, clientX: 92, clientY: 112 });

    const preview = screen.getByTestId("note-drag-preview");
    expect(preview).toHaveTextContent("案例.md");
    expect(preview).toHaveStyle({ left: "80px", top: "100px" });
    expect(preview).toHaveStyle({ background: "rgb(255, 255, 255)" });
    expect(preview).toHaveStyle({ transform: "translate3d(0, 0, 0) rotate(-1deg)" });
  });

  it("clears a missed drag so the next directory click does not move the note", () => {
    hookMocks.moveNote.mockResolvedValue(undefined);
    render(<FileTreePanel />);

    const fileNode = screen.getByText("案例.md");
    const notebookNode = screen.getByText("法律");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => null),
    });

    fireEvent.mouseDown(fileNode, { button: 0, clientX: 20, clientY: 80 });
    fireEvent.mouseMove(window, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.mouseUp(window, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.click(notebookNode);

    expect(hookMocks.moveNote).not.toHaveBeenCalled();
  });

  it("does not move a note when dropped on 未归档", () => {
    render(<FileTreePanel />);

    const unarchivedNode = screen.getByText("未归档");
    fireEvent.drop(unarchivedNode, {
      dataTransfer: {
        getData: () => "notes/我的笔记.md",
      },
    });

    expect(hookMocks.moveNote).not.toHaveBeenCalled();
  });
});
