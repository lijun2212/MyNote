import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../store/useEditorStore";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAutoSave } from "../../hooks/useAutoSave";
import { useEditorSplitResize } from "../../hooks/useEditorSplitResize";
import type { SourceLineSyncSignal, SourceLineSyncSource } from "./sourceLineSync";

export function EditorWorkspace() {
  const { currentNote, content, setContent, markDirty, showPreview, togglePreview, tagNavigationTarget } = useEditorStore();
  useAutoSave();
  const [isSeparatorHovered, setIsSeparatorHovered] = useState(false);
  const [sourceLineSyncSignal, setSourceLineSyncSignal] = useState<SourceLineSyncSignal | null>(null);
  const pendingSourceLineSyncRef = useRef<{ source: SourceLineSyncSource; line: number } | null>(null);
  const sourceLineSyncFrameRef = useRef<number | null>(null);

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
            tagNavigationTarget={tagNavigationTarget}
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
              tagNavigationTarget={tagNavigationTarget}
              sourceLineSyncSignal={sourceLineSyncSignal}
              onTopVisibleLineChange={(line) => handleSourceLineSync("preview", line)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
