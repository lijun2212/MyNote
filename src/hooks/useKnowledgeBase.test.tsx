import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKnowledgeBase } from "./useKnowledgeBase";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";
import { makeNote } from "../test/testData";

const apiMocks = vi.hoisted(() => ({
  createNote: vi.fn(),
  createNotebook: vi.fn(),
  moveNote: vi.fn(),
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
});
