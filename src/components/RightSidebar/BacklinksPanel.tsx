import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { NoteLinks } from "../../types";
import { api } from "../../api/commands";
import { useOpenNote } from "../../hooks/useOpenNote";
import { useAppStore } from "../../store/useAppStore";
import type { PreviewLinkKind } from "../ContextMenu/contextMenuTypes";
import { useContextMenu } from "../ContextMenu/useContextMenu";
import { ManualRelationsPanel } from "./ManualRelationsPanel";

interface Props {
  noteId: string | null;
}

function getEventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Text) return target.parentElement;
  return null;
}

function writeClipboardText(text: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return Promise.resolve();
  }

  return navigator.clipboard.writeText(text);
}

function normalizeLinkType(linkType: string): PreviewLinkKind {
  if (linkType === "external") {
    return "external";
  }

  if (linkType === "wiki") {
    return "wiki";
  }

  return "internal";
}

export function BacklinksPanel({ noteId }: Props) {
  const [links, setLinks] = useState<NoteLinks | null>(null);
  const [loading, setLoading] = useState(false);
  const { openNote } = useOpenNote();
  const setRightSidebarVisible = useAppStore((state) => state.setRightSidebarVisible);
  const { openContextMenu } = useContextMenu();

  const reloadLinks = async (targetNoteId: string) => {
    setLoading(true);

    try {
      const data = await api.getNoteLinks(targetNoteId);
      setLinks(data);
    } catch {
      setLinks(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!noteId) {
      setLinks(null);
      return;
    }

    let isMounted = true;
    setLinks(null);
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
        await openNote(link.note_path);
      }
    } catch (e) {
      console.error("Failed to open link:", e);
    }
  };

  const handleLinksBlankContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = getEventElement(event.target);
    if (target?.closest("[data-link-item='true']")) {
      return;
    }

    event.preventDefault();

    openContextMenu({
      position: { x: event.clientX, y: event.clientY },
      payload: {
        type: "linksBlank",
        handlers: {
          refresh: noteId ? () => reloadLinks(noteId) : undefined,
          showSidebar: () => setRightSidebarVisible(true),
        },
      },
    });
  };

  const handleLinkContextMenu = (
    link: NoteLinks["outgoing"][number],
    event: React.MouseEvent<HTMLElement>,
  ) => {
    event.preventDefault();

    openContextMenu({
      position: { x: event.clientX, y: event.clientY },
      payload: {
        type: "linkItem",
        linkId: link.id,
        linkType: normalizeLinkType(link.link_type),
        href: link.link_url,
        notePath: link.note_path || undefined,
        handlers: {
          open: () => handleLinkClick(link),
          openTargetNote: link.note_path ? () => openNote(link.note_path) : undefined,
          copy: () => writeClipboardText(link.link_url),
        },
      },
    });
  };

  if (!noteId) {
    return (
      <div style={{ padding: "12px 8px", fontSize: 13, color: "#999" }}>
        选择笔记以查看链接
      </div>
    );
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

  const renderAutoLinks = (items: NoteLinks["outgoing"]) => {
    if (loading) {
      return <div style={emptyStyle}>加载中...</div>;
    }

    if (items.length === 0) {
      return <div style={emptyStyle}>暂无链接</div>;
    }

    return items.map((link) => (
      <span
        key={link.id}
        data-link-item="true"
        style={itemStyle}
        onClick={() => handleLinkClick(link)}
        onContextMenu={(event) => handleLinkContextMenu(link, event)}
        title={link.link_url}
      >
        {link.note_title || link.link_text || link.link_url}
      </span>
    ));
  };

  return (
    <div style={{ padding: 8, fontSize: 13 }}>
      <div data-testid="backlinks-links-surface" onContextMenu={handleLinksBlankContextMenu}>
        <div style={sectionStyle}>
          <div style={headingStyle}>传出链接</div>
          {renderAutoLinks(links?.outgoing ?? [])}
        </div>

        <div style={sectionStyle}>
          <div style={headingStyle}>反向链接 (backlinks)</div>
          {renderAutoLinks(links?.incoming ?? [])}
        </div>
      </div>

      <ManualRelationsPanel noteId={noteId} />
    </div>
  );
}
