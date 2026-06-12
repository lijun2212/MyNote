import { useEffect, useState } from "react";
import { api } from "../../api/commands";
import type { MarkdownImportResult, MarkdownImportSource, Note } from "../../types";

const DIALOG_VIEWPORT_MARGIN_PX = 96;
const DIALOG_MIN_HEIGHT_PX = 320;

function getViewportHeight() {
  if (typeof window === "undefined") return 800;
  return window.visualViewport?.height ?? window.innerHeight;
}

interface Props {
  sources: MarkdownImportSource[];
  existingDirs: string[];
  onClose: () => void;
  onDone: (lastImported?: Note) => void | Promise<void>;
}

function normalizeImportDestination(path: string) {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "notes";
  if (trimmed === "notes" || trimmed.startsWith("notes/")) {
    return trimmed;
  }
  return `notes/${trimmed}`;
}

function summarizeSource(source: MarkdownImportSource) {
  return {
    label: source.path.split("/").pop() || source.path,
    kindLabel: source.kind === "directory" ? "文件夹" : "Markdown 文件",
  };
}

function renderMessages(messages: MarkdownImportResult["warnings"] | MarkdownImportResult["failures"], tone: "warning" | "failure") {
  if (messages.length === 0) return null;

  return (
    <div style={{
      marginBottom: 12,
      padding: 10,
      borderRadius: 6,
      background: tone === "warning" ? "#fff8c5" : "#fef2f2",
      border: `1px solid ${tone === "warning" ? "#d4a72c" : "#fca5a5"}`,
      fontSize: 12,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        {tone === "warning" ? "警告" : "失败"}
      </div>
      {messages.map((item) => (
        <div key={`${item.sourcePath}:${item.message}`} style={{ marginBottom: 4 }}>
          <div style={{ color: "#24292f" }}>{item.message}</div>
          <div style={{ color: "#6e7681" }}>{item.sourcePath}</div>
        </div>
      ))}
    </div>
  );
}

export function ImportDialog({ sources, existingDirs, onClose, onDone }: Props) {
  const [destDir, setDestDir] = useState(existingDirs[0] ?? "notes");
  const [customDir, setCustomDir] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<MarkdownImportResult | null>(null);
  const [viewportHeight, setViewportHeight] = useState(() => getViewportHeight());

  const finalDir = useCustom ? normalizeImportDestination(customDir) : destDir;
  const hasResult = result !== null;
  const canClose = !importing;
  const dialogMaxHeight = Math.max(DIALOG_MIN_HEIGHT_PX, Math.floor(viewportHeight - DIALOG_VIEWPORT_MARGIN_PX));

  useEffect(() => {
    const updateViewportHeight = () => {
      setViewportHeight(getViewportHeight());
    };

    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("resize", updateViewportHeight);

    return () => {
      window.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
    };
  }, []);

  async function handleConfirm() {
    setImporting(true);
    setErrors([]);
    setResult(null);

    try {
      const nextResult = await api.importMarkdownSources({
        sources,
        destDirectory: finalDir,
      });
      setResult(nextResult);

      if (nextResult.imported.length > 0) {
        const lastImported = nextResult.imported.at(-1)?.note;
        try {
          await onDone(lastImported);
        } catch (error) {
          setErrors([`导入完成，但打开笔记失败：${error}`]);
          setImporting(false);
          return;
        }

        if (nextResult.warnings.length === 0 && nextResult.failures.length === 0) {
          onClose();
          return;
        }
      }
    } catch (error) {
      setErrors([String(error)]);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
      boxSizing: "border-box",
      zIndex: 1000,
    }} data-testid="import-dialog-overlay">
      <div style={{
        background: "#fff", borderRadius: 8,
        minWidth: 360, width: "min(480px, calc(100vw - 48px))", maxWidth: 480,
        maxHeight: dialogMaxHeight,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
      }} data-testid="import-dialog-panel">
        <div style={{ padding: "24px 24px 0" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>导入笔记</h3>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "0 24px 16px",
          }}
          data-testid="import-dialog-body"
        >
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#6e7681", marginBottom: 6 }}>
              即将导入 {sources.length} 个来源：
            </div>
            <div style={{
              maxHeight: 120, overflowY: "auto",
              border: "1px solid #e0e2e7", borderRadius: 4, padding: "6px 8px",
              fontSize: 12, background: "#f6f8fa",
            }}>
              {sources.map((source) => {
                const summary = summarizeSource(source);
                return (
                  <div key={`${source.kind}:${source.path}`} style={{ padding: "4px 0", color: "#24292f" }}>
                    <div>{summary.label}</div>
                    <div style={{ color: "#6e7681", fontSize: 11 }}>{summary.kindLabel}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#6e7681", marginBottom: 6 }}>目标目录：</div>
            {!useCustom ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  value={destDir}
                  onChange={e => setDestDir(e.target.value)}
                  style={{
                    flex: 1, fontSize: 13, padding: "5px 8px",
                    border: "1px solid #d0d7de", borderRadius: 4,
                  }}
                >
                  {existingDirs.length === 0 && <option value="notes">notes</option>}
                  {existingDirs.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <button
                  onClick={() => setUseCustom(true)}
                  style={{
                    fontSize: 12, padding: "5px 10px", cursor: "pointer",
                    border: "1px solid #d0d7de", borderRadius: 4, background: "#f6f8fa",
                  }}
                >
                  新目录…
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  autoFocus
                  value={customDir}
                  onChange={e => setCustomDir(e.target.value)}
                  placeholder="输入目录名，如 work/2024（将保存到 notes/work/2024）"
                  style={{
                    flex: 1, fontSize: 13, padding: "5px 8px",
                    border: "1px solid #0969da", borderRadius: 4, outline: "none",
                  }}
                />
                <button
                  onClick={() => setUseCustom(false)}
                  style={{
                    fontSize: 12, padding: "5px 10px", cursor: "pointer",
                    border: "1px solid #d0d7de", borderRadius: 4, background: "#f6f8fa",
                  }}
                >
                  从列表选
                </button>
              </div>
            )}
            <div style={{ fontSize: 11, color: "#8c959f", marginTop: 4 }}>
              目标路径：{finalDir}/
            </div>
          </div>

          {errors.length > 0 && (
            <div style={{
              marginBottom: 16, padding: 8, borderRadius: 4,
              background: "#fff8c5", border: "1px solid #d4a72c", fontSize: 12,
            }}>
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {result && result.imported.length > 0 && (
            <div style={{
              marginBottom: 12,
              padding: 10,
              borderRadius: 6,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              fontSize: 12,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>已导入 {result.imported.length} 条</div>
              {result.imported.map((item) => (
                <div key={`${item.sourcePath}:${item.note.path}`} style={{ marginBottom: 4 }}>
                  <div style={{ color: "#24292f" }}>{item.note.path}</div>
                  <div style={{ color: "#6e7681" }}>{item.sourcePath}</div>
                </div>
              ))}
            </div>
          )}

          {result && renderMessages(result.warnings, "warning")}
          {result && renderMessages(result.failures, "failure")}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 24px 24px" }}>
          <button
            onClick={onClose}
            disabled={!canClose}
            style={{
              padding: "6px 16px", fontSize: 13, cursor: "pointer",
              border: "1px solid #d0d7de", borderRadius: 6, background: "#f6f8fa",
            }}
          >
            {hasResult ? "关闭" : "取消"}
          </button>
          {!hasResult && (
            <button
              onClick={handleConfirm}
              disabled={importing}
              style={{
                padding: "6px 16px", fontSize: 13, cursor: "pointer",
                border: "none", borderRadius: 6,
                background: importing ? "#8ab4e8" : "#0969da", color: "#fff",
              }}
            >
              {importing ? "导入中…" : "确认导入"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
