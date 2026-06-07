import { useEffect, useRef, useState } from "react";
import { api } from "../../api/commands";
import { useEditorStore } from "../../store/useEditorStore";
import type { NoteOutlineItem } from "../../types";

type LoadState = "idle" | "loading" | "ready" | "error";

const panelStyle: React.CSSProperties = {
  padding: 12,
  color: "#475467",
  fontSize: 13,
};

const emptyStyle: React.CSSProperties = {
  color: "#98a2b3",
  lineHeight: 1.5,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};

function flattenHasItems(items: NoteOutlineItem[]): boolean {
  return items.length > 0;
}

export function OutlinePanel() {
  const currentNote = useEditorStore((s) => s.currentNote);
  const content = useEditorStore((s) => s.content);
  const searchNavigationTarget = useEditorStore((s) => s.searchNavigationTarget);
  const setSearchNavigationTarget = useEditorStore((s) => s.setSearchNavigationTarget);

  const [outline, setOutline] = useState<NoteOutlineItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");

  const skipNextContentRefreshRef = useRef(false);
  const requestTokenRef = useRef(0);
  const activeNotePathRef = useRef<string | null>(currentNote?.path ?? null);

  activeNotePathRef.current = currentNote?.path ?? null;

  useEffect(() => {
    if (!currentNote) {
      skipNextContentRefreshRef.current = false;
      setOutline([]);
      setLoadState("idle");
      return;
    }

    skipNextContentRefreshRef.current = true;
    setOutline([]);
    setLoadState("loading");
    const notePath = currentNote.path;
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;

    void api.getNoteOutline(notePath)
      .then((items) => {
        if (requestTokenRef.current !== requestToken || activeNotePathRef.current !== notePath) {
          return;
        }
        setOutline(items);
        setLoadState("ready");
      })
      .catch(() => {
        if (requestTokenRef.current !== requestToken || activeNotePathRef.current !== notePath) {
          return;
        }
        setOutline([]);
        setLoadState("error");
      });
  }, [currentNote]);

  useEffect(() => {
    if (!currentNote) {
      return;
    }

    if (skipNextContentRefreshRef.current) {
      skipNextContentRefreshRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      setLoadState("loading");
      const notePath = currentNote.path;
      const requestToken = requestTokenRef.current + 1;
      requestTokenRef.current = requestToken;

      void api.getNoteOutline(notePath)
        .then((items) => {
          if (requestTokenRef.current !== requestToken || activeNotePathRef.current !== notePath) {
            return;
          }
          setOutline(items);
          setLoadState("ready");
        })
        .catch(() => {
          if (requestTokenRef.current !== requestToken || activeNotePathRef.current !== notePath) {
            return;
          }
          setOutline([]);
          setLoadState("error");
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [content, currentNote]);

  if (!currentNote) {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>打开笔记后显示大纲</div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>大纲加载失败</div>
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>大纲加载中...</div>
      </div>
    );
  }

  if (loadState === "ready" && !flattenHasItems(outline)) {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>当前笔记暂无可用标题</div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <OutlineTree
        items={outline}
        activeItemId={resolveActiveOutlineItemId(outline, currentNote.path, searchNavigationTarget)}
        onSelect={(item) => {
          setSearchNavigationTarget({
            note_id: currentNote.id,
            note_path: currentNote.path,
            note_title: currentNote.title,
            line_start: item.lineStart,
            line_end: item.lineEnd,
            occurrence_order: 1,
            match_text: item.text,
            context_snippet: item.text,
            source: "body",
            revision: Date.now(),
          });
        }}
      />
    </div>
  );
}

function OutlineTree({
  items,
  activeItemId,
  onSelect,
}: {
  items: NoteOutlineItem[];
  activeItemId: string | null;
  onSelect: (item: NoteOutlineItem) => void;
}) {
  return (
    <ul style={listStyle}>
      {items.map((item) => (
        <li key={item.id}>
          {(() => {
            const isActive = item.id === activeItemId;

            return (
          <button
            type="button"
            aria-pressed={isActive}
            title={item.text}
            onClick={() => onSelect(item)}
            style={{
              width: "100%",
              display: "block",
              textAlign: "left",
              background: isActive ? "#e0f2fe" : "none",
              border: "none",
              borderRadius: 6,
              padding: "6px 8px",
              paddingLeft: 8 + (item.level - 1) * 14,
              color: isActive ? "#0f172a" : "#344054",
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.text}
          </button>
            );
          })()}
          {item.children.length > 0 ? (
            <OutlineTree items={item.children} activeItemId={activeItemId} onSelect={onSelect} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function resolveActiveOutlineItemId(
  items: NoteOutlineItem[],
  notePath: string,
  searchNavigationTarget: ReturnType<typeof useEditorStore.getState>["searchNavigationTarget"],
): string | null {
  if (!searchNavigationTarget || searchNavigationTarget.note_path !== notePath) {
    return null;
  }

  for (const item of items) {
    const childMatch = resolveActiveOutlineItemId(item.children, notePath, searchNavigationTarget);
    if (childMatch) {
      return childMatch;
    }

    if (isNavigationTargetWithinOutlineItem(item, searchNavigationTarget)) {
      return item.id;
    }
  }

  return null;
}

function isNavigationTargetWithinOutlineItem(
  item: NoteOutlineItem,
  searchNavigationTarget: NonNullable<ReturnType<typeof useEditorStore.getState>["searchNavigationTarget"]>,
): boolean {
  return searchNavigationTarget.line_start >= item.lineStart && searchNavigationTarget.line_start <= item.lineEnd;
}