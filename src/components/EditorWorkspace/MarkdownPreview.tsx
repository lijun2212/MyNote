import { useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import MarkdownIt from "markdown-it";
import { api } from "../../api/commands";
import { useEditorStore } from "../../store/useEditorStore";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

function processWikiLinks(html: string): string {
  // Replace [[Title]] patterns in text nodes by encoding them as spans
  // We operate on the raw HTML string (safe since md.render has already escaped)
  return html.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
    const escaped = title.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<span class="wiki-link" data-title="${escaped}">${escaped}</span>`;
  });
}

interface Props {
  content: string;
}

export function MarkdownPreview({ content }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const rawHtml = md.render(content);
    containerRef.current.innerHTML = processWikiLinks(rawHtml);
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
      try {
        const note = await api.getNoteByTitle(title);
        if (note) {
          const detail = await api.getNoteByPath(note.path);
          useEditorStore.getState().setCurrentNote(detail.note);
          useEditorStore.getState().setContent(detail.content);
        }
      } catch (e) {
        console.error("Failed to open wiki link:", e);
      }
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, []);

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      height: "100%",
      overflowY: "auto",
      borderLeft: "1px solid #e0e2e7",
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
