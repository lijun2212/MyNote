import { useCallback, useState } from "react";
import { useEditorStore } from "../../store/useEditorStore";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAutoSave } from "../../hooks/useAutoSave";

export function EditorWorkspace() {
  const { currentNote, content, setContent, markDirty } = useEditorStore();
  const [showPreview, setShowPreview] = useState(true);
  useAutoSave();

  const handleChange = useCallback((newContent: string) => {
    setContent(newContent);
    markDirty();
  }, [setContent, markDirty]);

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
          onClick={() => setShowPreview((p) => !p)}
          style={{ fontSize: 12, padding: "2px 8px", cursor: "pointer", borderRadius: 4, border: "1px solid #ccc" }}
        >
          {showPreview ? "隐藏预览" : "显示预览"}
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <MarkdownEditor initialContent={content} onChange={handleChange} />
        {showPreview && <MarkdownPreview content={content} />}
      </div>
    </div>
  );
}
