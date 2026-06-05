import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { NoteLinks } from "../../types";
import { api } from "../../api/commands";
import { useOpenNote } from "../../hooks/useOpenNote";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
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

function formatPathTailLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const [pathPart, suffix = ""] = trimmed.split("#", 2);
  const normalizedPath = pathPart.replace(/\\/g, "/");
  const segments = normalizedPath.split("/").filter(Boolean);

  if (segments.length === 0) {
    return trimmed;
  }

  const tailSegments = segments.length <= 2 ? segments.slice(-1) : segments.slice(-2);
  const tail = tailSegments.join("/");
  return suffix ? `${tail}#${suffix}` : tail;
}

function getLinkLabel(link: NoteLinks["outgoing"][number]) {
  const noteTitle = link.note_title.trim();
  if (noteTitle) {
    return noteTitle;
  }

  const linkText = link.link_text.trim();
  const isLinkTextPathLike = /[\\/]/.test(linkText) || /^[A-Za-z]:/.test(linkText);
  if (linkText && linkText !== link.link_url.trim()) {
    return isLinkTextPathLike ? formatPathTailLabel(linkText) : linkText;
  }

  const isPathLike = /[\\/]/.test(link.link_url) || /^[A-Za-z]:/.test(link.link_url);
  if (isPathLike) {
    return formatPathTailLabel(link.link_url);
  }

  return linkText || link.link_url;
}

function getLinkMeta(link: NoteLinks["outgoing"][number], label: string) {
  const notePath = link.note_path.trim();
  if (notePath && notePath !== label) {
    return /[\\/]/.test(notePath) || /^[A-Za-z]:/.test(notePath)
      ? formatPathTailLabel(notePath)
      : notePath;
  }

  const linkUrl = link.link_url.trim();
  if (linkUrl && linkUrl !== label) {
    return /[\\/]/.test(linkUrl) || /^[A-Za-z]:/.test(linkUrl)
      ? formatPathTailLabel(linkUrl)
      : linkUrl;
  }

  return null;
}

