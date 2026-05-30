import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAutoSave } from "./useAutoSave";
import { useEditorStore } from "../store/useEditorStore";
import { deferred, makeNote, makeSaveNoteResult } from "../test/testData";
import type { SaveNoteResult } from "../types";

const invokeMock = vi.mocked(invoke);

function setDirtyNote(note = makeNote(), content = "# Changed\n\nDraft body") {
  act(() => {
    const store = useEditorStore.getState();
    store.setCurrentNote(note);
    store.setContent(content);
    store.markDirty();
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useAutoSave", () => {
  it("saves a dirty current note after the 800ms debounce and marks it saved", async () => {
    vi.useFakeTimers();
    const note = makeNote({ id: "note1", content_hash: "hash-before" });
    const savedNote = makeNote({ id: "note1", content_hash: "hash-after" });
    invokeMock.mockResolvedValueOnce(makeSaveNoteResult({ note: savedNote }));
    setDirtyNote(note, "# Updated content");

    renderHook(() => useAutoSave());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    expect(invokeMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(invokeMock).toHaveBeenCalledWith("save_note", {
      noteId: "note1",
      content: "# Updated content",
      expectedHash: "hash-before",
    });
    await flushMicrotasks();
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(useEditorStore.getState().currentNote?.content_hash).toBe("hash-after");
    expect(useEditorStore.getState().saveStatus).toBe("saved");
    expect(useEditorStore.getState().saveError).toBeNull();
  });

  it("sets the conflict error, leaves the note dirty, and does not mark it saved", async () => {
    vi.useFakeTimers();
    const note = makeNote({ id: "note1", content_hash: "hash-before" });
    const conflictNote = makeNote({ id: "note1", content_hash: "conflict-copy-hash" });
    invokeMock.mockResolvedValueOnce(makeSaveNoteResult({ note: conflictNote, conflict: true }));
    setDirtyNote(note, "# Conflicting content");

    renderHook(() => useAutoSave());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    await flushMicrotasks();
    expect(useEditorStore.getState().saveError).toBe("检测到外部修改，已将当前内容保存为冲突副本");
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().saveStatus).toBe("error");
    expect(useEditorStore.getState().currentNote?.content_hash).toBe("hash-before");
  });

  it("does not let an old save result overwrite a newly selected current note", async () => {
    vi.useFakeTimers();
    const oldNote = makeNote({ id: "old-note", content_hash: "old-hash" });
    const newNote = makeNote({ id: "new-note", content_hash: "new-hash" });
    const oldSave = deferred<SaveNoteResult>();
    const newSave = deferred<SaveNoteResult>();
    invokeMock.mockReturnValueOnce(oldSave.promise).mockReturnValueOnce(newSave.promise);
    setDirtyNote(oldNote, "# Old draft");

    renderHook(() => useAutoSave());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(invokeMock).toHaveBeenCalledWith("save_note", {
      noteId: "old-note",
      content: "# Old draft",
      expectedHash: "old-hash",
    });

    act(() => {
      const store = useEditorStore.getState();
      store.setCurrentNote(newNote);
      store.setContent("# New draft");
      store.markDirty();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(invokeMock).toHaveBeenCalledWith("save_note", {
      noteId: "new-note",
      content: "# New draft",
      expectedHash: "new-hash",
    });

    await act(async () => {
      oldSave.resolve(makeSaveNoteResult({ note: makeNote({ id: "old-note", content_hash: "old-hash-saved" }) }));
      await oldSave.promise;
    });

    expect(useEditorStore.getState().currentNote?.id).toBe("new-note");
    expect(useEditorStore.getState().currentNote?.content_hash).toBe("new-hash");
    expect(useEditorStore.getState().content).toBe("# New draft");
    expect(useEditorStore.getState().isDirty).toBe(true);

    await act(async () => {
      newSave.resolve(makeSaveNoteResult({ note: makeNote({ id: "new-note", content_hash: "new-hash-saved" }) }));
      await newSave.promise;
    });

    await flushMicrotasks();
    expect(useEditorStore.getState().currentNote?.content_hash).toBe("new-hash-saved");
    expect(useEditorStore.getState().isDirty).toBe(false);
  });
});