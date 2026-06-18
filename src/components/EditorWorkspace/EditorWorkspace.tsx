import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../api/commands";
import { mapMarkdownBeautifyStreamEvent } from "../../api/commands";
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
import type { MarkdownBeautifyRequest, MarkdownBeautifyResult } from "../../types";

const MARKDOWN_BEAUTIFY_STREAM_EVENT = "markdown-beautify:stream";

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

function formatBeautifyAiStatus(
  appliedAi: boolean,
  aiStatus: "not_requested" | "applied" | "unavailable" | "candidate_rejected",
  aiStatusDetail: string | null,
): string | null {
  if (appliedAi || aiStatus === "applied") {
    return "已使用 AI 辅助";
  }

  if (aiStatus === "candidate_rejected") {
    return aiStatusDetail
      ? `AI 未生效：候选结果未通过校验（${formatBeautifyAiStatusDetail(aiStatusDetail)}）`
      : "AI 未生效：候选结果未通过校验";
  }

  if (aiStatus === "unavailable") {
    return aiStatusDetail
      ? `AI 未生效：未获取到可用候选结果（${formatBeautifyAiStatusDetail(aiStatusDetail)}）`
      : "AI 未生效：未获取到可用候选结果";
  }

  return null;
}

function formatBeautifyAiStatusDetail(detail: string): string {
  const normalizedDetail = detail.trim();

  if (normalizedDetail.startsWith("AI provider request failed with status 401")) {
    return "AI 服务认证失败，请检查 API Key 或服务商配置";
  }

  if (normalizedDetail.startsWith("AI provider request failed with status 403")) {
    return "AI 服务拒绝了当前请求，请检查模型权限或服务商配置";
  }

  if (normalizedDetail.startsWith("AI provider request failed with status 429")) {
    return "AI 服务限流，请稍后重试";
  }

  if (normalizedDetail.startsWith("AI provider request failed with status 5")) {
    return "AI 服务暂时不可用，请稍后重试";
  }

  if (normalizedDetail === "AI beautify candidate appears to be missing trailing document content") {
    return "AI 返回的内容不完整，缺少文档后半部分";
  }

  if (normalizedDetail === "AI beautify candidate contains unclosed fenced code blocks") {
    return "AI 返回的代码块未正确闭合";
  }

  if (normalizedDetail === "AI beautify candidate is empty") {
    return "AI 没有返回有效内容";
  }

  return normalizedDetail;
}

function SplitViewIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="2" width="4.5" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8" y="2" width="4.5" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, [contenteditable='true'], .cm-content"));
}

const LARGE_NOTE_PREVIEW_DEFER_THRESHOLD = 180_000;
type BeautifyReviewPhase = "idle" | "rule_ready" | "ai_streaming" | "completed";

