import { create } from "zustand";
import type { Note } from "../types";

interface EditorState {
  currentNote: Note | null;
  content: string;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  saveStatus: "saved" | "saving" | "unsaved" | "error";

  setCurrentNote: (note: Note | null) => void;
  setContent: (content: string) => void;
  markDirty: () => void;
  markSaved: (note: Note) => void;
  setSaving: (saving: boolean) => void;
  setSaveError: (error: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  currentNote: null,
  content: "",
  isDirty: false,
  isSaving: false,
  saveError: null,
  saveStatus: "saved",

  setCurrentNote: (note) =>
    set({ currentNote: note, isDirty: false, saveStatus: "saved", saveError: null }),
  setContent: (content) => set({ content }),
  markDirty: () => set({ isDirty: true, saveStatus: "unsaved" }),
  markSaved: (note) =>
    set({ currentNote: note, isDirty: false, saveStatus: "saved", saveError: null }),
  setSaving: (saving) =>
    set({ isSaving: saving, saveStatus: saving ? "saving" : "saved" }),
  setSaveError: (error) =>
    set({ saveError: error, saveStatus: "error" }),
}));
