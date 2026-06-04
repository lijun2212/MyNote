import { create } from "zustand";
import type { KnowledgeBase, NoteTreeNode, TagContext } from "../types";
import { api } from "../api/commands";

interface AppState {
  kb: KnowledgeBase | null;
  tree: NoteTreeNode[];
  selectedNodePath: string | null;
  activeTagContext: TagContext | null;
  leftSidebarVisible: boolean;
  rightSidebarVisible: boolean;
  loading: boolean;
  error: string | null;
  selectedTagIds: string[];

  setKb: (kb: KnowledgeBase | null) => void;
  setTree: (tree: NoteTreeNode[]) => void;
  setSelectedNodePath: (path: string | null) => void;
  setActiveTagContext: (context: TagContext | null) => void;
  setLeftSidebarVisible: (visible: boolean) => void;
  setRightSidebarVisible: (visible: boolean) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setError: (error: string | null) => void;
  refreshTree: () => Promise<void>;
  setSelectedTagIds: (ids: string[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  kb: null,
  tree: [],
  selectedNodePath: null,
  activeTagContext: null,
  leftSidebarVisible: true,
  rightSidebarVisible: false,
  loading: false,
  error: null,
  selectedTagIds: [],

  setKb: (kb) => set({ kb }),
  setTree: (tree) => set({ tree }),
  setSelectedNodePath: (path) => set({ selectedNodePath: path }),
  setActiveTagContext: (context) => set({ activeTagContext: context }),
  setLeftSidebarVisible: (visible) => set({ leftSidebarVisible: visible }),
  setRightSidebarVisible: (visible) => set({ rightSidebarVisible: visible }),
  toggleLeftSidebar: () => set((state) => ({ leftSidebarVisible: !state.leftSidebarVisible })),
  toggleRightSidebar: () => set((state) => ({ rightSidebarVisible: !state.rightSidebarVisible })),
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
