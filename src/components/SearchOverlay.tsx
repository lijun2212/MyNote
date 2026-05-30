import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "../types";
import { useSearch } from "../hooks/useSearch";
import { useOpenNote } from "../hooks/useOpenNote";

type SnippetPart =
  | { kind: "text"; text: string }
  | { kind: "mark"; text: string };

function parseSnippet(raw: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let index = 0;

  while (index < raw.length) {
    const markStart = raw.indexOf("<mark>", index);
    if (markStart === -1) {
      parts.push({ kind: "text", text: raw.slice(index) });
      break;
    }

    if (markStart > index) {
      parts.push({ kind: "text", text: raw.slice(index, markStart) });
    }

    const contentStart = markStart + "<mark>".length;
    const markEnd = raw.indexOf("</mark>", contentStart);
    if (markEnd === -1) {
      parts.push({ kind: "text", text: raw.slice(markStart) });
      break;
    }

    const nestedMarkStart = raw.indexOf("<mark>", contentStart);
    if (nestedMarkStart !== -1 && nestedMarkStart < markEnd) {
      parts.push({ kind: "text", text: raw.slice(markStart, markEnd + "</mark>".length) });
      index = markEnd + "</mark>".length;
      continue;
    }

    parts.push({ kind: "mark", text: raw.slice(contentStart, markEnd) });
    index = markEnd + "</mark>".length;
  }

  return parts;
}

function renderSnippet(raw: string) {
  return parseSnippet(raw).map((part, index) => {
    if (part.kind === "mark") {
      return <mark key={index}>{part.text}</mark>;
    }
    return <span key={index}>{part.text}</span>;
  });
}

interface SearchOverlayProps {
  onClose: () => void;
}

export function SearchOverlay({ onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { results, isLoading } = useSearch(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const { openNote } = useOpenNote();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const openResult = async (result: SearchResult) => {
    await openNote(result.path);
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
              <div style={styles.resultSnippet}>{renderSnippet(r.snippet)}</div>
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
