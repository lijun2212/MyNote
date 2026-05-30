import { useCallback } from "react";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";
import { useOpenNote } from "./useOpenNote";

export function useKnowledgeBase() {
  const { refreshTree } = useAppStore();
  const { openNote } = useOpenNote();

  const createNote = useCallback(async (directory: string, title: string) => {
    try {
      const note = await api.createNote(directory, title);
      await refreshTree();
      await openNote(note.path);
    } catch (e) {
      console.error("Failed to create note:", e);
    }
  }, [refreshTree, openNote]);

  return { createNote };
}
