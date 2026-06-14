import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import usageHelpMarkdown from "../../../docs/usage-help.md?raw";

interface UsageHelpDialogProps {
  open: boolean;
  onClose: () => void;
}

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

const ALLOWED_TAGS = [
  "a",
  "article",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

const ALLOWED_ATTR = ["href", "id"];

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.34)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  zIndex: 1200,
};

const panelStyle: React.CSSProperties = {
  width: "min(920px, 100%)",
  maxHeight: "min(760px, calc(100vh - 48px))",
  overflow: "hidden",
  borderRadius: "18px",
  background: "#fffdf8",
  boxShadow: "0 28px 80px rgba(15, 23, 42, 0.18)",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  padding: "24px 24px 20px",
  display: "flex",
  flexDirection: "column",
  gap: "18px",
};

const closeButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: "20px",
  lineHeight: 1,
  cursor: "pointer",
  color: "#334155",
};

const previewFrameStyle: React.CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: "16px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.9) 100%)",
  overflow: "auto",
  padding: "24px 28px 28px",
  color: "#1f2937",
};

const previewContentStyle: React.CSSProperties = {
  maxWidth: "760px",
  margin: "0 auto",
  lineHeight: 1.75,
  fontSize: "14px",
};

function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .replace(/^-+|-+$/g, "") || "section";
}

function renderUsageHelpHtml(markdown: string): string {
  const rendered = md.render(markdown);
  const parser = new DOMParser();
  const document = parser.parseFromString(rendered, "text/html");

  const usedIds = new Set<string>();
  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
    const rawText = heading.textContent?.trim() ?? "";
    if (!rawText) {
      return;
    }

    const explicitIdMatch = rawText.match(/^(.*?)(?:\s*\{#([A-Za-z0-9_-]+)\})$/);
    const headingText = explicitIdMatch?.[1]?.trim() ?? rawText;
    let headingId = explicitIdMatch?.[2] ?? slugifyHeading(headingText);

    let suffix = 2;
    while (usedIds.has(headingId)) {
      headingId = `${headingId}-${suffix}`;
      suffix += 1;
    }

    usedIds.add(headingId);
    heading.id = headingId;
    heading.textContent = headingText;
  });

  return DOMPurify.sanitize(document.body.innerHTML, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?):|#)/i,
  });
}

function applyPreviewTypography(container: HTMLDivElement) {
  container.querySelectorAll("h1").forEach((element) => {
    Object.assign((element as HTMLElement).style, {
      fontSize: "30px",
      lineHeight: "1.25",
      margin: "0 0 16px",
      color: "#0f172a",
    });
  });

  container.querySelectorAll("h2").forEach((element) => {
    Object.assign((element as HTMLElement).style, {
      fontSize: "22px",
      lineHeight: "1.35",
      margin: "28px 0 12px",
      color: "#0f172a",
      borderBottom: "1px solid rgba(226, 232, 240, 0.9)",
      paddingBottom: "6px",
    });
  });

  container.querySelectorAll("h3, h4").forEach((element) => {
    Object.assign((element as HTMLElement).style, {
      fontSize: "18px",
      lineHeight: "1.45",
      margin: "22px 0 10px",
      color: "#0f172a",
    });
  });

  container.querySelectorAll("p, ul, ol, table, blockquote, pre").forEach((element) => {
    Object.assign((element as HTMLElement).style, {
      margin: "0 0 14px",
    });
  });

  container.querySelectorAll("ul, ol").forEach((element) => {
    Object.assign((element as HTMLElement).style, {
      paddingLeft: "22px",
    });
  });

  container.querySelectorAll("a").forEach((element) => {
    Object.assign((element as HTMLElement).style, {
      color: "#0969da",
      textDecoration: "none",
    });
  });

  container.querySelectorAll("code").forEach((element) => {
    Object.assign((element as HTMLElement).style, {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "0.95em",
      background: "rgba(226, 232, 240, 0.55)",
      borderRadius: "6px",
      padding: "1px 5px",
    });
  });

  container.querySelectorAll("pre").forEach((element) => {
    Object.assign((element as HTMLElement).style, {
      padding: "14px 16px",
      overflowX: "auto",
      background: "#f8fafc",
      borderRadius: "12px",
      border: "1px solid rgba(226, 232, 240, 0.9)",
    });
  });

  container.querySelectorAll("table").forEach((element) => {
    Object.assign((element as HTMLElement).style, {
      width: "100%",
      borderCollapse: "collapse",
    });
  });

  container.querySelectorAll("th, td").forEach((element) => {
    Object.assign((element as HTMLElement).style, {
      border: "1px solid rgba(226, 232, 240, 0.9)",
      padding: "8px 10px",
      textAlign: "left",
      verticalAlign: "top",
    });
  });
}

export function UsageHelpDialog({ open, onClose }: UsageHelpDialogProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderUsageHelpHtml(usageHelpMarkdown), []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !previewRef.current) {
      return;
    }

    applyPreviewTypography(previewRef.current);
  }, [html, open]);

  if (!open) {
    return null;
  }

  return (
    <div data-testid="usage-help-dialog-overlay" onClick={onClose} style={overlayStyle}>
      <div
        aria-label="使用帮助"
        aria-modal="true"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        style={panelStyle}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "24px" }}>使用帮助</h2>
            <p style={{ margin: "8px 0 0", color: "#475569" }}>面向最终用户的 MyNote 使用说明，支持目录跳转与预览阅读。</p>
          </div>
          <button aria-label="关闭使用帮助弹窗" onClick={onClose} style={closeButtonStyle} type="button">×</button>
        </div>

        <div
          onClick={(event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
              return;
            }

            const link = target.closest("a[href^='#']") as HTMLAnchorElement | null;
            if (!link) {
              return;
            }

            const href = link.getAttribute("href");
            if (!href) {
              return;
            }

            const anchorId = decodeURIComponent(href.slice(1));
            const anchorTarget = previewRef.current?.querySelector(`#${CSS.escape(anchorId)}`);
            if (!anchorTarget) {
              return;
            }

            event.preventDefault();
            anchorTarget.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          style={previewFrameStyle}
        >
          <div
            ref={previewRef}
            style={previewContentStyle}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
}