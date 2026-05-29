import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/useEditorStore";
import { api } from "../api/commands";

const AUTO_SAVE_DELAY_MS = 800;

export function useAutoSave() {
  const { currentNote, content, isDirty, markSaved, setSaving, setSaveError } = useEditorStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isDirty || !currentNote) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const result = await api.saveNote(
          currentNote.id,
          content,
          lastSavedHashRef.current ?? currentNote.content_hash
        );
        if (result.conflict) {
          setSaveError("检测到外部修改，已将当前内容保存为冲突副本");
        } else {
          lastSavedHashRef.current = result.note.content_hash;
          markSaved(result.note);
        }
      } catch (e) {
        setSaveError(String(e));
      }
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isDirty, content, currentNote]);

  useEffect(() => {
    if (currentNote) {
      lastSavedHashRef.current = currentNote.content_hash;
    }
  }, [currentNote?.id]);
}
