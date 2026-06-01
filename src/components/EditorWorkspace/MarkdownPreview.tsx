import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { api } from "../../api/commands";
import { useOpenNote } from "../../hooks/useOpenNote";
import { findInlineTagMatches } from "./inlineTags";
import {
  getTopVisibleSourceLine,
  scrollPreviewToSourceLine,
  type SourceLineSyncSignal,
} from "./sourceLineSync";
import type { TagNavigationTarget } from "../../types";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const SOURCE_LINE_TAGS = new Set(["blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol", "p", "table", "tr", "ul"]);

md.core.ruler.push("source_line_attrs", (state) => {
  state.tokens.forEach((token) => {
    if (!token.map) return;
    if ((token.nesting === 1 && SOURCE_LINE_TAGS.has(token.tag)) || token.type === "fence") {
      token.attrSet("data-source-line", String(token.map[0] + 1));
      token.attrSet("data-source-end-line", String(token.map[1]));
    }
  });
});

const ALLOWED_MARKDOWN_TAGS = [
  "a", "blockquote", "br", "code", "del", "em", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "img",
  "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
];

const ALLOWED_MARKDOWN_ATTR = ["alt", "href", "src", "title", "class", "data-title", "data-source-line", "data-source-end-line"];
const ALLOWED_MARKDOWN_URI = /^(?:(?:https?):|(?:data:image\/(?:gif|png|jpe?g|webp);base64,)|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;
const MIN_TABLE_COLUMN_PERCENT = 8;

function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ALLOWED_MARKDOWN_TAGS,
    ALLOWED_ATTR: ALLOWED_MARKDOWN_ATTR,
    ALLOWED_URI_REGEXP: ALLOWED_MARKDOWN_URI,
  });
}

