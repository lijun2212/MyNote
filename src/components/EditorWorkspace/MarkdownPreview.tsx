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
    <div
      ref={containerRef}
      style={{
        flex: 1,
        height: "100%",
        overflowY: "auto",
        padding: "20px 40px",
        maxWidth: 720,
        margin: "0 auto",
        fontSize: 15,
        lineHeight: 1.7,
      }}
    />
  );
}
