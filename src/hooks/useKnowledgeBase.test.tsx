import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKnowledgeBase } from "./useKnowledgeBase";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";
import { makeNote } from "../test/testData";
import type { RenameNotebookResult } from "../types";

const apiMocks = vi.hoisted(() => ({
  createNote: vi.fn(),
  createNotebook: vi.fn(),
  moveNote: vi.fn(),
  renameNote: vi.fn(),
  renameNotebook: vi.fn(),
  updateNotebookVisual: vi.fn(),
  deleteNotebook: vi.fn(),
  deleteNote: vi.fn(),
  reorderNotebooks: vi.fn(),
}));

const openNoteMock = vi.hoisted(() => vi.fn());

vi.mock("../api/commands", () => ({
  api: apiMocks,
}));

vi.mock("./useOpenNote", () => ({
  useOpenNote: () => ({ openNote: openNoteMock }),
}));

describe("useKnowledgeBase", () => {
  beforeEach(() => {
    apiMocks.createNote.mockReset();
    apiMocks.createNotebook.mockReset();
    apiMocks.moveNote.mockReset();
    apiMocks.renameNote.mockReset();
    apiMocks.renameNotebook.mockReset();
    apiMocks.updateNotebookVisual.mockReset();
    apiMocks.deleteNotebook.mockReset();
    apiMocks.deleteNote.mockReset();
    apiMocks.reorderNotebooks.mockReset();
    openNoteMock.mockReset();
    useAppStore.setState({ tree: [], error: null, selectedNodePath: null });
    useEditorStore.setState({
      currentNote: null,
      content: "",
      isComposing: false,
      isDirty: false,
      isSaving: false,
      saveError: null,
      saveStatus: "saved",
      showPreview: true,
      tagNavigationTarget: null,
    });
  });

  it("creates a notebook with icon and color metadata", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ refreshTree });
    apiMocks.createNotebook.mockResolvedValue("notes/法律");

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.createNotebook("法律", "book", "blue");
    });

    expect(apiMocks.createNotebook).toHaveBeenCalledWith("法律", "book", "blue");
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(openNoteMock).not.toHaveBeenCalled();
  });

  it("moves a note through the api and refreshes the tree", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ refreshTree });
    apiMocks.moveNote.mockResolvedValue(makeNote({ path: "notes/法律/合同审查.md" }));

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.moveNote("notes/source/合同审查.md", "notes/法律");
    });

    expect(apiMocks.moveNote).toHaveBeenCalledWith("notes/source/合同审查.md", "notes/法律");
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(openNoteMock).not.toHaveBeenCalled();
  });

  it("updates the current note path when moving the active note", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    const currentNote = makeNote({ path: "notes/source/合同审查.md" });
    const movedNote = makeNote({ path: "notes/法律/合同审查.md" });

    useAppStore.setState({ refreshTree, selectedNodePath: currentNote.path });
    useEditorStore.setState({ currentNote, content: "content" });
    apiMocks.moveNote.mockResolvedValue(movedNote);

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.moveNote(currentNote.path, "notes/法律");
    });

    expect(useEditorStore.getState().currentNote?.path).toBe(movedNote.path);
    expect(useAppStore.getState().selectedNodePath).toBe(movedNote.path);
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(openNoteMock).not.toHaveBeenCalled();
  });

  it("renames a notebook and updates the current note path when needed", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    const currentNote = makeNote({ path: "notes/source/合同审查.md" });
    const renameResult: RenameNotebookResult = {
      notebook_path: "notes/target",
      moved_note_paths: [["notes/source/合同审查.md", "notes/target/合同审查.md"]],
    };

    useAppStore.setState({ refreshTree, selectedNodePath: currentNote.path });
    useEditorStore.setState({ currentNote, content: "content" });
    apiMocks.renameNotebook.mockResolvedValue(renameResult);

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.renameNotebook("notes/source", "target");
    });

    expect(apiMocks.renameNotebook).toHaveBeenCalledWith("notes/source", "target");
    expect(useEditorStore.getState().currentNote?.path).toBe("notes/target/合同审查.md");
    expect(useAppStore.getState().selectedNodePath).toBe("notes/target/合同审查.md");
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  it("renames a note and updates selected/current note path", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    const currentNote = makeNote({ path: "notes/source/合同审查.md" });
    const renamedNote = makeNote({ path: "notes/source/合同审查-新版.md" });

    useAppStore.setState({ refreshTree, selectedNodePath: currentNote.path });
    useEditorStore.setState({ currentNote, content: "content" });
    apiMocks.renameNote.mockResolvedValue(renamedNote);

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.renameNote(currentNote.path, "合同审查-新版");
    });

    expect(apiMocks.renameNote).toHaveBeenCalledWith("notes/source/合同审查.md", "合同审查-新版");
    expect(useEditorStore.getState().currentNote?.path).toBe("notes/source/合同审查-新版.md");
    expect(useAppStore.getState().selectedNodePath).toBe("notes/source/合同审查-新版.md");
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  it("renames a notebook and updates the selected notebook path when the notebook itself is selected", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    const renameResult: RenameNotebookResult = {
      notebook_path: "notes/renamed",
      moved_note_paths: [["notes/source/合同审查.md", "notes/renamed/合同审查.md"]],
    };

    useAppStore.setState({ refreshTree, selectedNodePath: "notes/source" });
    apiMocks.renameNotebook.mockResolvedValue(renameResult);

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.renameNotebook("notes/source", "renamed");
    });

    expect(useAppStore.getState().selectedNodePath).toBe("notes/renamed");
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  it("renames a notebook and updates the selected nested directory path", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    const renameResult: RenameNotebookResult = {
      notebook_path: "notes/renamed",
      moved_note_paths: [["notes/source/nested/合同审查.md", "notes/renamed/nested/合同审查.md"]],
    };

    useAppStore.setState({ refreshTree, selectedNodePath: "notes/source/nested" });
    apiMocks.renameNotebook.mockResolvedValue(renameResult);

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.renameNotebook("notes/source", "renamed");
    });

    expect(useAppStore.getState().selectedNodePath).toBe("notes/renamed/nested");
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  it("updates notebook visuals through the api and refreshes the tree", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ refreshTree });
    apiMocks.updateNotebookVisual.mockResolvedValue(undefined);

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.updateNotebookVisual("notes/work", "star", "orange");
    });

    expect(apiMocks.updateNotebookVisual).toHaveBeenCalledWith("notes/work", "star", "orange");
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  it("deletes an empty notebook through the api and refreshes the tree", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ refreshTree, selectedNodePath: "notes/work" });
    apiMocks.deleteNotebook.mockResolvedValue(undefined);

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.deleteNotebook("notes/work");
    });

    expect(apiMocks.deleteNotebook).toHaveBeenCalledWith("notes/work");
    expect(useAppStore.getState().selectedNodePath).toBeNull();
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  it("reorders notebooks through the api and refreshes the tree", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ refreshTree });
    apiMocks.reorderNotebooks.mockResolvedValue(undefined);

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.reorderNotebooks(["notes/beta", "notes/alpha"]);
    });

    expect(apiMocks.reorderNotebooks).toHaveBeenCalledWith(["notes/beta", "notes/alpha"]);
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  it("deletes a note through the api and clears current selection/editor when deleting current note", async () => {
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    const current = makeNote({ path: "notes/work/demo.md" });
    useAppStore.setState({ refreshTree, selectedNodePath: current.path });
    useEditorStore.setState({ currentNote: current, content: "# demo" });
    apiMocks.deleteNote.mockResolvedValue(undefined);

    const { result } = renderHook(() => useKnowledgeBase());

    await act(async () => {
      await result.current.deleteNote(current.path);
    });

    expect(apiMocks.deleteNote).toHaveBeenCalledWith("notes/work/demo.md");
    expect(useAppStore.getState().selectedNodePath).toBeNull();
    expect(useEditorStore.getState().currentNote).toBeNull();
    expect(useEditorStore.getState().content).toBe("");
    expect(refreshTree).toHaveBeenCalledTimes(1);
  });
});
