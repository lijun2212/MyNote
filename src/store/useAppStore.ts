import { create } from "zustand";
import type { KnowledgeBase, NoteTreeNode, TagContext } from "../types";
import { api } from "../api/commands";

interface AppState {
  kb: KnowledgeBase | null;
  tree: NoteTreeNode[];
  selectedNodePath: string | null;
  activeTagContext: TagContext | null;
  loading: boolean;
  error: string | null;
  selectedTagIds: string[];

  setKb: (kb: KnowledgeBase | null) => void;
  setTree: (tree: NoteTreeNode[]) => void;
  setSelectedNodePath: (path: string | null) => void;
  setActiveTagContext: (context: TagContext | null) => void;
  setError: (error: string | null) => void;
  refreshTree: () => Promise<void>;
  setSelectedTagIds: (ids: string[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  kb: null,
  tree: [],
  selectedNodePath: null,
  activeTagContext: null,
  loading: false,
  error: null,
  selectedTagIds: [],

  setKb: (kb) => set({ kb }),
  setTree: (tree) => set({ tree }),
  setSelectedNodePath: (path) => set({ selectedNodePath: path }),
  setActiveTagContext: (context) => set({ activeTagContext: context }),
  setError: (error) => set({ error }),
  setSelectedTagIds: (ids) => set({ selectedTagIds: ids }),

  refreshTree: async () => {
    try {
      const tree = await api.getNoteTree();
      set({ tree });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
