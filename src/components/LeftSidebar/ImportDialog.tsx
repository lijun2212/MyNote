import { useState } from "react";
import { api } from "../../api/commands";
import type { Note } from "../../types";

interface Props {
  files: string[];
  existingDirs: string[];
  onClose: () => void;
  onDone: (lastImported?: Note) => void | Promise<void>;
}

export function ImportDialog({ files, existingDirs, onClose, onDone }: Props) {
  const [destDir, setDestDir] = useState(existingDirs[0] ?? "notes");
  const [customDir, setCustomDir] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const finalDir = useCustom ? customDir.trim() || "notes" : destDir;

  async function handleConfirm() {
    setImporting(true);
    setErrors([]);
    const errs: string[] = [];
    let lastImported: Note | undefined;
    for (const f of files) {
      try {
        lastImported = await api.importNote(f, finalDir);
      } catch (e) {
        errs.push(`${f.split("/").pop()}: ${e}`);
      }
    }
    if (errs.length > 0) {
      setImporting(false);
      setErrors(errs);
    } else {
      try {
        await onDone(lastImported);
      } catch (e) {
        setErrors([`导入完成，但打开笔记失败：${e}`]);
      } finally {
        setImporting(false);
      }
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "#fff", borderRadius: 8,
        padding: 24, minWidth: 360, maxWidth: 480,
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
      }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>导入笔记</h3>

        {/* File list */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#6e7681", marginBottom: 6 }}>
            即将导入 {files.length} 个文件：
          </div>
          <div style={{
            maxHeight: 120, overflowY: "auto",
            border: "1px solid #e0e2e7", borderRadius: 4, padding: "6px 8px",
            fontSize: 12, background: "#f6f8fa",
          }}>
            {files.map(f => (
              <div key={f} style={{ padding: "2px 0", color: "#24292f" }}>
                {f.split("/").pop()}
              </div>
            ))}
          </div>
        </div>

        {/* Destination directory */}
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
                placeholder="输入目录名，如 work/2024"
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

        {/* Errors */}
        {errors.length > 0 && (
          <div style={{
            marginBottom: 16, padding: 8, borderRadius: 4,
            background: "#fff8c5", border: "1px solid #d4a72c", fontSize: 12,
          }}>
            {errors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            disabled={importing}
            style={{
              padding: "6px 16px", fontSize: 13, cursor: "pointer",
              border: "1px solid #d0d7de", borderRadius: 6, background: "#f6f8fa",
            }}
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={importing}
            style={{
              padding: "6px 16px", fontSize: 13, cursor: "pointer",
              border: "none", borderRadius: 6,
              background: importing ? "#8ab4e8" : "#0969da", color: "#fff",
            }}
          >
            {importing ? "导入中…" : `导入 ${files.length} 个文件`}
          </button>
        </div>
      </div>
    </div>
  );
}
