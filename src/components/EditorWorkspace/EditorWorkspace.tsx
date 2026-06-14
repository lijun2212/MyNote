import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../store/useEditorStore";
import { useProjectionStore } from "../../store/useProjectionStore";
import { useSearchSessionStore } from "../../store/useSearchSessionStore";
import { useOpenNote } from "../../hooks/useOpenNote";
import { useProjectionSync } from "../../hooks/useProjectionSync";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useEditorSplitResize } from "../../hooks/useEditorSplitResize";
import { useLookbackSummary } from "../../hooks/useLookbackSummary";
import { SearchSessionBar } from "./SearchSessionBar";
import { LookbackSummaryCard } from "./LookbackSummaryCard";
import {
  closeProjectionWindow,
  getProjectionWindowCapabilities,
  openProjectionWindow,
} from "../../projection/windowApi";
import type { SourceLineSyncSignal, SourceLineSyncSource } from "./sourceLineSync";

function buildToolbarButtonStyle(active = false, hovered = false): React.CSSProperties {
  if (hovered) {
    return {
      fontSize: 12,
      lineHeight: 1.2,
      padding: "4px 10px",
      cursor: "pointer",
      borderRadius: 8,
      border: "1px solid #93c5fd",
      color: "#0969da",
      background: "#eff6ff",
    };
  }

  return {
    fontSize: 12,
    lineHeight: 1.2,
    padding: "4px 10px",
    cursor: "pointer",
    borderRadius: 8,
    border: active ? "1px solid #93c5fd" : "1px solid #d9e0e8",
    color: active ? "#0969da" : "#475467",
    background: active ? "#eff6ff" : "#f8fafc",
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, [contenteditable='true'], .cm-content"));
}

const LARGE_NOTE_PREVIEW_DEFER_THRESHOLD = 180_000;

export function EditorWorkspace() {
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [hoveredToolbarAction, setHoveredToolbarAction] = useState<"summary" | "projection" | "preview" | null>(null);
  const {
    currentNote,
    content,
    isOpeningNote,
    openingNotePath,
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
  const projectionEnabled = useProjectionStore((state) => state.projectionEnabled);
  const projectionLastError = useProjectionStore((state) => state.projectionLastError);
  const { openNote, beginOpenNote, isOpenNoteRequestCurrent } = useOpenNote();
  const activeSearchNavigationTarget = searchNavigationTarget
    && (searchNavigationTarget.revision > (tagNavigationTarget?.revision ?? -1))
    ? searchNavigationTarget
    : null;
  const activeTagNavigationTarget = tagNavigationTarget
    && (tagNavigationTarget.revision >= (searchNavigationTarget?.revision ?? -1))
    ? tagNavigationTarget
    : null;
  const { syncProjectionScroll } = useProjectionSync({
    notePath: currentNote?.path ?? null,
    noteTitle: currentNote?.title ?? null,
    content,
    searchNavigationTarget: activeSearchNavigationTarget,
    tagNavigationTarget: activeTagNavigationTarget,
  });
  useAutoSave();
  const [isSeparatorHovered, setIsSeparatorHovered] = useState(false);
  const [sourceLineSyncSignal, setSourceLineSyncSignal] = useState<SourceLineSyncSignal | null>(null);
  const [deferPreviewForLargeNote, setDeferPreviewForLargeNote] = useState(false);
  const [projectionCapabilities] = useState(() => getProjectionWindowCapabilities());
  const pendingSourceLineSyncRef = useRef<{ source: SourceLineSyncSource; line: number } | null>(null);
  const sourceLineSyncFrameRef = useRef<number | null>(null);
  const navigationRevisionRef = useRef(0);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const {
    candidate,
    savedSummary,
    hasSummary,
    isGenerating,
    isSaving,
    error,
    generationStatus,
    generateCandidate,
    saveCandidate,
    clearSummary,
    setCandidate,
  } = useLookbackSummary();
  const {
    editorRatio,
    isResizing,
    minRatio,
    maxRatio,
    startResize,
    resize,
    stopResize,
  } = useEditorSplitResize({ containerRef: splitContainerRef });

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

  const handleToggleProjection = useCallback(async () => {
    if (useProjectionStore.getState().projectionEnabled) {
      await closeProjectionWindow();
      useProjectionStore.getState().markClosed();
      return;
    }

    const store = useProjectionStore.getState();
    store.beginSession();

    try {
      await openProjectionWindow(currentNote?.title ?? null);
    } catch (error) {
      store.markClosed();
      store.setError(error instanceof Error ? error.message : "投影窗口启动失败");
    }
  }, []);

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

  useEffect(() => {
    if (!showPreview || !currentNote) {
      setDeferPreviewForLargeNote(false);
      return;
    }

    if (content.length < LARGE_NOTE_PREVIEW_DEFER_THRESHOLD) {
      setDeferPreviewForLargeNote(false);
      return;
    }

    setDeferPreviewForLargeNote(true);
    const timer = window.setTimeout(() => {
      setDeferPreviewForLargeNote(false);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [content, currentNote?.path, showPreview]);

  useEffect(() => {
    if (!hasSummary) {
      setIsSummaryExpanded(false);
    }
  }, [hasSummary, currentNote?.path]);

  const showOpeningMask = isOpeningNote && Boolean(openingNotePath) && openingNotePath !== currentNote?.path;

  if (!currentNote) {
    if (isOpeningNote) {
      return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#667085", fontSize: 14 }}>
          正在加载笔记...
        </div>
      );
    }

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
        {showOpeningMask && <span style={{ color: "#0969da", fontSize: 11 }}>正在加载笔记...</span>}
        {projectionEnabled && !projectionCapabilities.supportsExternalMonitorPlacement && (
          <span style={{ color: "#667085", fontSize: 11 }}>请将投影窗口手动拖到副屏后再全屏展示</span>
        )}
        {projectionLastError && <span style={{ color: "#b42318", fontSize: 11 }}>{projectionLastError}</span>}
        {!projectionLastError && error && <span style={{ color: "#b42318", fontSize: 11 }}>{error}</span>}
        {!projectionLastError && !error && generationStatus && <span style={{ color: "#475467", fontSize: 11 }}>{generationStatus}</span>}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => {
            if (isSummaryExpanded) {
              setIsSummaryExpanded(false);
              return;
            }

            setIsSummaryExpanded(true);
          }}
          disabled={isSaving || isGenerating}
          onMouseEnter={() => setHoveredToolbarAction("summary")}
          onMouseLeave={() => setHoveredToolbarAction((current) => (current === "summary" ? null : current))}
          style={{
            ...buildToolbarButtonStyle(isSummaryExpanded, hoveredToolbarAction === "summary" && !(isSaving || isGenerating)),
            cursor: isSaving || isGenerating ? "default" : "pointer",
            opacity: isSaving || isGenerating ? 0.6 : 1,
          }}
        >
          {isSummaryExpanded ? "隐藏摘要" : "展开摘要"}
        </button>
        <button
          onClick={() => void handleToggleProjection()}
          onMouseEnter={() => setHoveredToolbarAction("projection")}
          onMouseLeave={() => setHoveredToolbarAction((current) => (current === "projection" ? null : current))}
          style={buildToolbarButtonStyle(projectionEnabled, hoveredToolbarAction === "projection")}
        >
          {projectionEnabled ? "关闭投影" : "开启投影"}
        </button>
        <button
          onClick={() => togglePreview()}
          onMouseEnter={() => setHoveredToolbarAction("preview")}
          onMouseLeave={() => setHoveredToolbarAction((current) => (current === "preview" ? null : current))}
          style={buildToolbarButtonStyle(!showPreview, hoveredToolbarAction === "preview")}
        >
          {showPreview ? "隐藏预览" : "显示预览"}
        </button>
      </div>
      {isSummaryExpanded && (
        <LookbackSummaryCard
          savedSummary={savedSummary}
          candidate={candidate}
          isGenerating={isGenerating}
          isSaving={isSaving}
          error={error}
          onCandidateChange={setCandidate}
          onGenerate={generateCandidate}
          onSave={saveCandidate}
          onDeleteSummary={async () => {
            await clearSummary();
            setIsSummaryExpanded(false);
          }}
        />
      )}
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
            onTopVisibleLineChange={(line) => {
              handleSourceLineSync("editor", line);
              syncProjectionScroll("main-editor", line);
            }}
          />
        </div>
        {showPreview && (
          <>
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
            <div style={{
              width: `${100 - editorRatio}%`,
              minWidth: 0,
              height: "100%",
              overflow: "hidden",
              borderLeft: "1px solid #e0e2e7",
            }}>
              {deferPreviewForLargeNote ? (
                <div style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#667085",
                  fontSize: 13,
                  background: "#fcfcfd",
                }}>
                  正在加载预览...
                </div>
              ) : (
                <MarkdownPreview
                  content={content}
                  searchNavigationTarget={activeSearchNavigationTarget}
                  tagNavigationTarget={activeTagNavigationTarget}
                  sourceLineSyncSignal={sourceLineSyncSignal}
                  onTopVisibleLineChange={(line) => {
                    handleSourceLineSync("preview", line);
                    syncProjectionScroll("main-preview", line);
                  }}
                />
              )}
            </div>
          </>
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
