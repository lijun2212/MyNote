import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { NoteLinks } from "../../types";
import { api } from "../../api/commands";
import { useEditorStore } from "../../store/useEditorStore";

interface Props {
  noteId: string | null;
}

export function BacklinksPanel({ noteId }: Props) {
  const [links, setLinks] = useState<NoteLinks | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!noteId) {
      setLinks(null);
      return;
    }

    let isMounted = true;
    setLoading(true);

    api.getNoteLinks(noteId)
      .then(data => { if (isMounted) setLinks(data); })
      .catch(() => { if (isMounted) setLinks(null); })
      .finally(() => { if (isMounted) setLoading(false); });

    return () => { isMounted = false; };
  }, [noteId]);

  const handleLinkClick = async (link: NoteLinks["outgoing"][number]) => {
    try {
      if (link.link_type === "external") {
        await openUrl(link.link_url);
        return;
      }
      if (link.note_path) {
        const detail = await api.getNoteByPath(link.note_path);
        useEditorStore.getState().setCurrentNote(detail.note);
        useEditorStore.getState().setContent(detail.content);
      }
    } catch (e) {
      console.error("Failed to open link:", e);
    }
  };

  if (!noteId) {
    return (
      <div style={{ padding: "12px 8px", fontSize: 13, color: "#999" }}>
        选择笔记以查看链接
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: "12px 8px", fontSize: 13, color: "#999" }}>加载中...</div>;
  }

  const sectionStyle: React.CSSProperties = {
    marginBottom: 12,
  };

  const headingStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "#666",
    padding: "4px 8px",
    background: "#f5f5f7",
    borderRadius: 4,
    marginBottom: 4,
  };

  const itemStyle: React.CSSProperties = {
    display: "block",
    padding: "4px 8px",
    fontSize: 13,
    color: "var(--color-accent, #5b6af9)",
    cursor: "pointer",
    borderRadius: 4,
    textDecoration: "none",
  };

  const emptyStyle: React.CSSProperties = {
    padding: "4px 8px",
    fontSize: 12,
    color: "#aaa",
  };

  return (
    <div style={{ padding: 8, fontSize: 13 }}>
      <div style={sectionStyle}>
        <div style={headingStyle}>传出链接</div>
        {links && links.outgoing.length > 0 ? (
          links.outgoing.map((link) => (
            <span
              key={link.id}
              style={itemStyle}
              onClick={() => handleLinkClick(link)}
              title={link.link_url}
            >
              {link.note_title || link.link_text || link.link_url}
            </span>
          ))
        ) : (
          <div style={emptyStyle}>暂无链接</div>
        )}
      </div>

      <div style={sectionStyle}>
        <div style={headingStyle}>反向链接 (backlinks)</div>
        {links && links.incoming.length > 0 ? (
          links.incoming.map((link) => (
            <span
              key={link.id}
              style={itemStyle}
              onClick={() => handleLinkClick(link)}
              title={link.link_url}
            >
              {link.note_title || link.link_text || link.link_url}
            </span>
          ))
        ) : (
          <div style={emptyStyle}>暂无链接</div>
        )}
      </div>
    </div>
  );
}
