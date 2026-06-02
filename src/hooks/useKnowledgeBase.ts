import { useCallback } from "react";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";
import { useOpenNote } from "./useOpenNote";

export function useKnowledgeBase() {
  const refreshTree = useAppStore((s) => s.refreshTree);
  const setSelectedNodePath = useAppStore((s) => s.setSelectedNodePath);
  const currentNote = useEditorStore((s) => s.currentNote);
  const setCurrentNote = useEditorStore((s) => s.setCurrentNote);
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

  const createNotebook = useCallback(async (name: string) => {
    try {
      await api.createNotebook(name);
      await refreshTree();
    } catch (e) {
      console.error("Failed to create notebook:", e);
    }
  }, [refreshTree]);

  const moveNote = useCallback(async (sourcePath: string, targetDirectory: string) => {
    try {
      const movedNote = await api.moveNote(sourcePath, targetDirectory);
      if (currentNote?.path === sourcePath) {
        setCurrentNote(movedNote);
        setSelectedNodePath(movedNote.path);
      }
      await refreshTree();
    } catch (e) {
      console.error("Failed to move note:", e);
    }
  }, [currentNote?.path, refreshTree, setCurrentNote, setSelectedNodePath]);

  return { createNote, createNotebook, moveNote };
}
