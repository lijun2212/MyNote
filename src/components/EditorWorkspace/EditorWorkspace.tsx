import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../store/useEditorStore";
import { useSearchSessionStore } from "../../store/useSearchSessionStore";
import { useOpenNote } from "../../hooks/useOpenNote";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useEditorSplitResize } from "../../hooks/useEditorSplitResize";
import { useLookbackSummary } from "../../hooks/useLookbackSummary";
import { SearchSessionBar } from "./SearchSessionBar";
import { LookbackSummaryCard } from "./LookbackSummaryCard";
import type { SourceLineSyncSignal, SourceLineSyncSource } from "./sourceLineSync";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, [contenteditable='true'], .cm-content"));
}

export function EditorWorkspace() {
  const {
    currentNote,
    content,
    setContent,
    markDirty,
    showPreview,
    togglePreview,
    searchNavigationTarget,
    tagNavigationTarget,
    setSearchNavigationTarget,
  } = useEditorStore();
  const session = useSearchSessionStore((state) => state.session);
  const setCurrentIndex = useSearchSessionStore((state) => state.setCurrentIndex);
  const clearSession = useSearchSessionStore((state) => state.clearSession);
  const { openNote, beginOpenNote, isOpenNoteRequestCurrent } = useOpenNote();
  const activeSearchNavigationTarget = searchNavigationTarget
    && (searchNavigationTarget.revision > (tagNavigationTarget?.revision ?? -1))
    ? searchNavigationTarget
    : null;
  const activeTagNavigationTarget = tagNavigationTarget
    && (tagNavigationTarget.revision >= (searchNavigationTarget?.revision ?? -1))
    ? tagNavigationTarget
    : null;
  useAutoSave();
  const [isSeparatorHovered, setIsSeparatorHovered] = useState(false);
  const [sourceLineSyncSignal, setSourceLineSyncSignal] = useState<SourceLineSyncSignal | null>(null);
  const pendingSourceLineSyncRef = useRef<{ source: SourceLineSyncSource; line: number } | null>(null);
  const sourceLineSyncFrameRef = useRef<number | null>(null);
  const navigationRevisionRef = useRef(0);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const {
    editorRatio,
    isResizing,
    minRatio,
    maxRatio,
    startResize,
    resize,
    stopResize,
  } = useEditorSplitResize({ containerRef: splitContainerRef });
  const {
    candidate,
    savedSummary,
    isGenerating,
    isSaving,
    error,
    generateCandidate,
    saveCandidate,
    setCandidate,
  } = useLookbackSummary();

  const handleChange = useCallback((newContent: string) => {
    setContent(newContent);
    markDirty();
  }, [setContent, markDirty]);

  const handleSourceLineSync = useCallback((source: SourceLineSyncSource, line: number) => {
    pendingSourceLineSyncRef.current = { source, line };
    if (sourceLineSyncFrameRef.current !== null) return;

    sourceLineSyncFrameRef.current = window.requestAnimationFrame(() => {
      sourceLineSyncFrameRef.current = null;
      const pending = pendingSourceLineSyncRef.current;
      if (!pending) return;
      pendingSourceLineSyncRef.current = null;
      setSourceLineSyncSignal((current) => ({
        source: pending.source,
        line: pending.line,
        revision: (current?.revision ?? 0) + 1,
      }));
    });
  }, []);

  const navigateToSessionIndex = useCallback(async (nextIndex: number) => {
    if (!session || !session.active) {
      return;
    }

    const sessionSnapshot = session;
    const navigationRevision = navigationRevisionRef.current + 1;
    navigationRevisionRef.current = navigationRevision;

    const result = session.results[nextIndex];
    if (!result) {
      return;
    }

    if (currentNote?.path !== result.path) {
      const requestId = beginOpenNote();
      await openNote(result.path, requestId);
      if (!isOpenNoteRequestCurrent(requestId)) {
        return;
      }
      if (navigationRevisionRef.current !== navigationRevision) {
        return;
      }
      if (useEditorStore.getState().currentNote?.path !== result.path) {
        return;
      }
    }

    if (navigationRevisionRef.current !== navigationRevision) {
      return;
    }
    if (useSearchSessionStore.getState().session !== sessionSnapshot) {
      return;
    }

    setCurrentIndex(nextIndex);
    setSearchNavigationTarget({
      note_id: result.note_id,
      note_path: result.path,
      note_title: result.title,
      line_start: result.line_start,
      line_end: result.line_end,
      occurrence_order: result.occurrence_order,
      match_text: result.match_text,
      source: result.source,
      context_snippet: result.snippet,
      revision: Date.now(),
    });
  }, [beginOpenNote, currentNote?.path, isOpenNoteRequestCurrent, openNote, session, setCurrentIndex, setSearchNavigationTarget]);

  const handlePreviousSearchResult = useCallback(() => {
    if (!session || !session.active || session.currentIndex <= 0) {
      return;
    }

    void navigateToSessionIndex(session.currentIndex - 1);
  }, [navigateToSessionIndex, session]);

  const handleNextSearchResult = useCallback(() => {
    if (!session || !session.active || session.currentIndex >= session.results.length - 1) {
      return;
    }

    void navigateToSessionIndex(session.currentIndex + 1);
  }, [navigateToSessionIndex, session]);

  const handleExitSearchSession = useCallback(() => {
    navigationRevisionRef.current += 1;
    clearSession();
    setSearchNavigationTarget(null);
  }, [clearSession, setSearchNavigationTarget]);

  useEffect(() => {
    if (!session?.active) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        handleExitSearchSession();
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const normalizedKey = event.key.toLowerCase();
      if (normalizedKey === "n") {
        event.preventDefault();
        handleNextSearchResult();
      } else if (normalizedKey === "b") {
        event.preventDefault();
        handlePreviousSearchResult();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleExitSearchSession, handleNextSearchResult, handlePreviousSearchResult, session?.active]);

  useEffect(() => {
    return () => {
      if (sourceLineSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(sourceLineSyncFrameRef.current);
      }
    };
  }, []);

  if (!currentNote) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: 14 }}>
        请从左侧文件树选择或新建笔记
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        height: 36,
        borderBottom: "1px solid #e0e2e7",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 8,
        fontSize: 12,
        background: "#fafbfc",
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 500 }}>{currentNote.title}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => togglePreview()}
          style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer", borderRadius: 4, border: "1px solid #ccc" }}
        >
          {showPreview ? "隐藏预览" : "显示预览"}
        </button>
      </div>
      <LookbackSummaryCard
        savedSummary={savedSummary}
        candidate={candidate}
        isGenerating={isGenerating}
        isSaving={isSaving}
        error={error}
        onCandidateChange={setCandidate}
        onGenerate={generateCandidate}
        onSave={saveCandidate}
      />
      <div
        ref={splitContainerRef}
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          userSelect: isResizing ? "none" : undefined,
        }}
      >
        <div style={{
          width: showPreview ? `${editorRatio}%` : "100%",
          minWidth: 0,
          height: "100%",
          overflow: "hidden",
        }}>
          <MarkdownEditor
            initialContent={content}
            onChange={handleChange}
            searchNavigationTarget={activeSearchNavigationTarget}
            tagNavigationTarget={activeTagNavigationTarget}
            sourceLineSyncSignal={sourceLineSyncSignal}
            onTopVisibleLineChange={(line) => handleSourceLineSync("editor", line)}
          />
        </div>
        {showPreview && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={minRatio}
            aria-valuemax={maxRatio}
            aria-valuenow={Math.round(editorRatio)}
            tabIndex={0}
            onPointerEnter={() => setIsSeparatorHovered(true)}
            onPointerLeave={() => setIsSeparatorHovered(false)}
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerUp={stopResize}
            onPointerCancel={stopResize}
            style={{
              width: 6,
              flexShrink: 0,
              cursor: "col-resize",
              background: isResizing || isSeparatorHovered ? "#d9ddff" : "#eef0f5",
              borderLeft: "1px solid #e0e2e7",
              borderRight: "1px solid #e0e2e7",
            }}
          />
        )}
        {showPreview && (
          <div style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            overflow: "hidden",
          }}>
            <MarkdownPreview
              content={content}
              searchNavigationTarget={activeSearchNavigationTarget}
              tagNavigationTarget={activeTagNavigationTarget}
              sourceLineSyncSignal={sourceLineSyncSignal}
              onTopVisibleLineChange={(line) => handleSourceLineSync("preview", line)}
            />
          </div>
        )}
      </div>
      {session?.active && (
        <SearchSessionBar
          query={session.query}
          currentIndex={session.currentIndex}
          total={session.results.length}
          onPrevious={handlePreviousSearchResult}
          onNext={handleNextSearchResult}
          onExit={handleExitSearchSession}
        />
      )}
    </div>
  );
}
