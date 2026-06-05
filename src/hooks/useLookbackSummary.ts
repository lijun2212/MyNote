import { useEffect, useRef, useState } from "react";
import { api } from "../api/commands";
import { useEditorStore } from "../store/useEditorStore";
import { useLookbackSummaryStore } from "../store/useLookbackSummaryStore";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "回看摘要操作失败";
}

function getNoteKey(note: { id: string; path: string } | null): string | null {
  return note ? `${note.id}:${note.path}` : null;
}

export function useLookbackSummary() {
  const currentNote = useEditorStore((state) => state.currentNote);
  const setContent = useEditorStore((state) => state.setContent);
  const markSaved = useEditorStore((state) => state.markSaved);
  const currentNoteKey = getNoteKey(currentNote);
  const recentViews = useLookbackSummaryStore((state) => (currentNote?.path ? state.getRecentOpenCount(currentNote.path) : 0));
  const shouldPrompt = useLookbackSummaryStore((state) => state.shouldPrompt);
  const markPromptShown = useLookbackSummaryStore((state) => state.markPromptShown);
  const currentNoteKeyRef = useRef(currentNoteKey);
  const generateRequestIdRef = useRef(0);
  const summaryVersionRef = useRef(0);
  const saveRequestIdRef = useRef(0);
  const backlinksRequestIdRef = useRef(0);
  const [candidate, setCandidate] = useState("");
  const [savedSummary, setSavedSummary] = useState<string | null>(currentNote?.summary ?? null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backlinkCount, setBacklinkCount] = useState(0);
  const [suggestedNoteKey, setSuggestedNoteKey] = useState<string | null>(null);

  currentNoteKeyRef.current = currentNoteKey;

  useEffect(() => {
    summaryVersionRef.current += 1;
    const nextSummary = currentNote?.summary ?? null;
    setCandidate(nextSummary ?? "");
    setSavedSummary(nextSummary);
    setIsGenerating(false);
    setIsSaving(false);
    setError(null);
    setBacklinkCount(0);
    setSuggestedNoteKey(null);
  }, [currentNote?.id, currentNote?.path, currentNote?.summary]);

  useEffect(() => {
    if (!currentNote?.id || !currentNoteKey) {
      return;
    }

    const requestId = backlinksRequestIdRef.current + 1;
    backlinksRequestIdRef.current = requestId;
    const noteKeyAtRequest = currentNoteKey;

    api.getNoteLinks(currentNote.id)
      .then((links) => {
        if (backlinksRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
          return;
        }

        setBacklinkCount(links.incoming.length);
      })
      .catch(() => {
        if (backlinksRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
          return;
        }

        setBacklinkCount(0);
      });
  }, [currentNote?.id, currentNoteKey]);

  const baseShouldSuggest = Boolean(
    currentNote
    && !currentNote.summary
    && shouldPrompt(currentNote.path, {
      wordCount: currentNote.word_count,
      recentViews,
      backlinks: backlinkCount,
    }),
  );

  const shouldSuggest = Boolean(
    currentNote
    && !currentNote.summary
    && (baseShouldSuggest || suggestedNoteKey === currentNoteKey),
  );

  useEffect(() => {
    if (!currentNote || currentNote.summary || !currentNoteKey || !baseShouldSuggest || suggestedNoteKey === currentNoteKey) {
      return;
    }

    setSuggestedNoteKey(currentNoteKey);
    markPromptShown(currentNote.path);
  }, [baseShouldSuggest, currentNote, currentNoteKey, markPromptShown, suggestedNoteKey]);

  async function generateCandidate() {
    if (!currentNote) {
      return;
    }

    const requestId = generateRequestIdRef.current + 1;
    generateRequestIdRef.current = requestId;
    const notePath = currentNote.path;
    const noteKeyAtRequest = currentNoteKey;
    const summaryVersionAtRequest = summaryVersionRef.current;

    setIsGenerating(true);
    setError(null);

    try {
      const nextCandidate = await api.generateSummaryCandidate(notePath);

      if (
        generateRequestIdRef.current !== requestId ||
        currentNoteKeyRef.current !== noteKeyAtRequest ||
        summaryVersionRef.current !== summaryVersionAtRequest
      ) {
        return;
      }

      setCandidate(nextCandidate);
    } catch (generationError) {
      if (
        generateRequestIdRef.current !== requestId ||
        currentNoteKeyRef.current !== noteKeyAtRequest ||
        summaryVersionRef.current !== summaryVersionAtRequest
      ) {
        return;
      }

      setError(toErrorMessage(generationError));
    } finally {
      if (
        generateRequestIdRef.current === requestId &&
        currentNoteKeyRef.current === noteKeyAtRequest &&
        summaryVersionRef.current === summaryVersionAtRequest
      ) {
        setIsGenerating(false);
      }
    }
  }

  async function saveCandidate() {
    if (!currentNote) {
      return;
    }

    const nextSummary = candidate.trim();
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    const notePath = currentNote.path;
    const noteKeyAtRequest = currentNoteKey;

    setIsSaving(true);
    setError(null);

    try {
      const savedNote = await api.saveNoteSummary(notePath, nextSummary);

      if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
        return;
      }

      if (!nextSummary) {
        markPromptShown(notePath);
      }

      setSavedSummary(savedNote.summary ?? null);
      setCandidate(savedNote.summary ?? "");

      try {
        const refreshedDetail = await api.getNoteByPath(notePath);

        if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
          return;
        }

        setContent(refreshedDetail.content);
        markSaved(refreshedDetail.note);
        setSavedSummary(refreshedDetail.note.summary ?? null);
        setCandidate(refreshedDetail.note.summary ?? "");
      } catch {
        if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
          return;
        }

        useEditorStore.setState((state) => ({
          currentNote: savedNote,
          isComposing: false,
          isDirty: true,
          isSaving: false,
          saveStatus: "unsaved",
          saveError: null,
          content: state.content,
        }));
      }
    } catch (saveError) {
      if (saveRequestIdRef.current !== requestId || currentNoteKeyRef.current !== noteKeyAtRequest) {
        return;
      }

      setError(toErrorMessage(saveError));
    } finally {
      if (saveRequestIdRef.current === requestId && currentNoteKeyRef.current === noteKeyAtRequest) {
        setIsSaving(false);
      }
    }
  }

  return {
    candidate,
    savedSummary,
    hasSummary: Boolean(savedSummary),
    isGenerating,
    isSaving,
    error,
    shouldSuggest,
    generateCandidate,
    saveCandidate,
    setCandidate,
  };
}