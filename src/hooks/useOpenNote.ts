import { useCallback } from "react";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";

let nextOpenRequestId = 0;
let latestOpenRequestId = 0;

export function useOpenNote() {
  const setSelectedNodePath = useAppStore((s) => s.setSelectedNodePath);
  const setCurrentNote = useEditorStore((s) => s.setCurrentNote);
  const setContent = useEditorStore((s) => s.setContent);

  const beginOpenNote = useCallback(() => {
    const requestId = ++nextOpenRequestId;
    latestOpenRequestId = requestId;
    return requestId;
  }, []);

  const isOpenNoteRequestCurrent = useCallback((requestId: number) => (
    requestId === latestOpenRequestId
  ), []);

  const openNote = useCallback(async (path: string, existingRequestId?: number) => {
    const requestId = existingRequestId ?? beginOpenNote();
    if (requestId !== latestOpenRequestId) return;

    setSelectedNodePath(path);

    try {
      const detail = await api.getNoteByPath(path);
      if (requestId !== latestOpenRequestId) return;
      setCurrentNote(detail.note);
      setContent(detail.content);
    } catch (e) {
      if (requestId !== latestOpenRequestId) return;
      console.error("Failed to open note:", e);
    }
  }, [beginOpenNote, setSelectedNodePath, setCurrentNote, setContent]);

  return { openNote, beginOpenNote, isOpenNoteRequestCurrent };
}