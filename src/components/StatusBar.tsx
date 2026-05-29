import { useEditorStore } from "../store/useEditorStore";

export function StatusBar() {
  const { currentNote, saveStatus, content } = useEditorStore();
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const statusLabel =
    saveStatus === "saving" ? "保存中…" :
    saveStatus === "error" ? "保存失败" :
    saveStatus === "unsaved" ? "未保存" : "已保存";

  return (
    <footer className="status-bar">
      {currentNote && (
        <>
          <span>{currentNote.path}</span>
          <span>{wordCount} 字</span>
          <span>{statusLabel}</span>
        </>
      )}
    </footer>
  );
}
