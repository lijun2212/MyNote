import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useEditorStore } from "../store/useEditorStore";

export function StatusBar() {
  const { currentNote, saveStatus, content } = useEditorStore();
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const statusLabel =
    saveStatus === "saving" ? "保存中…" :
    saveStatus === "error" ? "保存失败" :
    saveStatus === "unsaved" ? "未保存" : "已保存";

  const [indexing, setIndexing] = useState(false);
  const indexTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | undefined;
    listen("note:index_updated", () => {
      if (!isMounted) return;
      setIndexing(true);
      if (indexTimerRef.current) clearTimeout(indexTimerRef.current);
      indexTimerRef.current = setTimeout(() => setIndexing(false), 2000);
    }).then((fn) => {
      unlisten = fn;
      if (!isMounted) fn();
    });
    return () => {
      isMounted = false;
      unlisten?.();
      if (indexTimerRef.current) clearTimeout(indexTimerRef.current);
    };
  }, []);

  return (
    <footer className="status-bar">
      {currentNote && (
        <>
          <span>{currentNote.path}</span>
          <span>{wordCount} 字</span>
          <span>{statusLabel}</span>
        </>
      )}
      {indexing && <span style={{ color: "#0969da" }}>● 索引同步中</span>}
    </footer>
  );
}
