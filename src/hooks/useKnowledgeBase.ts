import { useCallback } from "react";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";

export function useKnowledgeBase() {
  const { refreshTree } = useAppStore();
  const { setCurrentNote, setContent } = useEditorStore();

  const createNote = useCallback(async (directory: string, title: string) => {
    try {
      const note = await api.createNote(directory, title);
      await refreshTree();
      const detail = await api.getNoteByPath(note.path);
      setCurrentNote(detail.note);
      setContent(detail.content);
    } catch (e) {
      console.error("Failed to create note:", e);
    }
  }, [refreshTree, setCurrentNote, setContent]);

  return { createNote };
}
