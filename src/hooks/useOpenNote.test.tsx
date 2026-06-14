import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenNote } from "./useOpenNote";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";
import { useLookbackSummaryStore } from "../store/useLookbackSummaryStore";
import { deferred, makeNoteDetail, makeNoteWithSummary } from "../test/testData";
import type { NoteDetail } from "../types";

const editorStoreActions = {
  setEditorMode: useEditorStore.getState().setEditorMode,
  setViewMode: useEditorStore.getState().setViewMode,
};

const apiMocks = vi.hoisted(() => ({
  getNoteByPath: vi.fn(),
}));

vi.mock("../api/commands", () => ({
  api: apiMocks,
}));

describe("useOpenNote", () => {
  beforeEach(() => {
    apiMocks.getNoteByPath.mockReset();
    useLookbackSummaryStore.getState().resetForTest();
    useAppStore.setState({ selectedNodePath: null, error: null });
    useEditorStore.setState({
      currentNote: null,
      content: "",
      isOpeningNote: false,
      openingNotePath: null,
      isComposing: false,
      isDirty: false,
      isSaving: false,
      saveError: null,
      saveStatus: "saved",
      viewMode: "split",
      showPreview: true,
      searchNavigationTarget: null,
      tagNavigationTarget: null,
      setEditorMode: editorStoreActions.setEditorMode,
      setViewMode: editorStoreActions.setViewMode,
    });
  });

  it("records a recent view only after a successful open", async () => {
    const detail = makeNoteDetail({
      note: makeNoteWithSummary("摘要", { path: "notes/demo.md" }),
      content: "# Demo\n\nBody",
    });
    apiMocks.getNoteByPath.mockResolvedValue(detail);

    const { result } = renderHook(() => useOpenNote());

    await act(async () => {
      await result.current.openNote("notes/demo.md");
    });

    expect(useAppStore.getState().selectedNodePath).toBe("notes/demo.md");
    expect(useEditorStore.getState().currentNote).toEqual(detail.note);
    expect(useEditorStore.getState().content).toBe(detail.content);
    expect(useEditorStore.getState().isOpeningNote).toBe(false);
    expect(useLookbackSummaryStore.getState().getRecentOpenCount("notes/demo.md")).toBe(1);
  });

  it("restores split view mode when opening a note from preview", async () => {
    const detail = makeNoteDetail({
      note: makeNoteWithSummary("摘要", { path: "notes/demo.md" }),
      content: "# Demo\n\nBody",
    });
    apiMocks.getNoteByPath.mockResolvedValue(detail);
    useEditorStore.setState({ viewMode: "preview", showPreview: true });

    const { result } = renderHook(() => useOpenNote());

    await act(async () => {
      await result.current.openNote("notes/demo.md");
    });

    expect(useEditorStore.getState().viewMode).toBe("split");
    expect(useEditorStore.getState().showPreview).toBe(true);
  });

  it("restores split view mode when opening a note from editor", async () => {
    const detail = makeNoteDetail({
      note: makeNoteWithSummary("摘要", { path: "notes/demo.md" }),
      content: "# Demo\n\nBody",
    });
    apiMocks.getNoteByPath.mockResolvedValue(detail);
    useEditorStore.setState({ viewMode: "editor", showPreview: false });

    const { result } = renderHook(() => useOpenNote());

    await act(async () => {
      await result.current.openNote("notes/demo.md");
    });

    expect(useEditorStore.getState().viewMode).toBe("split");
    expect(useEditorStore.getState().showPreview).toBe(true);
  });

  it("restores split through the viewMode model after a successful open", async () => {
    const detail = makeNoteDetail({
      note: makeNoteWithSummary("摘要", { path: "notes/demo.md" }),
      content: "# Demo\n\nBody",
    });
    apiMocks.getNoteByPath.mockResolvedValue(detail);
    useEditorStore.setState({
      viewMode: "editor",
      showPreview: false,
      setEditorMode: vi.fn(),
    });

    const { result } = renderHook(() => useOpenNote());

    await act(async () => {
      await result.current.openNote("notes/demo.md");
    });

    expect(useEditorStore.getState().viewMode).toBe("split");
    expect(useEditorStore.getState().showPreview).toBe(true);
  });

  it("sets opening note status while loading and clears it afterwards", async () => {
    const pending = deferred<NoteDetail>();
    apiMocks.getNoteByPath.mockReturnValueOnce(pending.promise);

    const { result } = renderHook(() => useOpenNote());
    const openingPromise = act(async () => {
      await result.current.openNote("notes/slow.md");
    });

    expect(useEditorStore.getState().isOpeningNote).toBe(true);
    expect(useEditorStore.getState().openingNotePath).toBe("notes/slow.md");

    pending.resolve(makeNoteDetail({
      note: makeNoteWithSummary("摘要", { path: "notes/slow.md" }),
      content: "# Slow\n\nBody",
    }));
    await openingPromise;

    expect(useEditorStore.getState().isOpeningNote).toBe(false);
    expect(useEditorStore.getState().openingNotePath).toBeNull();
  });

  it("does not record a recent view for a stale open request", async () => {
    const staleOpen = deferred<NoteDetail>();
    const currentDetail = makeNoteDetail({
      note: makeNoteWithSummary("新摘要", { id: "note2", path: "notes/current.md" }),
      content: "# Current\n\nBody",
    });
    apiMocks.getNoteByPath.mockReturnValueOnce(staleOpen.promise).mockResolvedValueOnce(currentDetail);

    const { result } = renderHook(() => useOpenNote());

    const staleRequestId = result.current.beginOpenNote();
    void result.current.openNote("notes/stale.md", staleRequestId);

    const currentRequestId = result.current.beginOpenNote();
    await act(async () => {
      await result.current.openNote("notes/current.md", currentRequestId);
    });

    await act(async () => {
      staleOpen.resolve(makeNoteDetail({
        note: makeNoteWithSummary("旧摘要", { id: "note1", path: "notes/stale.md" }),
        content: "# Stale\n\nBody",
      }));
      await Promise.resolve();
    });

    expect(useEditorStore.getState().currentNote).toEqual(currentDetail.note);
    expect(useLookbackSummaryStore.getState().getRecentOpenCount("notes/current.md")).toBe(1);
    expect(useLookbackSummaryStore.getState().getRecentOpenCount("notes/stale.md")).toBe(0);
  });

  it("does not record a recent view when opening a note fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    apiMocks.getNoteByPath.mockRejectedValueOnce(new Error("open failed"));
    useEditorStore.setState({ viewMode: "preview", showPreview: true });

    const { result } = renderHook(() => useOpenNote());

    await act(async () => {
      await result.current.openNote("notes/fail.md");
    });

    expect(useAppStore.getState().selectedNodePath).toBe("notes/fail.md");
    expect(useEditorStore.getState().currentNote).toBeNull();
    expect(useEditorStore.getState().viewMode).toBe("preview");
    expect(useEditorStore.getState().showPreview).toBe(true);
    expect(useLookbackSummaryStore.getState().getRecentOpenCount("notes/fail.md")).toBe(0);
    expect(consoleError).toHaveBeenCalled();
  });
});