import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "../types";
import { useSearch } from "../hooks/useSearch";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";
import { api } from "../api/commands";

function safeSnippet(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

interface SearchOverlayProps {
  onClose: () => void;
}

export function SearchOverlay({ onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { results, isLoading } = useSearch(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const setSelectedNodePath = useAppStore((s) => s.setSelectedNodePath);
  const setCurrentNote = useEditorStore((s) => s.setCurrentNote);
  const setContent = useEditorStore((s) => s.setContent);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const openResult = async (result: SearchResult) => {
    try {
      const detail = await api.getNoteByPath(result.path);
      setSelectedNodePath(result.path);
      setCurrentNote(detail.note);
      setContent(detail.content);
    } catch {
      // ignore
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results.length > 0) {
      openResult(results[selectedIndex]);
    }
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          style={styles.input}
          placeholder="输入关键词搜索笔记"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div style={styles.results}>
          {!query.trim() && (
            <div style={styles.empty}>输入关键词搜索笔记</div>
          )}
          {query.trim() && !isLoading && results.length === 0 && (
            <div style={styles.empty}>未找到匹配的笔记</div>
          )}
          {results.map((r, i) => (
            <div
              key={r.note_id}
              style={{
                ...styles.resultItem,
                ...(i === selectedIndex ? styles.resultItemSelected : {}),
              }}
              onClick={() => openResult(r)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div style={styles.resultTitle}>{r.title}</div>
              <div
                style={styles.resultSnippet}
                dangerouslySetInnerHTML={{ __html: safeSnippet(r.snippet) }}
              />
              <div style={styles.resultPath}>{r.path}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "10vh",
    zIndex: 1000,
  },
  modal: {
    background: "#fff",
    borderRadius: 8,
    boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
    width: "100%",
    maxWidth: 600,
    maxHeight: "70vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  input: {
    border: "none",
    borderBottom: "1px solid #e0e0e0",
    outline: "none",
    padding: "14px 16px",
    fontSize: 16,
    width: "100%",
    boxSizing: "border-box",
  },
  results: {
    overflowY: "auto",
    flex: 1,
  },
  empty: {
    padding: "24px 16px",
    color: "#999",
    textAlign: "center",
    fontSize: 14,
  },
  resultItem: {
    padding: "10px 16px",
    cursor: "pointer",
    borderBottom: "1px solid #f0f0f0",
  },
  resultItemSelected: {
    backgroundColor: "#f0f4ff",
  },
  resultTitle: {
    fontWeight: 600,
    fontSize: 14,
    marginBottom: 2,
  },
  resultSnippet: {
    fontSize: 12,
    color: "#555",
    marginBottom: 2,
  },
  resultPath: {
    fontSize: 11,
    color: "#aaa",
  },
};
