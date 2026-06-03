import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileTreePanel } from "./FileTreePanel";
import { useAppStore } from "../../store/useAppStore";
import { makeKnowledgeBase } from "../../test/testData";
import type { NoteTreeNode } from "../../types";

const hookMocks = vi.hoisted(() => ({
  createNote: vi.fn(),
  createNotebook: vi.fn(),
  moveNote: vi.fn(),
  openNote: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("../../hooks/useKnowledgeBase", () => ({
  useKnowledgeBase: () => ({
    createNote: hookMocks.createNote,
    createNotebook: hookMocks.createNotebook,
    moveNote: hookMocks.moveNote,
  }),
}));

vi.mock("../../hooks/useOpenNote", () => ({
  useOpenNote: () => ({
    openNote: hookMocks.openNote,
  }),
}));

vi.mock("../../api/commands", () => ({
  api: {
    listNotesByTag: vi.fn(),
  },
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
    hookMocks.openNote.mockReset();

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

    useAppStore.setState({
      kb: makeKnowledgeBase(),
      tree,
      selectedNodePath: null,
      selectedTagIds: [],
      refreshTree: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("renders notebooks and groups root notes under 未归档", () => {
    render(<FileTreePanel />);

    expect(screen.getByText("法律")).toBeInTheDocument();
    expect(screen.getByText("未归档")).toBeInTheDocument();
    expect(screen.getByText("我的笔记.md")).toBeInTheDocument();
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

  it("creates a notebook through the knowledge base hook", async () => {
    const user = userEvent.setup();
    hookMocks.createNotebook.mockResolvedValue(undefined);

    render(<FileTreePanel />);

    await user.click(screen.getByRole("button", { name: "新建笔记本" }));
    const input = screen.getByRole("textbox", { name: "笔记本名称" });
    await user.type(input, "法律");
    fireEvent.blur(input);

    await waitFor(() => expect(hookMocks.createNotebook).toHaveBeenCalledWith("法律"));
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
    const notebookNode = screen.getByText("法律");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => notebookNode),
    });

    fireEvent.mouseDown(fileNode, { button: 0, clientX: 20, clientY: 80 });
    fireEvent.mouseMove(window, { button: 0, clientX: 20, clientY: 40 });

    expect(notebookNode.parentElement).toHaveStyle({ background: "rgb(219, 234, 254)" });
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
