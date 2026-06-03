import { useCallback } from "react";
import { api } from "../api/commands";
import type { RenameNotebookResult } from "../types";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";
import { useOpenNote } from "./useOpenNote";

export function useKnowledgeBase() {
  const refreshTree = useAppStore((s) => s.refreshTree);
  const selectedNodePath = useAppStore((s) => s.selectedNodePath);
  const setSelectedNodePath = useAppStore((s) => s.setSelectedNodePath);
  const currentNote = useEditorStore((s) => s.currentNote);
  const setCurrentNote = useEditorStore((s) => s.setCurrentNote);
  const { openNote } = useOpenNote();

  const resolveRenamedPath = useCallback((
    result: RenameNotebookResult,
    path: string | null,
    oldNotebookPath: string,
  ) => {
    if (!path) {
      return null;
    }
    if (path === oldNotebookPath) {
      return result.notebook_path;
    }
    if (path.startsWith(`${oldNotebookPath}/`)) {
      return `${result.notebook_path}${path.slice(oldNotebookPath.length)}`;
    }
    return result.moved_note_paths.find(([sourcePath]) => sourcePath === path)?.[1] ?? path;
  }, []);

  const createNote = useCallback(async (directory: string, title: string) => {
    try {
      const note = await api.createNote(directory, title);
      await refreshTree();
      await openNote(note.path);
    } catch (e) {
      console.error("Failed to create note:", e);
    }
  }, [refreshTree, openNote]);

  const createNotebook = useCallback(async (name: string, icon: string, color: string) => {
    try {
      await api.createNotebook(name, icon, color);
      await refreshTree();
      return true;
    } catch (e) {
      console.error("Failed to create notebook:", e);
      return false;
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

  const renameNotebook = useCallback(async (oldPath: string, newName: string) => {
    try {
      const result = await api.renameNotebook(oldPath, newName);
      const nextCurrentNotePath = resolveRenamedPath(result, currentNote?.path ?? null, oldPath);
      if (currentNote && nextCurrentNotePath && nextCurrentNotePath !== currentNote.path) {
        setCurrentNote({ ...currentNote, path: nextCurrentNotePath });
      }

      const nextSelectedNodePath = resolveRenamedPath(result, selectedNodePath, oldPath);
      if (nextSelectedNodePath !== selectedNodePath) {
        setSelectedNodePath(nextSelectedNodePath);
      }

      await refreshTree();
      return result;
    } catch (e) {
      console.error("Failed to rename notebook:", e);
      throw e;
    }
  }, [currentNote, refreshTree, resolveRenamedPath, selectedNodePath, setCurrentNote, setSelectedNodePath]);

  const updateNotebookVisual = useCallback(async (notebookPath: string, icon: string, color: string) => {
    try {
      await api.updateNotebookVisual(notebookPath, icon, color);
      await refreshTree();
    } catch (e) {
      console.error("Failed to update notebook visual:", e);
      throw e;
    }
  }, [refreshTree]);

  const deleteNotebook = useCallback(async (notebookPath: string) => {
    try {
      await api.deleteNotebook(notebookPath);
      if (selectedNodePath === notebookPath) {
        setSelectedNodePath(null);
      }
      await refreshTree();
    } catch (e) {
      console.error("Failed to delete notebook:", e);
      throw e;
    }
  }, [refreshTree, selectedNodePath, setSelectedNodePath]);

  const reorderNotebooks = useCallback(async (orderedPaths: string[]) => {
    try {
      await api.reorderNotebooks(orderedPaths);
      await refreshTree();
    } catch (e) {
      console.error("Failed to reorder notebooks:", e);
      throw e;
    }
  }, [refreshTree]);

  return {
    createNote,
    createNotebook,
    moveNote,
    renameNotebook,
    updateNotebookVisual,
    deleteNotebook,
    reorderNotebooks,
  };
}
