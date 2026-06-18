import { create } from "zustand";
import type {
  MarkdownBeautifyIssue,
  MarkdownBeautifyAiStatus,
  MarkdownBeautifySummary,
  Note,
  SearchNavigationTarget,
  TagNavigationTarget,
} from "../types";

export type EditorMode = "editor" | "split";
export type EditorViewMode = "split" | "preview" | "editor";

function deriveShowPreview(viewMode: EditorViewMode): boolean {
  return viewMode !== "editor";
}

function deriveEditorMode(viewMode: EditorViewMode): EditorMode {
  return viewMode === "editor" ? "editor" : "split";
}

export interface BeautifyReviewState {
  originalContent: string;
  beautifiedContent: string;
  diagnostics: MarkdownBeautifyIssue[];
  summary: MarkdownBeautifySummary;
  diffMode: boolean;
  appliedAi: boolean;
  aiStatus: MarkdownBeautifyAiStatus;
  aiStatusDetail: string | null;
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
  viewMode: EditorViewMode;
  showPreview: boolean;
  getEditorMode: () => EditorMode;
  beautifyReview: BeautifyReviewState | null;
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
  setViewMode: (mode: EditorViewMode) => void;
  setEditorMode: (mode: EditorMode) => void;
  setBeautifyReview: (review: BeautifyReviewState | null) => void;
  setBeautifyDiffMode: (enabled: boolean) => void;
  applyBeautifyContent: () => void;
  setSearchNavigationTarget: (target: SearchNavigationTarget | null) => void;
  setTagNavigationTarget: (target: TagNavigationTarget | null) => void;
  setNoteOpening: (opening: boolean, notePath?: string | null) => void;
  setStatusNotice: (message: string | null) => void;
  resetSession: () => void;
}

const sessionResetState = {
  currentNote: null,
  content: "",
  statusNotice: null,
  isOpeningNote: false,
  openingNotePath: null,
  isComposing: false,
  isDirty: false,
  isSaving: false,
  saveError: null,
  saveStatus: "saved" as const,
  viewMode: "split" as const,
  showPreview: true,
  beautifyReview: null,
  searchNavigationTarget: null,
  tagNavigationTarget: null,
};

export const useEditorStore = create<EditorState>((set, get) => ({
  ...sessionResetState,
  getEditorMode: () => deriveEditorMode(get().viewMode),
  beautifyReview: null,
  searchNavigationTarget: null,
  tagNavigationTarget: null,

  setCurrentNote: (note) =>
    set({ currentNote: note, isComposing: false, isDirty: false, isSaving: false, saveStatus: "saved", saveError: null, beautifyReview: null }),
  setContent: (content) => set({ content }),
  setIsComposing: (isComposing) => set({ isComposing }),
  markDirty: () => set({ isDirty: true, saveStatus: "unsaved" }),
  markSaved: (note) =>
    set({ currentNote: note, isComposing: false, isDirty: false, isSaving: false, saveStatus: "saved", saveError: null, beautifyReview: null }),
  setSaving: (saving) =>
    set((s) => ({
      isSaving: saving,
      saveStatus: saving ? "saving" : s.saveError ? "error" : s.isDirty ? "unsaved" : "saved",
    })),
  setSaveError: (error) =>
    set({ saveError: error, isSaving: false, saveStatus: "error" }),
  togglePreview: () => set((s) => {
    const viewMode = s.viewMode === "editor" ? "split" : "editor";
    return { viewMode, showPreview: deriveShowPreview(viewMode) };
  }),
  setViewMode: (mode) => set({ viewMode: mode, showPreview: deriveShowPreview(mode) }),
  setEditorMode: (mode) => {
    const viewMode = mode === "split" ? "split" : "editor";
    set({ viewMode, showPreview: deriveShowPreview(viewMode) });
  },
  setBeautifyReview: (review) => set({ beautifyReview: review }),
  setBeautifyDiffMode: (enabled) =>
    set((state) => ({
      beautifyReview: state.beautifyReview ? { ...state.beautifyReview, diffMode: enabled } : null,
    })),
  applyBeautifyContent: () =>
    set((state) => {
      if (!state.beautifyReview) {
        return state;
      }

      return {
        content: state.beautifyReview.beautifiedContent,
        isDirty: true,
        saveStatus: "unsaved" as const,
        beautifyReview: null,
      };
    }),
  setSearchNavigationTarget: (target) => set({ searchNavigationTarget: target }),
  setTagNavigationTarget: (target) => set({ tagNavigationTarget: target }),
  setNoteOpening: (opening, notePath = null) => set({
    isOpeningNote: opening,
    openingNotePath: opening ? notePath ?? null : null,
  }),
  setStatusNotice: (message) => set({ statusNotice: message }),
  resetSession: () => set(sessionResetState),
}));

useEditorStore.subscribe((state) => {
  const nextShowPreview = deriveShowPreview(state.viewMode);
  if (state.showPreview !== nextShowPreview) {
    useEditorStore.setState({ showPreview: nextShowPreview });
  }
});