export function BacklinksPanel({ noteId }: Props) {
  const [links, setLinks] = useState<NoteLinks | null>(null);
  const [loading, setLoading] = useState(false);
  const [outgoingExpanded, setOutgoingExpanded] = useState(true);
  const [incomingExpanded, setIncomingExpanded] = useState(false);
  const activeNoteIdRef = useRef<string | null>(noteId);
  const reloadRequestRef = useRef(0);
  const { openNote } = useOpenNote();
  const setRightSidebarVisible = useAppStore((state) => state.setRightSidebarVisible);
  const setSearchNavigationTarget = useEditorStore((state) => state.setSearchNavigationTarget);
  const { openContextMenu } = useContextMenu();

  activeNoteIdRef.current = noteId;

  const reloadLinks = async (targetNoteId: string) => {
    const requestId = ++reloadRequestRef.current;
    setLoading(true);

    try {
      const data = await api.getNoteLinks(targetNoteId);
      if (reloadRequestRef.current !== requestId || activeNoteIdRef.current !== targetNoteId) {
        return;
      }
      setLinks(data);
    } catch {
      if (reloadRequestRef.current !== requestId || activeNoteIdRef.current !== targetNoteId) {
        return;
      }
      setLinks(null);
    } finally {
      if (reloadRequestRef.current !== requestId || activeNoteIdRef.current !== targetNoteId) {
        return;
      }
      setLoading(false);
    }
  };

  useEffect(() => {
    setOutgoingExpanded(true);
    setIncomingExpanded(false);

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
    const sourcePath = link.source_note_path.trim();
    const targetPath = link.note_path.trim();

    try {
      if (link.link_type === "external") {
        await openUrl(link.link_url);
        return;
      }

      if (sourcePath) {
        await openNote(sourcePath);
        if (link.source_line_start && link.source_line_end) {
          setSearchNavigationTarget({
            note_id: link.source_note_id,
            note_path: sourcePath,
            note_title: link.source_note_title || link.link_text || link.link_url,
            line_start: link.source_line_start,
            line_end: link.source_line_end,
            occurrence_order: 1,
            match_text: link.link_text || link.note_title || link.target_anchor?.trim() || "",
            source: "body",
            context_snippet: link.link_text || link.note_title || link.link_url,
            revision: Date.now(),
          });
        }
        return;
      }

      if (targetPath) {
        await openNote(targetPath);
        if (link.target_line_start && link.target_line_end) {
          setSearchNavigationTarget({
            note_id: link.note_id,
            note_path: targetPath,
            note_title: link.note_title || link.link_text || link.link_url,
            line_start: link.target_line_start,
            line_end: link.target_line_end,
            occurrence_order: 1,
            match_text: link.target_anchor?.trim() || link.link_text || link.note_title || "",
            source: "body",
            context_snippet: link.target_anchor?.trim() || link.link_text || link.note_title || link.link_url,
            revision: Date.now(),
          });
        }
      }
    } catch (e) {
      console.error("Failed to open link:", e);
    }
  };

  const handleOpenLinkTarget = async (link: NoteLinks["outgoing"][number]) => {
    try {
      if (link.link_type === "external") {
        await openUrl(link.link_url);
        return;
      }

      if (!link.note_path.trim()) {
        return;
      }

      await openNote(link.note_path);
      if (link.target_line_start && link.target_line_end) {
        setSearchNavigationTarget({
          note_id: link.note_id,
          note_path: link.note_path,
          note_title: link.note_title || link.link_text || link.link_url,
          line_start: link.target_line_start,
          line_end: link.target_line_end,
          occurrence_order: 1,
          match_text: link.target_anchor?.trim() || link.link_text || link.note_title || "",
          source: "body",
          context_snippet: link.target_anchor?.trim() || link.link_text || link.note_title || link.link_url,
          revision: Date.now(),
        });
      }
    } catch (e) {
      console.error("Failed to open link target:", e);
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
        notePath: link.note_path && link.note_path !== link.source_note_path ? link.note_path : undefined,
        handlers: {
          open: () => handleLinkClick(link),
          openTargetNote: link.note_path && link.note_path !== link.source_note_path
            ? () => handleOpenLinkTarget(link)
            : undefined,
          copy: () => writeClipboardText(link.link_url),
        },
      },
    });
  };

  if (!noteId) {
    return (
      <div style={{ padding: "12px 8px", fontSize: 13, color: "#999" }}>
        选择笔记以查看关联
      </div>
    );
  }

  const sectionStyle: React.CSSProperties = {
    marginBottom: 12,
  };

  const flexibleSectionStyle: React.CSSProperties = {
    ...sectionStyle,
    flex: "1 1 0%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  };

  const bottomSectionStyle: React.CSSProperties = {
    ...sectionStyle,
    marginTop: "auto",
    display: "flex",
    flexDirection: "column",
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

  const sectionToggleStyle = (expanded: boolean): React.CSSProperties => ({
    ...headingStyle,
    width: "100%",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    textAlign: "left",
    background: expanded ? "#eef3ff" : "#f5f5f7",
  });

  const sectionToggleChevronStyle: React.CSSProperties = {
    fontSize: 11,
    color: "#7b8190",
    marginLeft: 8,
    flexShrink: 0,
  };

  const itemStyle: React.CSSProperties = {
    display: "block",
    padding: "8px 10px",
    width: "100%",
    margin: 0,
    boxSizing: "border-box",
    minWidth: 0,
    background: "#ffffff",
    border: "1px solid #e6eaf2",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
    color: "#1f2937",
    cursor: "pointer",
    borderRadius: 8,
    textDecoration: "none",
    textAlign: "left",
  };

  const itemTitleStyle: React.CSSProperties = {
    fontSize: 14,
    lineHeight: 1.45,
    fontWeight: 600,
    color: "#2450c5",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const itemMetaStyle: React.CSSProperties = {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 1.35,
    color: "#7b8190",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const getListStyle = (fillAvailableHeight: boolean): React.CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 2,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    ...(fillAvailableHeight
      ? {
        flex: "1 1 auto",
        maxHeight: "none",
      }
      : {
        maxHeight: 188,
      }),
  });

  const emptyStyle: React.CSSProperties = {
    padding: "4px 8px",
    fontSize: 12,
    color: "#aaa",
  };

  const renderAutoLinks = (items: NoteLinks["outgoing"], fillAvailableHeight = false) => {
    const listStyle = getListStyle(fillAvailableHeight);

    if (loading) {
      return (
        <div style={listStyle}>
          <div style={emptyStyle}>加载中...</div>
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div style={listStyle}>
          <div style={emptyStyle}>暂无链接</div>
        </div>
      );
    }

    return (
      <div style={listStyle}>
        {items.map((link) => (
          (() => {
            const label = getLinkLabel(link);
            const meta = getLinkMeta(link, label);

            return (
              <div
                key={link.id}
                role="button"
                aria-label={label}
                tabIndex={0}
                data-link-item="true"
                style={itemStyle}
                onClick={() => handleLinkClick(link)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void handleLinkClick(link);
                  }
                }}
                onContextMenu={(event) => handleLinkContextMenu(link, event)}
                title={link.link_url}
              >
                <div style={itemTitleStyle}>{label}</div>
                {meta ? <div style={itemMetaStyle}>{meta}</div> : null}
              </div>
            );
          })()
        ))}
      </div>
    );
  };

  const hasIncomingLinks = (links?.incoming?.length ?? 0) > 0;

  return (
    <div style={{ padding: 8, fontSize: 13, display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        data-testid="backlinks-links-surface"
        onContextMenu={handleLinksBlankContextMenu}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <div style={flexibleSectionStyle}>
          <button
            type="button"
            aria-expanded={outgoingExpanded ? "true" : "false"}
            onClick={() => setOutgoingExpanded((current) => !current)}
            style={sectionToggleStyle(outgoingExpanded)}
          >
            <span>提及了谁</span>
            <span style={sectionToggleChevronStyle}>{outgoingExpanded ? "收起" : "展开"}</span>
          </button>
          {outgoingExpanded ? renderAutoLinks(links?.outgoing ?? [], !incomingExpanded) : null}
        </div>

        <div style={hasIncomingLinks ? sectionStyle : bottomSectionStyle}>
          <button
            type="button"
            aria-expanded={incomingExpanded ? "true" : "false"}
            onClick={() => setIncomingExpanded((current) => !current)}
            style={sectionToggleStyle(incomingExpanded)}
          >
            <span>谁提及我</span>
            <span style={sectionToggleChevronStyle}>{incomingExpanded ? "收起" : "展开"}</span>
          </button>
          {incomingExpanded ? renderAutoLinks(links?.incoming ?? [], !outgoingExpanded) : null}
        </div>
      </div>

      <ManualRelationsPanel noteId={noteId} />
    </div>
  );
}
