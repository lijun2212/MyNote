import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/useEditorStore";
import { api } from "../api/commands";

const AUTO_SAVE_DELAY_MS = 800;

export function useAutoSave() {
  const { currentNote, content, isDirty, markSaved, setSaving, setSaveError } = useEditorStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedHashRef = useRef<string | null>(null);
  const saveRequestIdRef = useRef(0);

  useEffect(() => {
    if (!isDirty || !currentNote) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const noteId = currentNote.id;
      const expectedHash = lastSavedHashRef.current ?? currentNote.content_hash;
      const contentToSave = content;
      const requestId = ++saveRequestIdRef.current;

      setSaving(true);
      try {
        const result = await api.saveNote(noteId, contentToSave, expectedHash);
        const state = useEditorStore.getState();
        const stillSameNote = requestId === saveRequestIdRef.current
          && state.currentNote?.id === noteId;

        if (!stillSameNote) return;

        if (!result.conflict) {
          lastSavedHashRef.current = result.note.content_hash;
        }

        if (state.content !== contentToSave) return;

        if (result.conflict) {
          setSaveError("检测到外部修改，已将当前内容保存为冲突副本");
        } else {
          markSaved(result.note);
        }
      } catch (e) {
        const state = useEditorStore.getState();
        if (requestId === saveRequestIdRef.current && state.currentNote?.id === noteId) {
          setSaveError(String(e));
        }
      } finally {
        const state = useEditorStore.getState();
        if (requestId === saveRequestIdRef.current && state.currentNote?.id === noteId) {
          setSaving(false);
        }
      }
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isDirty, content, currentNote, markSaved, setSaving, setSaveError]);

  useEffect(() => {
    if (currentNote) {
      lastSavedHashRef.current = currentNote.content_hash;
    }
  }, [currentNote?.id]);
}
