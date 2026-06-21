import { useEffect, useRef, useState } from "react";
import { api } from "../../api/commands";
import type { Tag, TagContextItem } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { useOpenNote } from "../../hooks/useOpenNote";
import { scheduleClearActiveDraggedTagName, setActiveDraggedTagName } from "../EditorWorkspace/tagDragState";
import { useContextMenu } from "../ContextMenu/useContextMenu";

const TAG_DRAG_DEBUG_PREFIX = "[mynote:tag-drag]";
const TAG_DRAG_SOURCE_SELECTOR = "[data-tag-drag-name]";
const TAG_DRAG_THRESHOLD_PX = 4;

function logTagDrag(event: string, details: Record<string, unknown>) {
  console.info(TAG_DRAG_DEBUG_PREFIX, event, details);
}

function getDataTransferTypes(dataTransfer: DataTransfer): string[] {
  return Array.from(dataTransfer.types ?? []);
}

function getEventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Text) return target.parentElement;
  return null;
}

type InternalTagDrag = {
  tagName: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDragging: boolean;
};

export function TagPanel() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [addTagNotice, setAddTagNotice] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<InternalTagDrag | null>(null);
  const latestTagContextRequestId = useRef(0);
  const internalTagDragRef = useRef<InternalTagDrag | null>(null);
  const selectedTagIds = useAppStore((s) => s.selectedTagIds);
  const activeTagContext = useAppStore((s) => s.activeTagContext);
  const setSelectedTagIds = useAppStore((s) => s.setSelectedTagIds);
  const setActiveTagContext = useAppStore((s) => s.setActiveTagContext);
  const kb = useAppStore((s) => s.kb);
  const currentNote = useEditorStore((s) => s.currentNote);
  const isDirty = useEditorStore((s) => s.isDirty);
  const setCurrentNote = useEditorStore((s) => s.setCurrentNote);
  const setContent = useEditorStore((s) => s.setContent);
  const setTagNavigationTarget = useEditorStore((s) => s.setTagNavigationTarget);
  const { openNote, beginOpenNote, isOpenNoteRequestCurrent } = useOpenNote();
  const { openContextMenu } = useContextMenu();

  useEffect(() => {
    if (!kb) return;
    api.listTags().then(setTags).catch(console.error);
  }, [kb, currentNote?.content_hash]);

  useEffect(() => {
    if (currentNote) {
      setAddTagNotice(null);
    }
  }, [currentNote]);

  useEffect(() => {
    logTagDrag("global-source-listener-ready", { mode: "pointer+mouse" });

    const setGlobalTagDrag = (drag: InternalTagDrag | null) => {
      internalTagDragRef.current = drag;
      setDragPreview(drag?.isDragging ? drag : null);
    };

    const startGlobalTagDrag = (
      targetEvent: EventTarget | null,
      button: number,
      clientX: number,
      clientY: number,
      inputType: string,
    ) => {
      if (button !== 0) return;
      const target = getEventElement(targetEvent)?.closest<HTMLElement>(TAG_DRAG_SOURCE_SELECTOR);
      const tagName = target?.dataset.tagDragName?.trim() ?? "";
      if (!tagName) return;

      setActiveDraggedTagName(tagName);
      setGlobalTagDrag({ tagName, startX: clientX, startY: clientY, currentX: clientX, currentY: clientY, isDragging: false });
      logTagDrag("global-start", {
        tagName,
        inputType,
        clientX,
        clientY,
      });
    };

    const moveGlobalTagDrag = (clientX: number, clientY: number) => {
      const drag = internalTagDragRef.current;
      if (!drag) return;
      const distance = Math.hypot(clientX - drag.startX, clientY - drag.startY);
      if (!drag.isDragging && distance < TAG_DRAG_THRESHOLD_PX) return;
      const nextDrag = { ...drag, currentX: clientX, currentY: clientY, isDragging: true };
      setGlobalTagDrag(nextDrag);
      if (!drag.isDragging) {
        logTagDrag("global-dragging", { tagName: drag.tagName, distance });
      }
    };

    const finishGlobalTagDrag = () => {
      if (!internalTagDragRef.current) return;
      setGlobalTagDrag(null);
      scheduleClearActiveDraggedTagName();
    };

    const handlePointerDown = (event: PointerEvent) => {
      startGlobalTagDrag(event.target, event.button, event.clientX, event.clientY, `pointer:${event.pointerType}`);
    };

    const handlePointerMove = (event: PointerEvent) => {
      moveGlobalTagDrag(event.clientX, event.clientY);
    };

    const handlePointerUp = () => {
      finishGlobalTagDrag();
    };

    const handlePointerCancel = () => {
      finishGlobalTagDrag();
    };

    const handleMouseDown = (event: MouseEvent) => {
      startGlobalTagDrag(event.target, event.button, event.clientX, event.clientY, "mouse");
    };

    const handleMouseMove = (event: MouseEvent) => {
      moveGlobalTagDrag(event.clientX, event.clientY);
    };

    const handleMouseUp = () => {
      finishGlobalTagDrag();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
    };
  }, []);

  const reloadTags = () => {
    api.listTags().then(setTags).catch(console.error);
  };

  const clearTagFilter = () => {
    latestTagContextRequestId.current += 1;
    setSelectedTagIds([]);
    setActiveTagContext(null);
  };

  const loadTagContext = async (tag: Tag) => {
    const requestId = latestTagContextRequestId.current + 1;
    latestTagContextRequestId.current = requestId;

    try {
      const context = await api.getTagContext(tag.id);
      if (latestTagContextRequestId.current !== requestId) return;
      setActiveTagContext(context);
    } catch (error) {
      if (latestTagContextRequestId.current !== requestId) return;
      console.error("Failed to load tag context:", error);
    }
  };

  const toggleTag = (tag: Tag, e: React.MouseEvent) => {
    const nextSelectedTagIds = (e.ctrlKey || e.metaKey)
      ? selectedTagIds.includes(tag.id)
        ? selectedTagIds.filter((selectedId) => selectedId !== tag.id)
        : [...selectedTagIds, tag.id]
      : selectedTagIds.includes(tag.id) && selectedTagIds.length === 1
        ? []
        : [tag.id];

    setSelectedTagIds(nextSelectedTagIds);

    if (!nextSelectedTagIds.includes(tag.id)) {
      latestTagContextRequestId.current += 1;
      if (activeTagContext?.tag_id === tag.id) {
        setActiveTagContext(null);
      }
      return;
    }

    void loadTagContext(tag);
  };

  const openContextItemNote = async (item: TagContextItem) => {
    try {
      const requestId = beginOpenNote();
      await openNote(item.note_path, requestId);
      return requestId;
    } catch (error) {
      console.error("Failed to open tag context note:", error);
      return null;
    }
  };

  const openContextItem = async (item: TagContextItem) => {
    if (!activeTagContext) return;

    const requestId = await openContextItemNote(item);
    if (!requestId) return;
    if (!isOpenNoteRequestCurrent(requestId)) return;
    setTagNavigationTarget({
      ...item,
      tag_name: activeTagContext.tag_name,
      revision: Date.now(),
    });
  };

  const handleTagBlankContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = getEventElement(event.target);
    if (target?.closest("[data-tag-panel-tag-row='true'], [data-tag-context-item='true']")) {
      return;
    }

    event.preventDefault();

    openContextMenu({
      position: { x: event.clientX, y: event.clientY },
      payload: {
        type: "tagBlank",
        selectedTagIds,
        handlers: {
          refresh: reloadTags,
          clearFilter: clearTagFilter,
        },
      },
    });
  };

  const handleDeleteTag = async (tag: Tag) => {
    const confirmed = window.confirm(`删除标签“${tag.name}”会从所有笔记中移除，确认继续？`);
    if (!confirmed) return;

    try {
      await api.deleteTag(tag.id);
      setSelectedTagIds(selectedTagIds.filter((selectedId) => selectedId !== tag.id));
      if (currentNote && !isDirty && typeof api.getNoteByPath === "function") {
        const detail = await api.getNoteByPath(currentNote.path);
        setCurrentNote(detail.note);
        setContent(detail.content);
      }
      reloadTags();
    } catch (error) {
      console.error("Failed to delete tag:", error);
    }
  };

  const handleAddTag = () => {
    if (!currentNote) {
      setIsCreatingTag(false);
      setAddTagNotice("请先从左侧文件树打开或新建一篇笔记，然后再为它添加标签。");
      return;
    }

    setAddTagNotice(null);
    setIsCreatingTag(true);
    setNewTagName("");
  };

  const submitNewTag = async () => {
    const tagName = newTagName.trim();
    if (!tagName || !currentNote) return;

    try {
      const detail = await api.addTagToNote(currentNote.id, tagName);
      setCurrentNote(detail.note);
      setContent(detail.content);
      setTags((currentTags) => {
        if (currentTags.some((tag) => tag.name === tagName)) {
          return currentTags;
        }
        return [...currentTags, { id: `draft:${tagName}`, name: tagName, note_count: 1 }]
          .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
      });
    } catch (error) {
      console.error("Failed to add tag to note:", error);
      return;
    }

    setNewTagName("");
    setIsCreatingTag(false);
    setAddTagNotice(null);
  };

  const cancelNewTag = () => {
    setNewTagName("");
    setIsCreatingTag(false);
  };

  const handleTagContextMenu = (tag: Tag, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();

    openContextMenu({
      position: { x: event.clientX, y: event.clientY },
      payload: {
        type: "tag",
        tagId: tag.id,
        tagName: tag.name,
        handlers: {
          delete: () => handleDeleteTag(tag),
        },
      },
    });
  };

  const handleTagContextItemContextMenu = (item: TagContextItem, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();

    openContextMenu({
      position: { x: event.clientX, y: event.clientY },
      payload: {
        type: "tagContextItem",
        notePath: item.note_path,
        noteTitle: item.note_title,
        lineStart: item.line_start,
        lineEnd: item.line_end,
        occurrenceOrder: item.occurrence_order,
        handlers: {
          open: async () => {
            await openContextItemNote(item);
          },
          locate: () => openContextItem(item),
        },
      },
    });
  };

  return (
    <div
      data-testid="tag-panel-surface"
      onContextMenu={handleTagBlankContextMenu}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
      }}
    >
      <div
        data-testid="tag-panel-scroll-region"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "8px 0 4px",
        }}
      >
        {tags.length === 0 && (
          <div style={{ padding: "16px 12px", fontSize: 13, color: "#999" }}>
            暂无标签。在笔记 Front Matter 中添加 <code>tags: [标签名]</code>，正文中的 <code>[[#标签名]]</code> 仅作为标签引用展示，不会自动建立标签归属。
          </div>
        )}
        <div data-testid="tag-panel-list">
        {tags.map((tag) => (
          <div
            key={tag.id}
            data-tag-panel-tag-row="true"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 12px",
              background: selectedTagIds.includes(tag.id) ? "#e8f0fe" : "transparent",
              borderRadius: 4,
              margin: "1px 4px",
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={(e) => toggleTag(tag, e)}
              draggable={false}
              data-tag-drag-name={tag.name}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                setActiveDraggedTagName(tag.name);
                logTagDrag("pointer-start", {
                  tagName: tag.name,
                  pointerType: event.pointerType,
                  clientX: event.clientX,
                  clientY: event.clientY,
                });
              }}
              onPointerUp={() => {
                scheduleClearActiveDraggedTagName();
              }}
              onPointerCancel={() => {
                scheduleClearActiveDraggedTagName();
              }}
              onDragStart={(event) => {
                setActiveDraggedTagName(tag.name);
                event.dataTransfer.setData("application/x-mynote-tag", tag.name);
                event.dataTransfer.setData("text/plain", `[[#${tag.name}]]`);
                event.dataTransfer.effectAllowed = "copy";
                logTagDrag("dragstart", {
                  tagName: tag.name,
                  dataTypes: getDataTransferTypes(event.dataTransfer),
                  effectAllowed: event.dataTransfer.effectAllowed,
                });
              }}
              onDragEnd={() => {
                logTagDrag("dragend", { tagName: tag.name });
                scheduleClearActiveDraggedTagName();
              }}
              onContextMenu={(event) => handleTagContextMenu(tag, event)}
              aria-label={`标签 ${tag.name} ${tag.note_count ?? 0}`}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 13, color: selectedTagIds.includes(tag.id) ? "#1a73e8" : "#333" }}>
                # {tag.name}
              </span>
            </button>
            {selectedTagIds.includes(tag.id) && (
              <button
                type="button"
                aria-label={`删除标签 ${tag.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDeleteTag(tag);
                }}
                style={{
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  borderRadius: 999,
                  border: "1px solid #c9d2e3",
                  background: "#fff",
                  color: "#6b7280",
                  cursor: "pointer",
                  lineHeight: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                }}
              >
                ×
              </button>
            )}
            <span style={{ fontSize: 11, color: "#999", flexShrink: 0 }}>{tag.note_count ?? 0}</span>
          </div>
        ))}
        </div>
        {activeTagContext && selectedTagIds.includes(activeTagContext.tag_id) && (
          <div style={{ padding: "12px", display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#667085", fontWeight: 600 }}>
            {activeTagContext.tag_name} · {activeTagContext.total_notes} 篇
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {activeTagContext.items.slice(0, 5).map((item) => (
              <button
                key={`${item.note_id}:${item.line_start}:${item.line_end}:${item.occurrence_order}`}
                type="button"
                aria-label={`打开标签上下文笔记 ${item.note_title}`}
                data-tag-context-item="true"
                onClick={() => {
                  void openContextItem(item);
                }}
                onContextMenu={(event) => handleTagContextItemContextMenu(item, event)}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  background: "#fff",
                  padding: "8px 10px",
                  display: "grid",
                  gap: 4,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 13, color: "#1f2937", fontWeight: 500 }}>{item.note_title}</span>
                <span style={{ fontSize: 11, color: "#98a2b3" }}>{item.note_path}</span>
                {item.heading_context && (
                  <span style={{ fontSize: 11, color: "#667085" }}>{item.heading_context}</span>
                )}
                <span style={{ fontSize: 12, color: "#475467" }}>{item.context_snippet}</span>
              </button>
            ))}
            {activeTagContext.has_more && (
              <div style={{ fontSize: 12, color: "#98a2b3", padding: "2px 2px 0" }}>
                ... 还有更多
              </div>
            )}
          </div>
          </div>
        )}
      </div>
      {isCreatingTag && currentNote && (
        <div style={{ padding: "8px 12px 4px", display: "grid", gap: 8, flexShrink: 0 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#667085" }}>
            <span>新标签名称</span>
            <input
              aria-label="新标签名称"
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitNewTag();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelNewTag();
                }
              }}
              autoFocus
              placeholder="例如：法律适用"
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: "1px solid #cfd6e4",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: 13,
                outline: "none",
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              aria-label="添加标签"
              onClick={submitNewTag}
              style={{
                flex: 1,
                border: "1px solid #cfd6e4",
                borderRadius: 6,
                background: "#eef4ff",
                color: "#2d5bce",
                padding: "8px 10px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              添加标签
            </button>
            <button
              type="button"
              aria-label="取消新增标签"
              onClick={cancelNewTag}
              style={{
                border: "1px solid #d7dce5",
                borderRadius: 6,
                background: "#fff",
                color: "#667085",
                padding: "8px 10px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {addTagNotice && (
        <div style={{ padding: "4px 12px 0", fontSize: 12, color: "#667085", flexShrink: 0 }}>
          {addTagNotice}
        </div>
      )}
      <div style={{ padding: "8px 12px 2px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleAddTag}
          aria-label="新增标签"
          style={{
            width: "100%",
            border: "1px dashed #cfd6e4",
            borderRadius: 6,
            background: "#f8fafc",
            color: "#516076",
            padding: "8px 10px",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          + 新增标签
        </button>
      </div>
      {dragPreview && (
        <div
          aria-hidden="true"
          data-testid="tag-drag-preview"
          style={{
            position: "fixed",
            left: dragPreview.currentX - 12,
            top: dragPreview.currentY - 12,
            zIndex: 9999,
            pointerEvents: "none",
            maxWidth: 190,
            minHeight: 30,
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid #93c5fd",
            background: "#ffffff",
            color: "#1f2937",
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(147, 197, 253, 0.25)",
            transform: "translate3d(0, 0, 0) rotate(-1deg)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background: "#dbeafe",
              color: "#2563eb",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "0 0 auto",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            #
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            # {dragPreview.tagName}
          </span>
        </div>
      )}
    </div>
  );
}
