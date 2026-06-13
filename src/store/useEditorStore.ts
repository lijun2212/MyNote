import { create } from "zustand";
import type { Note, SearchNavigationTarget, TagNavigationTarget } from "../types";

export type EditorMode = "editor" | "split";

function deriveEditorMode(showPreview: boolean): EditorMode {
  return showPreview ? "split" : "editor";
}

interface EditorState {
  currentNote: Note | null;
  content: string;
  statusNotice: string | null;
  isOpeningNote: boolean;
  openingNotePath: string | null;
  isComposing: boolean;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  saveStatus: "saved" | "saving" | "unsaved" | "error";
  showPreview: boolean;
  getEditorMode: () => EditorMode;
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
  setEditorMode: (mode: EditorMode) => void;
  setSearchNavigationTarget: (target: SearchNavigationTarget | null) => void;
  setTagNavigationTarget: (target: TagNavigationTarget | null) => void;
  setNoteOpening: (opening: boolean, notePath?: string | null) => void;
  setStatusNotice: (message: string | null) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  currentNote: null,
  content: "",
  statusNotice: null,
  isOpeningNote: false,
  openingNotePath: null,
  isComposing: false,
  isDirty: false,
  isSaving: false,
  saveError: null,
  saveStatus: "saved",
  showPreview: true,
  getEditorMode: () => deriveEditorMode(get().showPreview),
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
  setEditorMode: (mode) => set({ showPreview: mode === "split" }),
  setSearchNavigationTarget: (target) => set({ searchNavigationTarget: target }),
  setTagNavigationTarget: (target) => set({ tagNavigationTarget: target }),
  setNoteOpening: (opening, notePath = null) => set({
    isOpeningNote: opening,
    openingNotePath: opening ? notePath ?? null : null,
  }),
  setStatusNotice: (message) => set({ statusNotice: message }),
}));
