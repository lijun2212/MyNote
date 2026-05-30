import { useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { api } from "../../api/commands";
import { useOpenNote } from "../../hooks/useOpenNote";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

const ALLOWED_MARKDOWN_TAGS = [
  "a", "blockquote", "br", "code", "del", "em", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
];

const ALLOWED_MARKDOWN_ATTR = ["href", "title", "class", "data-title"];

function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ALLOWED_MARKDOWN_TAGS,
    ALLOWED_ATTR: ALLOWED_MARKDOWN_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
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

function stripPreviewFrontMatter(content: string): string {
  const normalizedFirstLineEnd = content.indexOf("\n");
  const firstLine = normalizedFirstLineEnd === -1 ? content : content.slice(0, normalizedFirstLineEnd);

  if (firstLine.replace(/\r$/, "") !== "---") {
    return content;
  }

  let lineStart = normalizedFirstLineEnd + 1;
  if (normalizedFirstLineEnd === -1) {
    return content;
  }

  while (lineStart < content.length) {
    const nextLineEnd = content.indexOf("\n", lineStart);
    const lineEnd = nextLineEnd === -1 ? content.length : nextLineEnd;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/, "");

    if (line === "---") {
      const bodyStart = nextLineEnd === -1 ? content.length : nextLineEnd + 1;
      return content.slice(bodyStart).replace(/^\r?\n+/, "");
    }

    if (nextLineEnd === -1) {
      break;
    }
    lineStart = nextLineEnd + 1;
  }

  return content;
}

interface Props {
  content: string;
}

export function MarkdownPreview({ content }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { openNote, beginOpenNote, isOpenNoteRequestCurrent } = useOpenNote();

  useEffect(() => {
    if (!containerRef.current) return;
    const previewContent = stripPreviewFrontMatter(content);
    const rawHtml = md.render(previewContent);
    const processedHtml = processWikiLinks(rawHtml);
    containerRef.current.innerHTML = sanitizePreviewHtml(processedHtml);
  }, [content]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const wikiLink = target.closest(".wiki-link") as HTMLElement | null;
      if (!wikiLink) {
        const anchor = target.closest("a") as HTMLAnchorElement | null;
        if (anchor?.href && /^https?:\/\//.test(anchor.href)) {
          e.preventDefault();
          await openUrl(anchor.href);
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

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [openNote, beginOpenNote, isOpenNoteRequestCurrent]);

  return (
    <div style={{
      width: "100%",
      height: "100%",
      overflowY: "auto",
      background: "#fff",
    }}>
      <style>{`
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
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "20px 40px",
          fontSize: 15,
          lineHeight: 1.7,
        }}
      />
    </div>
  );
}
