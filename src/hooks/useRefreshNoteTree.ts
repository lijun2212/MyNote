import { useCallback } from "react";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";
import type { NoteTreeNode } from "../types";

function mapTagNotesToTree(notes: Awaited<ReturnType<typeof api.listNotesByTag>>) {
  return notes.map((note) => ({
    id: note.id,
    name: note.title,
    path: note.path,
    is_dir: false,
    has_summary: Boolean(note.summary?.trim()),
    children: [],
  }));
}

function treeContainsPath(nodes: NoteTreeNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.path === path) {
      return true;
    }
    if (node.is_dir && treeContainsPath(node.children, path)) {
      return true;
    }
  }
  return false;
}

export function useRefreshNoteTree() {
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const selectedNodePath = useAppStore((state) => state.selectedNodePath);
  const setTree = useAppStore((state) => state.setTree);
  const setError = useAppStore((state) => state.setError);
  const setSelectedNodePath = useAppStore((state) => state.setSelectedNodePath);
  const currentNote = useEditorStore((state) => state.currentNote);
  const setCurrentNote = useEditorStore((state) => state.setCurrentNote);
  const setContent = useEditorStore((state) => state.setContent);
  const setSearchNavigationTarget = useEditorStore((state) => state.setSearchNavigationTarget);
  const setTagNavigationTarget = useEditorStore((state) => state.setTagNavigationTarget);

  return useCallback(async () => {
    try {
      const fullTree = await api.getNoteTree();

      if (selectedTagIds.length > 0) {
        const notes = await api.listNotesByTag(selectedTagIds);
        setTree(mapTagNotesToTree(notes));
      } else {
        setTree(fullTree);
      }

      setError(null);

      if (selectedNodePath && !treeContainsPath(fullTree, selectedNodePath)) {
        setSelectedNodePath(null);
      }

      if (currentNote?.path && !treeContainsPath(fullTree, currentNote.path)) {
        setCurrentNote(null);
        setContent("");
        setSearchNavigationTarget(null);
        setTagNavigationTarget(null);
      }

      return fullTree;
    } catch (error) {
      setError(String(error));
      console.error("Failed to refresh note tree:", error);
      return null;
    }
  }, [
    currentNote?.path,
    selectedNodePath,
    selectedTagIds,
    setContent,
    setCurrentNote,
    setError,
    setSearchNavigationTarget,
    setSelectedNodePath,
    setTagNavigationTarget,
    setTree,
  ]);
}