export function EditorWorkspace() {
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [isBeautifyPanelOpen, setIsBeautifyPanelOpen] = useState(false);
  const [beautifyUseAiAssist, setBeautifyUseAiAssist] = useState(false);
  const [isBeautifyRunning, setIsBeautifyRunning] = useState(false);
  const [beautifyReviewPhase, setBeautifyReviewPhase] = useState<BeautifyReviewPhase>("idle");
  const [beautifyError, setBeautifyError] = useState<string | null>(null);
  const [hoveredToolbarAction, setHoveredToolbarAction] = useState<"summary" | "projection" | "preview" | "split" | "beautify" | "applyBeautify" | null>(null);
  const {
    currentNote,
    content,
    isOpeningNote,
    openingNotePath,
    setContent,
    markDirty,
    viewMode,
    showPreview,
    setViewMode,
    searchNavigationTarget,
    tagNavigationTarget,
    setSearchNavigationTarget,
    beautifyReview,
    setBeautifyReview,
    setBeautifyDiffMode,
    applyBeautifyContent,
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
  const beautifyRequestIdRef = useRef(0);

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
  const isSplitView = viewMode === "split";
  const showEditorPane = viewMode !== "preview";
  const showPreviewPane = viewMode !== "editor" || Boolean(beautifyReview);
  const previewToggleLabel = viewMode === "preview" ? "写作模式" : "阅读模式";
  const previewContent = beautifyReview?.beautifiedContent ?? content;
  const beautifyAiStatusText = beautifyReview
    ? formatBeautifyAiStatus(beautifyReview.appliedAi, beautifyReview.aiStatus, beautifyReview.aiStatusDetail)
    : null;
  const beautifyReviewStatusText = beautifyReview
    ? `${beautifyReviewPhase === "ai_streaming" ? "AI 正在流式美化" : "美化审阅中"} · ${beautifyReview.summary.warningCount} 条提示${beautifyReviewPhase === "ai_streaming" ? " · 正在生成候选结果" : beautifyAiStatusText ? ` · ${beautifyAiStatusText}` : ""}`
    : null;
  const beautifyToolbarStatusText = beautifyReview
    ? (beautifyReviewPhase === "ai_streaming" ? "AI 美化中..." : "美化审阅中")
    : null;

  const handleConfirmBeautify = useCallback(async () => {
    if (!currentNote || isBeautifyRunning) {
      return;
    }

    setBeautifyError(null);
    setIsBeautifyRunning(true);
    setBeautifyReviewPhase("idle");

    try {
      const request: MarkdownBeautifyRequest = {
        notePath: currentNote.path,
        content,
        options: {
          fixSyntax: true,
          refreshToc: true,
          normalizeHeadings: true,
          normalizeCodeBlocks: true,
          normalizeSpacing: true,
          useAiAssist: beautifyUseAiAssist,
        },
      };

      const requestNumber = beautifyRequestIdRef.current + 1;
      beautifyRequestIdRef.current = requestNumber;
      const streamRequestId = `beautify-${requestNumber}-${Date.now()}`;
      let streamedAiCandidate = "";
      let latestRuleResult: MarkdownBeautifyResult | null = null;
      const result = await new Promise<MarkdownBeautifyResult>((resolve, reject) => {
        let settled = false;
        let dispose = () => {};

        const finish = (callback: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          dispose();
          callback();
        };

        listen<unknown>(MARKDOWN_BEAUTIFY_STREAM_EVENT, (event) => {
          const payload = mapMarkdownBeautifyStreamEvent(event.payload as Parameters<typeof mapMarkdownBeautifyStreamEvent>[0]);
          if (payload.requestId !== streamRequestId || beautifyRequestIdRef.current !== requestNumber) {
            return;
          }

          if (payload.type === "rule_result" && payload.result) {
            latestRuleResult = payload.result;
            setBeautifyReviewPhase("rule_ready");
            setBeautifyReview({
              originalContent: content,
              beautifiedContent: payload.result.beautifiedContent,
              diagnostics: payload.result.diagnostics,
              summary: payload.result.summary,
              diffMode: false,
              appliedAi: payload.result.appliedAi,
              aiStatus: payload.result.aiStatus,
              aiStatusDetail: payload.result.aiStatusDetail,
            });
            setIsBeautifyPanelOpen(false);
            setViewMode("split");
            return;
          }

          if (payload.type === "ai_delta") {
            streamedAiCandidate = `${streamedAiCandidate}${payload.chunk ?? ""}`;
            const baseResult = latestRuleResult;
            if (baseResult && streamedAiCandidate.trim()) {
              setBeautifyReviewPhase("ai_streaming");
              setBeautifyReview({
                originalContent: content,
                beautifiedContent: streamedAiCandidate,
                diagnostics: baseResult.diagnostics,
                summary: baseResult.summary,
                diffMode: false,
                appliedAi: false,
                aiStatus: "not_requested",
                aiStatusDetail: null,
              });
            }
            return;
          }

          if (payload.type === "completed" && payload.result) {
            finish(() => resolve(payload.result as MarkdownBeautifyResult));
            return;
          }

          finish(() => reject(new Error(payload.error ?? "Markdown 美化失败")));
        })
          .then((unlisten) => {
            dispose = unlisten;
            return api.beautifyMarkdownStream(request, streamRequestId);
          })
          .catch((error) => {
            finish(() => reject(error));
          });
      });

      setBeautifyReview({
        originalContent: content,
        beautifiedContent: result.beautifiedContent,
        diagnostics: result.diagnostics,
        summary: result.summary,
        diffMode: false,
        appliedAi: result.appliedAi,
        aiStatus: result.aiStatus,
        aiStatusDetail: result.aiStatusDetail,
      });
      setBeautifyReviewPhase("completed");
      setIsBeautifyPanelOpen(false);
      setViewMode("split");
    } catch (error) {
      setBeautifyError(error instanceof Error ? error.message : "Markdown 美化失败");
    } finally {
      setIsBeautifyRunning(false);
    }
  }, [beautifyUseAiAssist, content, currentNote, isBeautifyRunning, setBeautifyReview, setViewMode]);

  const handleCycleViewMode = () => {
    setViewMode(viewMode === "preview" ? "editor" : "preview");
  };

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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
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
        minWidth: 0,
      }}>
        <span style={{
          fontWeight: 500,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flexShrink: 1,
        }}>
          {currentNote.title}
        </span>
        {showOpeningMask && <span style={{ color: "#0969da", fontSize: 11 }}>正在加载笔记...</span>}
        {projectionEnabled && !projectionCapabilities.supportsExternalMonitorPlacement && (
          <span style={{ color: "#667085", fontSize: 11 }}>请将投影窗口手动拖到副屏后再全屏展示</span>
        )}
        {beautifyReview && (
          <span
            title={beautifyReviewStatusText ?? undefined}
            style={{
              color: "#0969da",
              fontSize: 11,
              minWidth: 0,
              flex: "1 1 240px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {beautifyToolbarStatusText}
          </span>
        )}
        {projectionLastError && <span style={{ color: "#b42318", fontSize: 11 }}>{projectionLastError}</span>}
        {!projectionLastError && error && <span style={{ color: "#b42318", fontSize: 11 }}>{error}</span>}
        {!projectionLastError && !error && beautifyError && <span style={{ color: "#b42318", fontSize: 11 }}>{beautifyError}</span>}
        {!projectionLastError && !error && generationStatus && <span style={{ color: "#475467", fontSize: 11 }}>{generationStatus}</span>}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            setBeautifyError(null);
            setIsBeautifyPanelOpen((current) => !current);
          }}
          disabled={isBeautifyRunning || Boolean(beautifyReview)}
          onMouseEnter={() => setHoveredToolbarAction("beautify")}
          onMouseLeave={() => setHoveredToolbarAction((current) => (current === "beautify" ? null : current))}
          style={{
            ...buildToolbarButtonStyle(isBeautifyPanelOpen, hoveredToolbarAction === "beautify" && !isBeautifyRunning && !beautifyReview),
            cursor: isBeautifyRunning || beautifyReview ? "default" : "pointer",
            opacity: isBeautifyRunning || beautifyReview ? 0.6 : 1,
            flexShrink: 0,
          }}
        >
          美化 Markdown
        </button>
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
          onClick={handleCycleViewMode}
          onMouseEnter={() => setHoveredToolbarAction("preview")}
          onMouseLeave={() => setHoveredToolbarAction((current) => (current === "preview" ? null : current))}
          style={buildToolbarButtonStyle(viewMode !== "split", hoveredToolbarAction === "preview")}
        >
          {previewToggleLabel}
        </button>
        {!isSplitView && (
          <button
            type="button"
            aria-label="返回双列模式"
            title="返回双列模式"
            onClick={() => setViewMode("split")}
            onMouseEnter={() => setHoveredToolbarAction("split")}
            onMouseLeave={() => setHoveredToolbarAction((current) => (current === "split" ? null : current))}
            style={buildToolbarButtonStyle(false, hoveredToolbarAction === "split")}
          >
            <SplitViewIcon />
          </button>
        )}
      </div>
      {beautifyReview && (
        <div style={{
          minHeight: 40,
          borderBottom: "1px solid #e0e2e7",
          background: beautifyReviewPhase === "ai_streaming" ? "#f0f9ff" : "#fcfcfd",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 12px",
          fontSize: 12,
          flexShrink: 0,
          minWidth: 0,
        }}>
          <span style={{ color: "#475467", minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {beautifyReviewStatusText}
          </span>
          <button
            type="button"
            onClick={() => setBeautifyDiffMode(!beautifyReview.diffMode)}
            style={{ ...buildToolbarButtonStyle(beautifyReview.diffMode, false), flexShrink: 0 }}
          >
            {beautifyReview.diffMode ? "恢复预览" : "查看改动"}
          </button>
          <button
            type="button"
            onClick={() => {
              setBeautifyReview(null);
              setBeautifyReviewPhase("idle");
            }}
            style={{ ...buildToolbarButtonStyle(false, false), flexShrink: 0 }}
          >
            放弃美化结果
          </button>
          <button
            type="button"
            onClick={applyBeautifyContent}
            disabled={beautifyReviewPhase === "ai_streaming"}
            onMouseEnter={() => setHoveredToolbarAction("applyBeautify")}
            onMouseLeave={() => setHoveredToolbarAction((current) => (current === "applyBeautify" ? null : current))}
            style={{
              ...buildToolbarButtonStyle(true, hoveredToolbarAction === "applyBeautify" && beautifyReviewPhase !== "ai_streaming"),
              flexShrink: 0,
              opacity: beautifyReviewPhase === "ai_streaming" ? 0.55 : 1,
              cursor: beautifyReviewPhase === "ai_streaming" ? "default" : "pointer",
            }}
          >
            {beautifyReviewPhase === "ai_streaming" ? "等待 AI 完成" : "应用美化结果"}
          </button>
        </div>
      )}
      {isBeautifyPanelOpen && !beautifyReview && (
        <div style={{
          padding: "10px 12px",
          borderBottom: "1px solid #e0e2e7",
          background: "#fcfcfd",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          fontSize: 12,
        }}>
          <span style={{ color: "#475467" }}>将执行安全格式化并在右侧预览审阅结果。</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#344054" }}>
            <input
              type="checkbox"
              checked={beautifyUseAiAssist}
              onChange={(event) => setBeautifyUseAiAssist(event.target.checked)}
              disabled={isBeautifyRunning}
            />
            使用 AI 辅助格式整理
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <button
              type="button"
              onClick={() => setIsBeautifyPanelOpen(false)}
              disabled={isBeautifyRunning}
              style={buildToolbarButtonStyle(false, false)}
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmBeautify()}
              disabled={isBeautifyRunning}
              style={buildToolbarButtonStyle(true, false)}
            >
              {isBeautifyRunning ? "美化中..." : "确认美化"}
            </button>
          </div>
        </div>
      )}
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
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          userSelect: isResizing ? "none" : undefined,
        }}
      >
        {showEditorPane && (
          <div style={{
            width: isSplitView ? `${editorRatio}%` : "100%",
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
        )}
        {isSplitView && (
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
          </>
        )}
        {showPreviewPane && (
          <div style={{
            width: isSplitView ? `${100 - editorRatio}%` : "100%",
            minWidth: 0,
            height: "100%",
            overflow: "hidden",
            borderLeft: isSplitView ? "1px solid #e0e2e7" : undefined,
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
                content={previewContent}
                beautifyReview={beautifyReview}
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
