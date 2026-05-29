import { useEffect, useRef } from "react";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

interface Props {
  content: string;
}

export function MarkdownPreview({ content }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = md.render(content);
  }, [content]);

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      height: "100%",
      overflowY: "auto",
      borderLeft: "1px solid #e0e2e7",
      background: "#fff",
    }}>
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