function processWikiLinks(html: string): string {
  // Replace [[Title]] patterns in text nodes by encoding them as spans
  // We operate on the raw HTML string (safe since md.render has already escaped)
  return html.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
    const escaped = title.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<span class="wiki-link" data-title="${escaped}">${escaped}</span>`;
  });
}

function extractPreviewBody(content: string): { content: string; lineOffset: number } {
  const normalizedFirstLineEnd = content.indexOf("\n");
  const firstLine = normalizedFirstLineEnd === -1 ? content : content.slice(0, normalizedFirstLineEnd);

  if (firstLine.replace(/\r$/, "") !== "---") {
    return { content, lineOffset: 0 };
  }

  let lineStart = normalizedFirstLineEnd + 1;
  if (normalizedFirstLineEnd === -1) {
    return { content, lineOffset: 0 };
  }

  while (lineStart < content.length) {
    const nextLineEnd = content.indexOf("\n", lineStart);
    const lineEnd = nextLineEnd === -1 ? content.length : nextLineEnd;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/, "");

    if (line === "---") {
      let bodyStart = nextLineEnd === -1 ? content.length : nextLineEnd + 1;
      while (bodyStart < content.length) {
        const nextNewline = content.startsWith("\r\n", bodyStart)
          ? 2
          : content[bodyStart] === "\n"
            ? 1
            : 0;
        if (nextNewline === 0) break;
        bodyStart += nextNewline;
      }

      return {
        content: content.slice(bodyStart),
        lineOffset: content.slice(0, bodyStart).split(/\r?\n/).length - 1,
      };
    }

    if (nextLineEnd === -1) {
      break;
    }
    lineStart = nextLineEnd + 1;
  }

  return { content, lineOffset: 0 };
}

function collectInlineTagLineMatches(content: string): Array<{ line: number; tagName: string; occurrenceOrder: number }> {
  let occurrenceOrder = 0;
  return content.split(/\r?\n/).flatMap((lineText, index) =>
    findInlineTagMatches(lineText).map((match) => {
      occurrenceOrder += 1;
      return {
        line: index + 1,
        tagName: match.name,
        occurrenceOrder,
      };
    }),
  );
}

function translateTagNavigationTarget(
  tagNavigationTarget: TagNavigationTarget | null | undefined,
  lineOffset: number,
): TagNavigationTarget | null {
  if (!tagNavigationTarget) return null;

  const translatedLineStart = tagNavigationTarget.line_start - lineOffset;
  const translatedLineEnd = tagNavigationTarget.line_end - lineOffset;
  if (translatedLineEnd < 1) return null;

  return {
    ...tagNavigationTarget,
    line_start: Math.max(1, translatedLineStart),
    line_end: Math.max(1, translatedLineEnd),
  };
}

function formatColumnWidth(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

function shouldSkipInlineTagEnhancement(node: Node | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return Boolean(node.closest("a, code, pre, .inline-tag-chip"));
}

function createInlineTagChip(tagName: string) {
  const chip = document.createElement("span");
  chip.className = "inline-tag-chip";
  chip.dataset.tagName = tagName;

  const label = document.createElement("span");
  label.className = "inline-tag-chip-label";
  label.textContent = tagName;

  chip.appendChild(label);
  return chip;
}

function enhanceInlineTags(
  container: HTMLElement,
  inlineTagLineMatches: Array<{ line: number; tagName: string; occurrenceOrder: number }>,
  tagNavigationTarget: TagNavigationTarget | null,
) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let inlineTagMatchIndex = 0;

  let currentNode = walker.nextNode();
  while (currentNode) {
    if (!shouldSkipInlineTagEnhancement(currentNode.parentNode) && currentNode.textContent?.includes("#")) {
      textNodes.push(currentNode as Text);
    }
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    const matches = findInlineTagMatches(text);
    if (matches.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      if (match.start > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)));
      }
      const chip = createInlineTagChip(match.name);
      const sourceMatch = inlineTagLineMatches[inlineTagMatchIndex] ?? null;
      if (sourceMatch) {
        chip.dataset.sourceLine = String(sourceMatch.line);
        chip.dataset.occurrenceOrder = String(sourceMatch.occurrenceOrder);
        inlineTagMatchIndex += 1;
        if (
          tagNavigationTarget
          && sourceMatch.line === tagNavigationTarget.line_start
          && sourceMatch.tagName === tagNavigationTarget.tag_name
          && sourceMatch.occurrenceOrder === tagNavigationTarget.occurrence_order
        ) {
          chip.classList.add("inline-tag-navigation-target");
        }
      }
      fragment.appendChild(chip);
      cursor = match.end;
    }
    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }
}

function enhanceResizableTables(container: HTMLElement) {
  const tables = Array.from(container.querySelectorAll("table"));

  tables.forEach((table) => {
    const firstRow = table.querySelector("tr");
    if (!firstRow) return;

    const cells = Array.from(firstRow.children).filter(
      (cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
    );
    if (cells.length < 2) return;

    table.classList.add("markdown-table-resizable");

    const colgroup = document.createElement("colgroup");
    const initialWidth = 100 / cells.length;
    cells.forEach(() => {
      const col = document.createElement("col");
      col.style.width = formatColumnWidth(initialWidth);
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);

    cells.slice(0, -1).forEach((cell, index) => {
      cell.classList.add("markdown-table-resizable-cell");
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "markdown-table-resize-handle";
      handle.dataset.columnIndex = String(index);
      handle.setAttribute("aria-label", `调整第 ${index + 1} 列宽度`);
      cell.appendChild(handle);
    });
  });
}

function readColumnWidths(cols: HTMLTableColElement[]): number[] {
  const fallbackWidth = 100 / cols.length;
  return cols.map((col) => {
    const value = Number.parseFloat(col.style.width);
    return Number.isFinite(value) ? value : fallbackWidth;
  });
}

interface Props {
  content: string;
  tagNavigationTarget?: TagNavigationTarget | null;
  sourceLineSyncSignal?: SourceLineSyncSignal | null;
  onTopVisibleLineChange?: (line: number) => void;
}

export function MarkdownPreview({ content, tagNavigationTarget, sourceLineSyncSignal, onTopVisibleLineChange }: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const navigationHighlightTimerRef = useRef<number | null>(null);
  const previewLineOffsetRef = useRef(0);
  const [activePreviewNavigationTarget, setActivePreviewNavigationTarget] = useState<TagNavigationTarget | null>(null);
  const [isFrontMatterNavigationActive, setIsFrontMatterNavigationActive] = useState(false);
  const { openNote, beginOpenNote, isOpenNoteRequestCurrent } = useOpenNote();

  const releaseProgrammaticScrollSoon = () => {
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
    }
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      isProgrammaticScroll.current = false;
      programmaticScrollTimerRef.current = null;
    }, 120);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const previewBody = extractPreviewBody(content);
    previewLineOffsetRef.current = previewBody.lineOffset;
    const rawHtml = md.render(previewBody.content);
    const processedHtml = processWikiLinks(rawHtml);
    containerRef.current.innerHTML = sanitizePreviewHtml(processedHtml);
    containerRef.current.classList.toggle(
      "markdown-preview-front-matter-navigation-target",
      isFrontMatterNavigationActive,
    );
    enhanceInlineTags(
      containerRef.current,
      collectInlineTagLineMatches(previewBody.content),
      activePreviewNavigationTarget,
    );
    enhanceResizableTables(containerRef.current);
  }, [content, activePreviewNavigationTarget, isFrontMatterNavigationActive]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const contentContainer = containerRef.current;
    if (!scrollContainer || !contentContainer) return;

    if (navigationHighlightTimerRef.current !== null) {
      window.clearTimeout(navigationHighlightTimerRef.current);
      navigationHighlightTimerRef.current = null;
    }

    if (!tagNavigationTarget) {
      setActivePreviewNavigationTarget(null);
      setIsFrontMatterNavigationActive(false);
      return;
    }

    const translatedTagNavigationTarget = translateTagNavigationTarget(tagNavigationTarget, previewLineOffsetRef.current);

    setActivePreviewNavigationTarget(translatedTagNavigationTarget);
    setIsFrontMatterNavigationActive(Boolean(tagNavigationTarget.source === "front_matter" && !translatedTagNavigationTarget));
    contentContainer.classList.remove("markdown-preview-front-matter-navigation-target");
    contentContainer
      .querySelectorAll(".inline-tag-navigation-target")
      .forEach((node) => node.classList.remove("inline-tag-navigation-target"));

    if (translatedTagNavigationTarget) {
      const targetChip = Array.from(contentContainer.querySelectorAll<HTMLElement>(".inline-tag-chip")).find(
        (node) => node.dataset.tagName === translatedTagNavigationTarget.tag_name
          && Number(node.dataset.sourceLine) === translatedTagNavigationTarget.line_start
          && Number(node.dataset.occurrenceOrder) === translatedTagNavigationTarget.occurrence_order,
      );
      targetChip?.classList.add("inline-tag-navigation-target");
    } else if (tagNavigationTarget.source === "front_matter") {
      contentContainer.classList.add("markdown-preview-front-matter-navigation-target");
    }

    isProgrammaticScroll.current = true;
    if (translatedTagNavigationTarget) {
      scrollPreviewToSourceLine(scrollContainer, contentContainer, translatedTagNavigationTarget.line_start);
    } else {
      scrollContainer.scrollTop = 0;
    }
    releaseProgrammaticScrollSoon();

    navigationHighlightTimerRef.current = window.setTimeout(() => {
      setActivePreviewNavigationTarget(null);
      setIsFrontMatterNavigationActive(false);
      contentContainer.classList.remove("markdown-preview-front-matter-navigation-target");
      contentContainer
        .querySelectorAll(".inline-tag-navigation-target")
        .forEach((node) => node.classList.remove("inline-tag-navigation-target"));
      navigationHighlightTimerRef.current = null;
    }, 1600);
  }, [tagNavigationTarget]);

  useEffect(() => {
    if (!sourceLineSyncSignal || sourceLineSyncSignal.source === "preview") return;

    const scrollContainer = scrollContainerRef.current;
    const contentContainer = containerRef.current;
    if (!scrollContainer || !contentContainer) return;

    isProgrammaticScroll.current = true;
    scrollPreviewToSourceLine(
      scrollContainer,
      contentContainer,
      Math.max(1, sourceLineSyncSignal.line - previewLineOffsetRef.current),
    );
    releaseProgrammaticScrollSoon();
  }, [sourceLineSyncSignal]);

  const handlePreviewScroll = () => {
    if (isProgrammaticScroll.current || !scrollContainerRef.current || !containerRef.current || !onTopVisibleLineChange) return;
    const sourceLine = getTopVisibleSourceLine(scrollContainerRef.current, containerRef.current);
    if (sourceLine !== null) onTopVisibleLineChange(sourceLine + previewLineOffsetRef.current);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let activeResize: {
      table: HTMLTableElement;
      cols: HTMLTableColElement[];
      columnIndex: number;
      startX: number;
      startWidths: number[];
    } | null = null;

    const stopTableResize = () => {
      activeResize = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const handleTablePointerMove = (e: PointerEvent) => {
      if (!activeResize) return;

      const { table, cols, columnIndex, startX, startWidths } = activeResize;
      const tableWidth = table.getBoundingClientRect().width;
      if (tableWidth <= 0) return;

      const deltaPercent = ((e.clientX - startX) / tableWidth) * 100;
      const leftStart = startWidths[columnIndex];
      const rightStart = startWidths[columnIndex + 1];
      const combinedWidth = leftStart + rightStart;
      const nextLeft = Math.min(
        combinedWidth - MIN_TABLE_COLUMN_PERCENT,
        Math.max(MIN_TABLE_COLUMN_PERCENT, leftStart + deltaPercent),
      );
      const nextRight = combinedWidth - nextLeft;

      cols[columnIndex].style.width = formatColumnWidth(nextLeft);
      cols[columnIndex + 1].style.width = formatColumnWidth(nextRight);
    };

    const handleTablePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const handle = target.closest(".markdown-table-resize-handle") as HTMLElement | null;
      if (!handle) return;

      const table = handle.closest("table") as HTMLTableElement | null;
      const columnIndex = Number(handle.dataset.columnIndex);
      if (!table || !Number.isInteger(columnIndex)) return;

      const cols = Array.from(table.querySelectorAll("col"));
      if (columnIndex < 0 || columnIndex >= cols.length - 1) return;

      e.preventDefault();
      activeResize = {
        table,
        cols,
        columnIndex,
        startX: e.clientX,
        startWidths: readColumnWidths(cols),
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };

    const handleClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const wikiLink = target.closest(".wiki-link") as HTMLElement | null;
      if (!wikiLink) {
        const anchor = target.closest("a") as HTMLAnchorElement | null;
        const href = anchor?.getAttribute("href");
        if (href) {
          e.preventDefault();
          if (/^https?:\/\//i.test(href)) {
            await openUrl(href);
          }
        }
        return;
      }
      const title = wikiLink.dataset.title;
      if (!title) return;
      const requestId = beginOpenNote();
      try {
        const note = await api.getNoteByTitle(title);
        if (note && isOpenNoteRequestCurrent(requestId)) {
          await openNote(note.path, requestId);
        }
      } catch (e) {
        if (!isOpenNoteRequestCurrent(requestId)) return;
        console.error("Failed to open wiki link:", e);
      }
    };

    container.addEventListener("pointerdown", handleTablePointerDown);
    window.addEventListener("pointermove", handleTablePointerMove);
    window.addEventListener("pointerup", stopTableResize);
    window.addEventListener("pointercancel", stopTableResize);
    container.addEventListener("click", handleClick);
    return () => {
      if (navigationHighlightTimerRef.current !== null) {
        window.clearTimeout(navigationHighlightTimerRef.current);
      }
      container.removeEventListener("pointerdown", handleTablePointerDown);
      window.removeEventListener("pointermove", handleTablePointerMove);
      window.removeEventListener("pointerup", stopTableResize);
      window.removeEventListener("pointercancel", stopTableResize);
      container.removeEventListener("click", handleClick);
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }
      stopTableResize();
    };
  }, [openNote, beginOpenNote, isOpenNoteRequestCurrent]);

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handlePreviewScroll}
      style={{
        width: "100%",
        height: "100%",
        overflowY: "auto",
        background: "#fff",
      }}
    >
      <style>{`
        .markdown-preview-content {
          overflow-wrap: anywhere;
          word-break: normal;
        }
        .markdown-preview-content h1,
        .markdown-preview-content h2,
        .markdown-preview-content h3,
        .markdown-preview-content h4,
        .markdown-preview-content h5,
        .markdown-preview-content h6 {
          font-weight: 700;
          line-height: 1.28;
        }
        .markdown-preview-content h1 {
          margin-top: 0.35em;
          margin-bottom: 0.85em;
          font-size: 1.9em;
        }
        .markdown-preview-content h2 {
          margin-top: 1.45em;
          margin-bottom: 0.65em;
          font-size: 1.45em;
        }
        .markdown-preview-content h3 {
          margin-top: 1.2em;
          margin-bottom: 0.55em;
          font-size: 1.2em;
        }
        .markdown-preview-content h4,
        .markdown-preview-content h5,
        .markdown-preview-content h6 {
          margin-top: 1em;
          margin-bottom: 0.45em;
        }
        .markdown-preview-content p {
          margin-block: 0.85em;
        }
        .markdown-preview-content ul,
        .markdown-preview-content ol,
        .markdown-preview-content blockquote,
        .markdown-preview-content table,
        .markdown-preview-content pre {
          margin-block: 0.65em;
        }
        .markdown-preview-content ul,
        .markdown-preview-content ol {
          padding-left: 2em;
        }
        .markdown-preview-content li {
          padding-left: 0.15em;
          margin-block: 0.35em;
        }
        .markdown-preview-content table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
        }
        .markdown-preview-content .markdown-table-resizable-cell {
          position: relative;
        }
        .markdown-preview-content .markdown-table-resize-handle {
          position: absolute;
          top: 0;
          right: -4px;
          width: 8px;
          height: 100%;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: col-resize;
          z-index: 1;
        }
        .markdown-preview-content .markdown-table-resize-handle::after {
          content: "";
          position: absolute;
          top: 8px;
          right: 3px;
          bottom: 8px;
          width: 2px;
          border-radius: 2px;
          background: transparent;
        }
        .markdown-preview-content .markdown-table-resize-handle:hover::after,
        .markdown-preview-content .markdown-table-resize-handle:focus-visible::after {
          background: var(--accent);
        }
        .markdown-preview-content th,
        .markdown-preview-content td {
          padding: 6px 8px;
          border: 1px solid #e0e2e7;
          overflow-wrap: anywhere;
          white-space: normal;
          vertical-align: top;
        }
        .markdown-preview-content pre {
          overflow-x: auto;
          max-width: 100%;
          padding: 14px 16px;
          background: #f6f8fa;
          border: 1px solid #e1e4e8;
          border-radius: 6px;
          color: #24292f;
          line-height: 1.55;
        }
        .markdown-preview-content code {
          font-family: var(--font-mono);
          font-size: 0.92em;
          background: #f6f8fa;
          border-radius: 4px;
          padding: 0.12em 0.34em;
        }
        .markdown-preview-content pre code {
          display: block;
          padding: 0;
          background: transparent;
          border-radius: 0;
          white-space: pre;
        }
        .markdown-preview-content img {
          max-width: 100%;
          height: auto;
        }
        .markdown-preview-content .inline-tag-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.32em;
          margin: 0 0.12em;
          padding: 0.08em 0.5em 0.08em 0.42em;
          border-radius: 999px;
          background: #eef3ff;
          color: #3558d6;
          font-size: 0.92em;
          font-style: normal;
          font-weight: 600;
          vertical-align: baseline;
          white-space: nowrap;
        }
        .markdown-preview-content .inline-tag-chip::before {
          content: "🏷";
          font-size: 0.9em;
          line-height: 1;
        }
        .markdown-preview-content .inline-tag-navigation-target {
          background: #dfe8ff;
          color: #2448b8;
          box-shadow: 0 0 0 1px rgba(91, 106, 249, 0.24);
        }
        .markdown-preview-content.markdown-preview-front-matter-navigation-target {
          box-shadow: inset 0 0 0 2px rgba(91, 106, 249, 0.22);
          background: linear-gradient(180deg, rgba(91, 106, 249, 0.08), rgba(91, 106, 249, 0));
          transition: box-shadow 160ms ease, background 160ms ease;
        }
        .wiki-link {
          color: var(--color-accent, #5b6af9);
          cursor: pointer;
          text-decoration: underline;
        }
        .wiki-link:hover {
          opacity: 0.8;
        }
      `}</style>
      <div
        ref={containerRef}
        data-testid="markdown-preview-content"
        className="markdown-preview-content"
        style={{
          width: "100%",
          maxWidth: "none",
          minWidth: 0,
          margin: 0,
          padding: "22px 36px",
          fontFamily: "var(--font-reading)",
          fontSize: 15,
          lineHeight: 1.7,
        }}
      />
    </div>
  );
}
