import { useEffect, useRef, useState } from "react";
import { api } from "../../api/commands";
import type { Tag } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { useOpenNote } from "../../hooks/useOpenNote";
import { scheduleClearActiveDraggedTagName, setActiveDraggedTagName } from "../EditorWorkspace/tagDragState";

const INSERT_TAG_EVENT = "mynote:insert-tag";
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

  useEffect(() => {
    if (!kb) return;
    api.listTags().then(setTags).catch(console.error);
  }, [kb, currentNote?.content_hash]);

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

  const openContextItem = async (item: NonNullable<typeof activeTagContext>["items"][number]) => {
    if (!activeTagContext) return;

    try {
      const requestId = beginOpenNote();
      await openNote(item.note_path, requestId);
      if (!isOpenNoteRequestCurrent(requestId)) return;
      setTagNavigationTarget({
        ...item,
        tag_name: activeTagContext.tag_name,
        revision: Date.now(),
      });
    } catch (error) {
      console.error("Failed to open tag context note:", error);
    }
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
    if (!currentNote) return;

    setIsCreatingTag(true);
    setNewTagName("");
  };

  const submitNewTag = () => {
    const tagName = newTagName.trim();
    if (!tagName) return;

    setTags((currentTags) => {
      if (currentTags.some((tag) => tag.name === tagName)) {
        return currentTags;
      }
      return [...currentTags, { id: `draft:${tagName}`, name: tagName, note_count: 1 }]
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    });

    window.dispatchEvent(new CustomEvent(INSERT_TAG_EVENT, {
      detail: { tagName, source: "panel-add" },
    }));

    setNewTagName("");
    setIsCreatingTag(false);
  };

  const cancelNewTag = () => {
    setNewTagName("");
    setIsCreatingTag(false);
  };

  return (
    <div style={{ padding: "8px 0" }}>
      {tags.length === 0 && (
        <div style={{ padding: "16px 12px", fontSize: 13, color: "#999" }}>
          暂无标签。在笔记 Front Matter 中添加 <code>tags: [标签名]</code> 或在正文中使用 #标签 语法。
        </div>
      )}
      <div data-testid="tag-panel-list">
      {tags.map((tag) => (
        <div
          key={tag.id}
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
              event.dataTransfer.setData("text/plain", `#${tag.name}`);
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
            aria-label={`标签 ${tag.name} ${tag.note_count ?? 0}`}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
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
            <span style={{ fontSize: 11, color: "#999", flexShrink: 0 }}>{tag.note_count ?? 0}</span>
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
                onClick={() => {
                  void openContextItem(item);
                }}
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
      {isCreatingTag && currentNote && (
        <div style={{ padding: "8px 12px 4px", display: "grid", gap: 8 }}>
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
      <div style={{ padding: "8px 12px 2px" }}>
        <button
          type="button"
          onClick={handleAddTag}
          disabled={!currentNote}
          aria-label="新增标签"
          style={{
            width: "100%",
            border: "1px dashed #cfd6e4",
            borderRadius: 6,
            background: currentNote ? "#f8fafc" : "#f3f4f6",
            color: currentNote ? "#516076" : "#9aa3b2",
            padding: "8px 10px",
            cursor: currentNote ? "pointer" : "not-allowed",
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
