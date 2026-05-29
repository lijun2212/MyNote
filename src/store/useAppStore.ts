import { create } from "zustand";
import type { KnowledgeBase, NoteTreeNode } from "../types";
import { api } from "../api/commands";

interface AppState {
  kb: KnowledgeBase | null;
  tree: NoteTreeNode[];
  selectedNodePath: string | null;
  loading: boolean;
  error: string | null;

  setKb: (kb: KnowledgeBase | null) => void;
  setTree: (tree: NoteTreeNode[]) => void;
  setSelectedNodePath: (path: string | null) => void;
  setError: (error: string | null) => void;
  refreshTree: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  kb: null,
  tree: [],
  selectedNodePath: null,
  loading: false,
  error: null,

  setKb: (kb) => set({ kb }),
  setTree: (tree) => set({ tree }),
  setSelectedNodePath: (path) => set({ selectedNodePath: path }),
  setError: (error) => set({ error }),

  refreshTree: async () => {
    try {
      const tree = await api.getNoteTree();
      set({ tree });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
