import { create } from "zustand";
import type { Note, SearchNavigationTarget, TagNavigationTarget } from "../types";

interface EditorState {
  currentNote: Note | null;
  content: string;
  isComposing: boolean;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  saveStatus: "saved" | "saving" | "unsaved" | "error";
  showPreview: boolean;
  searchNavigationTarget: SearchNavigationTarget | null;
  tagNavigationTarget: TagNavigationTarget | null;

  setCurrentNote: (note: Note | null) => void;
  setContent: (content: string) => void;
  setIsComposing: (isComposing: boolean) => void;
  markDirty: () => void;
  markSaved: (note: Note) => void;
  setSaving: (saving: boolean) => void;
  setSaveError: (error: string | null) => void;
  togglePreview: () => void;
  setSearchNavigationTarget: (target: SearchNavigationTarget | null) => void;
  setTagNavigationTarget: (target: TagNavigationTarget | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  currentNote: null,
  content: "",
  isComposing: false,
  isDirty: false,
  isSaving: false,
  saveError: null,
  saveStatus: "saved",
  showPreview: true,
  searchNavigationTarget: null,
  tagNavigationTarget: null,

  setCurrentNote: (note) =>
    set({ currentNote: note, isComposing: false, isDirty: false, isSaving: false, saveStatus: "saved", saveError: null }),
  setContent: (content) => set({ content }),
  setIsComposing: (isComposing) => set({ isComposing }),
  markDirty: () => set({ isDirty: true, saveStatus: "unsaved" }),
  markSaved: (note) =>
    set({ currentNote: note, isComposing: false, isDirty: false, isSaving: false, saveStatus: "saved", saveError: null }),
  setSaving: (saving) =>
    set((s) => ({
      isSaving: saving,
      saveStatus: saving ? "saving" : s.saveError ? "error" : s.isDirty ? "unsaved" : "saved",
    })),
  setSaveError: (error) =>
    set({ saveError: error, isSaving: false, saveStatus: "error" }),
  togglePreview: () => set((s) => ({ showPreview: !s.showPreview })),
  setSearchNavigationTarget: (target) => set({ searchNavigationTarget: target }),
  setTagNavigationTarget: (target) => set({ tagNavigationTarget: target }),
}));
