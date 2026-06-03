import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "../types";
import { useSearch } from "../hooks/useSearch";
import { useOpenNote } from "../hooks/useOpenNote";
import { useEditorStore } from "../store/useEditorStore";
import { useSearchSessionStore } from "../store/useSearchSessionStore";

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

function getSearchResultKey(result: SearchResult) {
  return [
    result.note_id,
    result.source,
    result.line_start,
    result.line_end,
    result.occurrence_order,
  ].join(":");
}

interface SearchOverlayProps {
  onClose: () => void;
}

export function SearchOverlay({ onClose }: SearchOverlayProps) {
  const [inputValue, setInputValue] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredDeleteKey, setHoveredDeleteKey] = useState<string | null>(null);
  const { results, isLoading } = useSearch(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRecordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposingRef = useRef(false);
  const { openNote, beginOpenNote, isOpenNoteRequestCurrent } = useOpenNote();
  const setSearchNavigationTarget = useEditorStore((s) => s.setSearchNavigationTarget);
  const recentQueries = useSearchSessionStore((s) => s.recentQueries);
  const recentHits = useSearchSessionStore((s) => s.recentHits);
  const recordQuery = useSearchSessionStore((s) => s.recordQuery);
  const removeRecentQuery = useSearchSessionStore((s) => s.removeRecentQuery);
  const clearRecentQueries = useSearchSessionStore((s) => s.clearRecentQueries);
  const recordOpenedHit = useSearchSessionStore((s) => s.recordOpenedHit);
  const removeRecentHit = useSearchSessionStore((s) => s.removeRecentHit);
  const clearRecentHits = useSearchSessionStore((s) => s.clearRecentHits);
  const startSession = useSearchSessionStore((s) => s.startSession);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (queryRecordTimerRef.current) {
      clearTimeout(queryRecordTimerRef.current);
    }

    if (!trimmedQuery) {
      return;
    }

    queryRecordTimerRef.current = setTimeout(() => {
      recordQuery(trimmedQuery);
    }, 300);

    return () => {
      if (queryRecordTimerRef.current) {
        clearTimeout(queryRecordTimerRef.current);
      }
    };
  }, [query, recordQuery]);

  const openResult = async (result: SearchResult, index: number) => {
    const requestId = beginOpenNote();
    try {
      await openNote(result.path, requestId);
    } catch {
      return;
    }

    if (!isOpenNoteRequestCurrent(requestId)) return;
    if (useEditorStore.getState().currentNote?.path !== result.path) return;

    const trimmedQuery = query.trim();
    recordQuery(trimmedQuery);
    recordOpenedHit(trimmedQuery, result);
    startSession({
      query: trimmedQuery,
      results,
      currentIndex: index,
    });

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
    onClose();
  };

  const handleClearRecentQueries = () => {
    if (!window.confirm("确认清空最近搜索吗？")) {
      return;
    }

    clearRecentQueries();
  };

  const handleClearRecentHits = () => {
    if (!window.confirm("确认清空最近查看命中吗？")) {
      return;
    }

    clearRecentHits();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isComposingRef.current || e.nativeEvent.isComposing) {
      return;
    }

    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results.length > 0) {
      openResult(results[selectedIndex], selectedIndex);
    }
  };

  const getDeleteButtonStyle = (key: string): React.CSSProperties => ({
    ...styles.historyDeleteIconButton,
    ...(hoveredDeleteKey === key ? styles.historyDeleteIconButtonHovered : styles.historyDeleteIconButtonIdle),
  });

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          style={styles.input}
          placeholder="输入关键词搜索笔记"
          value={inputValue}
          onChange={(e) => {
            const nextValue = e.target.value;
            setInputValue(nextValue);
            if (!isComposingRef.current) {
              setQuery(nextValue);
            }
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            const nextValue = e.currentTarget.value;
            setInputValue(nextValue);
            setQuery(nextValue);
          }}
          onKeyDown={handleKeyDown}
        />
        <div style={styles.results}>
          {!query.trim() && (
            <div style={styles.historyPanel}>
              <section style={styles.historySection}>
                <div style={styles.historySectionHeader}>
                  <div style={styles.historyHeading}>最近搜索</div>
                  {recentQueries.length > 0 && (
                    <button
                      type="button"
                      aria-label="清空最近搜索"
                      style={styles.historyActionButton}
                      onClick={handleClearRecentQueries}
                    >
                      清空
                    </button>
                  )}
                </div>
                {recentQueries.length > 0 ? (
                  <div style={styles.historyQueryList}>
                    {recentQueries.map((item) => (
                      <div key={item} style={styles.historyQueryChip}>
                        <button
                          type="button"
                          style={styles.historyQueryButton}
                          onClick={() => {
                            setInputValue(item);
                            setQuery(item);
                          }}
                        >
                          {item}
                        </button>
                        <button
                          type="button"
                          aria-label={`删除最近搜索 ${item}`}
                          style={getDeleteButtonStyle(`query:${item}`)}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeRecentQuery(item);
                          }}
                          onMouseEnter={() => setHoveredDeleteKey(`query:${item}`)}
                          onMouseLeave={() => setHoveredDeleteKey((current) => (current === `query:${item}` ? null : current))}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={styles.historyEmpty}>暂无最近搜索</div>
                )}
              </section>

              <section style={styles.historySection}>
                <div style={styles.historySectionHeader}>
                  <div style={styles.historyHeading}>最近查看命中</div>
                  {recentHits.length > 0 && (
                    <button
                      type="button"
                      aria-label="清空最近查看命中"
                      style={styles.historyActionButton}
                      onClick={handleClearRecentHits}
                    >
                      清空
                    </button>
                  )}
                </div>
                {recentHits.length > 0 ? recentHits.map((item) => (
                  <div
                    key={`${item.query}:${item.note_id}:${item.line_start}:${item.occurrence_order}`}
                    style={styles.historyHitRow}
                  >
                    <button
                      type="button"
                      aria-label={`恢复最近查看命中 ${item.note_title}`}
                      style={styles.historyHitButton}
                      onClick={() => {
                        setInputValue(item.query);
                        setQuery(item.query);
                      }}
                    >
                      <div style={styles.historyHitTitle}>{item.note_title}</div>
                      <div style={styles.historyHitMeta}>
                        {item.source === "title" ? "标题命中" : `第 ${item.line_start} 行`} · 来自搜索：{item.query}
                      </div>
                      <div style={styles.historyHitSnippet}>{renderSnippet(item.snippet)}</div>
                    </button>
                    <button
                      type="button"
                      aria-label={`删除最近查看命中 ${item.note_title}`}
                      style={getDeleteButtonStyle(`hit:${item.query}:${item.note_id}:${item.line_start}:${item.occurrence_order}`)}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeRecentHit(item.query, item.note_id, item.line_start, item.occurrence_order);
                      }}
                      onMouseEnter={() => setHoveredDeleteKey(`hit:${item.query}:${item.note_id}:${item.line_start}:${item.occurrence_order}`)}
                      onMouseLeave={() => setHoveredDeleteKey((current) => (current === `hit:${item.query}:${item.note_id}:${item.line_start}:${item.occurrence_order}` ? null : current))}
                    >
                      x
                    </button>
                  </div>
                )) : (
                  <div style={styles.historyEmpty}>暂无最近查看命中</div>
                )}
              </section>
            </div>
          )}
          {query.trim() && !isLoading && results.length === 0 && (
            <div style={styles.empty}>未找到匹配的笔记</div>
          )}
          {results.map((r, i) => (
            <div
              key={getSearchResultKey(r)}
              style={{
                ...styles.resultItem,
                ...(i === selectedIndex ? styles.resultItemSelected : {}),
              }}
              onClick={() => openResult(r, i)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div style={styles.resultTitle}>{r.title}</div>
              <div style={styles.resultMeta}>{r.source === "title" ? "标题命中" : `第 ${r.line_start} 行`}</div>
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
  historyPanel: {
    display: "grid",
    gap: 18,
    padding: 16,
  },
  historySection: {
    display: "grid",
    gap: 8,
  },
  historySectionHeader: {
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
  },
  historyHeading: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475467",
    letterSpacing: 0.3,
  },
  historyActionButton: {
    border: "none",
    background: "transparent",
    color: "#2d5bce",
    cursor: "pointer",
    fontSize: 12,
    padding: 0,
  },
  historyQueryList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  historyQueryChip: {
    position: "relative",
  },
  historyQueryButton: {
    border: "1px solid #d0d5dd",
    borderRadius: 10,
    background: "#f8fafc",
    color: "#344054",
    cursor: "pointer",
    fontSize: 13,
    padding: "8px 14px",
    textAlign: "left",
  },
  historyHitRow: {
    position: "relative",
  },
  historyHitButton: {
    border: "1px solid #eaecf0",
    borderRadius: 10,
    background: "#fff",
    cursor: "pointer",
    display: "grid",
    gap: 4,
    padding: "12px 40px 12px 12px",
    textAlign: "left",
    width: "100%",
  },
  historyDeleteIconButton: {
    alignItems: "center",
    border: "none",
    borderRadius: 999,
    color: "#fff",
    cursor: "pointer",
    display: "inline-flex",
    transition: "background-color 140ms ease, box-shadow 140ms ease, transform 140ms ease",
    fontSize: 11,
    fontWeight: 700,
    height: 18,
    justifyContent: "center",
    lineHeight: 1,
    padding: 0,
    position: "absolute",
    right: -4,
    top: -4,
    width: 18,
    zIndex: 1,
  },
  historyDeleteIconButtonIdle: {
    background: "#fb7185",
    boxShadow: "0 2px 6px rgba(244, 63, 94, 0.18)",
  },
  historyDeleteIconButtonHovered: {
    background: "#e11d48",
    boxShadow: "0 6px 14px rgba(225, 29, 72, 0.32)",
    transform: "scale(1.08)",
  },
  historyHitTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#101828",
  },
  historyHitMeta: {
    color: "#667085",
    fontSize: 11,
  },
  historyHitSnippet: {
    color: "#475467",
    fontSize: 12,
  },
  historyEmpty: {
    color: "#98a2b3",
    fontSize: 12,
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
  resultMeta: {
    fontSize: 11,
    color: "#667085",
    marginBottom: 4,
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
