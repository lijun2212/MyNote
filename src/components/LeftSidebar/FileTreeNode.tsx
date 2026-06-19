import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { NoteTreeNode } from "../../types";
import { getDropDirectoryPath } from "./fileTreeDrag";

const ACTION_HIGHLIGHT_BACKGROUND = "#eff6ff";
const ACTION_HIGHLIGHT_BORDER = "#93c5fd";
const ACTION_HIGHLIGHT_TEXT = "#0969da";
const LARGE_DIRECTORY_ANIMATION_THRESHOLD = 40;

const NOTEBOOK_COLOR_STYLES: Record<string, { background: string; color: string }> = {
  blue: { background: "#dbeafe", color: "#1d4ed8" },
  cyan: { background: "#cffafe", color: "#0f766e" },
  green: { background: "#dcfce7", color: "#15803d" },
  orange: { background: "#fed7aa", color: "#c2410c" },
  red: { background: "#fee2e2", color: "#b91c1c" },
  pink: { background: "#fce7f3", color: "#be185d" },
  brown: { background: "#ede0d4", color: "#7c2d12" },
  gray: { background: "#e5e7eb", color: "#4b5563" },
};

function isTopLevelNotebookPath(path: string) {
  const parts = path.split("/");
  return parts.length === 2 && parts[0] === "notes" && parts[1] !== "__unarchived__";
}

function getDirectoryColor(node: NoteTreeNode, inheritedDirectoryColor: string) {
  if (!node.is_dir) {
    return inheritedDirectoryColor;
  }

  if (isTopLevelNotebookPath(node.path)) {
    return node.notebook_color ?? "gray";
  }

  return inheritedDirectoryColor;
}

function countNotes(node: NoteTreeNode): number {
  if (!node.is_dir) {
    return 1;
  }

  return node.children.reduce((total, child) => total + countNotes(child), 0);
}

function DeleteNotebookIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      style={{
        width: 10,
        height: 10,
        display: "block",
        stroke: "currentColor",
        strokeWidth: 1.8,
        fill: "none",
        strokeLinecap: "round",
      }}
    >
      <path d="M4.5 4.5 11.5 11.5" />
      <path d="M11.5 4.5 4.5 11.5" />
    </svg>
  );
}

interface Props {
  node: NoteTreeNode;
  depth?: number;
  getDefaultExpanded?: (node: NoteTreeNode, depth: number) => boolean;
  onDirectoryExpandedChange?: (path: string, expanded: boolean) => void;
  inheritedDirectoryColor?: string;
  onSelectFile: (node: NoteTreeNode) => void;
  selectedPath: string | null;
  dragOverPath: string | null;
  onStartDragFile: (node: NoteTreeNode, event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnterDirectory: (node: NoteTreeNode, event: React.DragEvent<HTMLElement>) => void;
  onDragLeaveDirectory: (node: NoteTreeNode) => void;
  onDropOnDirectory: (node: NoteTreeNode, event: React.DragEvent<HTMLElement>) => void;
  onStartPointerDragFile: (node: NoteTreeNode, event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerEnterDirectory: (node: NoteTreeNode) => void;
  onPointerLeaveDirectory: (node: NoteTreeNode) => void;
  onPointerUpOnDirectory: (node: NoteTreeNode, event: React.PointerEvent<HTMLElement>) => void;
  onContextMenu?: (node: NoteTreeNode, event: React.MouseEvent<HTMLElement>) => void;
  isNotebook?: boolean;
  isRenamingNotebook?: boolean;
  isPickingNotebookColor?: boolean;
  isConfirmingNotebookDelete?: boolean;
  notebookError?: ReactNode;
  notebookColorOptions?: ReactNode;
  notebookDeleteConfirmation?: ReactNode;
  onBeginNotebookRename?: () => void;
  onNotebookRenameChange?: (value: string) => void;
  onNotebookRenameSubmit?: () => void;
  onNotebookRenameCancel?: () => void;
  renameValue?: string;
  onNotebookColorTrigger?: () => void;
  onMoveNotebookUp?: () => void;
  onMoveNotebookDown?: () => void;
  onDeleteNotebook?: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
  renamingNotePath?: string | null;
  noteRenameDrafts?: Record<string, string>;
  noteErrors?: Record<string, string | null>;
  onBeginNoteRename?: (node: NoteTreeNode) => void;
  onNoteRenameChange?: (path: string, value: string) => void;
  onNoteRenameSubmit?: (node: NoteTreeNode) => void;
  onNoteRenameCancel?: (path: string) => void;
}

export function FileTreeNode({
  node,
  depth = 0,
  getDefaultExpanded,
  onDirectoryExpandedChange,
  inheritedDirectoryColor = "gray",
  onSelectFile,
  selectedPath,
  dragOverPath,
  onStartDragFile,
  onDragEnterDirectory,
  onDragLeaveDirectory,
  onDropOnDirectory,
  onStartPointerDragFile,
  onPointerEnterDirectory,
  onPointerLeaveDirectory,
  onPointerUpOnDirectory,
  onContextMenu,
  isNotebook = false,
  isRenamingNotebook = false,
  isPickingNotebookColor = false,
  isConfirmingNotebookDelete = false,
  notebookError,
  notebookColorOptions,
  notebookDeleteConfirmation,
  onBeginNotebookRename,
  onNotebookRenameChange,
  onNotebookRenameSubmit,
  onNotebookRenameCancel,
  renameValue = "",
  onNotebookColorTrigger,
  onMoveNotebookUp,
  onMoveNotebookDown,
  onDeleteNotebook,
  disableMoveUp = false,
  disableMoveDown = false,
  renamingNotePath = null,
  noteRenameDrafts,
  noteErrors,
  onBeginNoteRename,
  onNoteRenameChange,
  onNoteRenameSubmit,
  onNoteRenameCancel,
}: Props) {
  const [expanded, setExpanded] = useState(() => getDefaultExpanded?.(node, depth) ?? true);
  const [shouldRenderChildren, setShouldRenderChildren] = useState(true);
  const [contentHeight, setContentHeight] = useState(0);
  const [isNotebookRowHovered, setIsNotebookRowHovered] = useState(false);
  const [hoveredNotebookAction, setHoveredNotebookAction] = useState<"move-up" | "move-down" | "delete" | null>(null);
  const [isToggleFocusVisible, setIsToggleFocusVisible] = useState(false);
  const [isTitleFocusVisible, setIsTitleFocusVisible] = useState(false);
  const [focusVisibleAction, setFocusVisibleAction] = useState<"color" | "move-up" | "move-down" | "delete" | null>(null);
  const isSelected = selectedPath === node.path;
  const indent = depth * 14 + 8;
  const dropDirectoryPath = node.is_dir ? getDropDirectoryPath(node) : null;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const noteRenameInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameSubmitRef = useRef(false);
  const directoryColor = getDirectoryColor(node, inheritedDirectoryColor);
  const directoryPalette = NOTEBOOK_COLOR_STYLES[directoryColor] ?? NOTEBOOK_COLOR_STYLES.gray;
  const noteCount = countNotes(node);
  const shouldDisableHeightAnimation = node.is_dir && noteCount > LARGE_DIRECTORY_ANIMATION_THRESHOLD;
  const isExpandedState = expanded && dragOverPath !== node.path;
  const directoryBackground = dragOverPath === node.path
    ? "#dbeafe"
    : isNotebook
      ? "transparent"
      : isExpandedState
        ? directoryPalette.background
        : "transparent";
  const directoryTextColor = dragOverPath === node.path
    ? "#1d4ed8"
    : isNotebook
      ? "#555"
      : isExpandedState
        ? directoryPalette.color
        : "#555";
  const directorySurfaceBoxShadow = dragOverPath === node.path
    ? "none"
    : isNotebook
      ? "none"
      : isExpandedState
        ? `inset 0 0 0 1px ${directoryPalette.background}`
        : "none";
  const directoryCountBackground = isNotebook
    ? "#f8fafc"
    : isExpandedState
      ? "rgba(255,255,255,0.72)"
      : directoryPalette.background;
  const directoryCountColor = isNotebook ? "#667085" : directoryPalette.color;
  const showNotebookSlots = isNotebook && (isPickingNotebookColor || isConfirmingNotebookDelete || Boolean(notebookError));
  const areNotebookActionsHighlighted =
    isNotebookRowHovered || isRenamingNotebook || isPickingNotebookColor || isConfirmingNotebookDelete;
  const areNotebookActionsVisible =
    areNotebookActionsHighlighted ||
    isToggleFocusVisible ||
    isTitleFocusVisible ||
    focusVisibleAction !== null;
  const isColorTriggerFocusVisible = focusVisibleAction === "color";
  const isMoveUpFocusVisible = focusVisibleAction === "move-up";
  const isMoveDownFocusVisible = focusVisibleAction === "move-down";
  const isDeleteFocusVisible = focusVisibleAction === "delete";
  const isRenamingNote = renamingNotePath === node.path;
  const noteRenameValue = noteRenameDrafts?.[node.path] ?? node.name.replace(/\.md$/i, "");
  const noteError = noteErrors?.[node.path] ?? null;

  const handleActionFocus = (
    action: "color" | "move-up" | "move-down" | "delete",
    event: React.FocusEvent<HTMLButtonElement>,
  ) => {
    setFocusVisibleAction(event.currentTarget.matches(":focus-visible") ? action : null);
  };

  const clearActionFocus = (action: "color" | "move-up" | "move-down" | "delete") => {
    setFocusVisibleAction((current) => (current === action ? null : current));
  };

  const toggleExpanded = () => {
    setExpanded((currentExpanded) => {
      const nextExpanded = !currentExpanded;
      onDirectoryExpandedChange?.(node.path, nextExpanded);
      return nextExpanded;
    });
  };

  const submitNotebookRename = () => {
    if (skipRenameSubmitRef.current) {
      skipRenameSubmitRef.current = false;
      return;
    }

    onNotebookRenameSubmit?.();
  };

  const cancelNotebookRename = () => {
    skipRenameSubmitRef.current = true;
    onNotebookRenameCancel?.();
  };

  useEffect(() => {
    if (expanded) {
      setShouldRenderChildren(true);
      return;
    }

    if (shouldDisableHeightAnimation) {
      setShouldRenderChildren(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShouldRenderChildren(false);
    }, 160);

    return () => window.clearTimeout(timeoutId);
  }, [expanded, shouldDisableHeightAnimation]);

  useLayoutEffect(() => {
    if (shouldDisableHeightAnimation || !shouldRenderChildren || !contentRef.current) {
      setContentHeight(0);
      return;
    }

    const contentElement = contentRef.current;
    let firstFrameId = 0;
    let secondFrameId = 0;

    const measure = () => {
      setContentHeight(contentElement.scrollHeight);
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(firstFrameId);
      window.cancelAnimationFrame(secondFrameId);
      measure();
      firstFrameId = window.requestAnimationFrame(() => {
        measure();
        secondFrameId = window.requestAnimationFrame(measure);
      });
    };

    scheduleMeasure();

    const mutationObserver = new MutationObserver(() => {
      scheduleMeasure();
    });

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
        scheduleMeasure();
      });

    mutationObserver.observe(contentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "aria-expanded"],
    });

    resizeObserver?.observe(contentElement);

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(firstFrameId);
      window.cancelAnimationFrame(secondFrameId);
    };
  }, [shouldDisableHeightAnimation, shouldRenderChildren, expanded, node.children]);

  useEffect(() => {
    if (!isRenamingNotebook || !renameInputRef.current) {
      return;
    }

    renameInputRef.current.focus();
    const length = renameInputRef.current.value.length;
    renameInputRef.current.setSelectionRange(length, length);
  }, [isRenamingNotebook]);

  useEffect(() => {
    if (!isRenamingNote || !noteRenameInputRef.current) {
      return;
    }

    noteRenameInputRef.current.focus();
    const length = noteRenameInputRef.current.value.length;
    noteRenameInputRef.current.setSelectionRange(length, length);
  }, [isRenamingNote]);

  if (node.is_dir) {
    return (
      <div>
        <div
          onContextMenu={(event) => onContextMenu?.(node, event)}
          onDragEnter={(event) => onDragEnterDirectory(node, event)}
          onDragOver={(event) => onDragEnterDirectory(node, event)}
          onDragLeave={() => onDragLeaveDirectory(node)}
          onDrop={(event) => onDropOnDirectory(node, event)}
          onMouseEnter={() => setIsNotebookRowHovered(true)}
          onMouseLeave={() => setIsNotebookRowHovered(false)}
          onPointerEnter={() => onPointerEnterDirectory(node)}
          onPointerLeave={() => onPointerLeaveDirectory(node)}
          onPointerUp={(event) => onPointerUpOnDirectory(node, event)}
          data-note-drop-directory={dropDirectoryPath ?? undefined}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div
            style={{
              paddingLeft: indent,
              paddingRight: 8,
              paddingTop: 4,
              paddingBottom: 4,
              fontSize: 13,
              background: directoryBackground,
              color: directoryTextColor,
              display: "flex",
              alignItems: "center",
              userSelect: "none",
              borderRadius: 8,
              flex: 1,
              minWidth: 0,
              transition: "background 220ms ease, color 180ms ease, box-shadow 220ms ease, transform 180ms ease",
              boxShadow: directorySurfaceBoxShadow,
              transform: expanded ? "translateX(0px)" : "translateX(-1px)",
            }}
          >
            {isNotebook ? (
              <button
                type="button"
                aria-label={`编辑笔记本颜色 ${node.name}`}
                aria-expanded={isPickingNotebookColor}
                disabled={isRenamingNotebook}
                onClick={(event) => {
                  event.stopPropagation();
                  onNotebookColorTrigger?.();
                }}
                onFocus={(event) => handleActionFocus("color", event)}
                onBlur={() => clearActionFocus("color")}
                style={{
                  width: 8,
                  height: 22,
                  borderRadius: 999,
                  border: isColorTriggerFocusVisible
                    ? "1px solid #1d4ed8"
                    : isPickingNotebookColor
                      ? `1px solid ${directoryPalette.color}`
                      : "none",
                  outline: "none",
                  background: directoryPalette.color,
                  opacity: isRenamingNotebook ? 0 : expanded ? 1 : 0.72,
                  pointerEvents: isRenamingNotebook ? "none" : "auto",
                  visibility: isRenamingNotebook ? "hidden" : "visible",
                  transition: "opacity 180ms ease, transform 220ms ease, box-shadow 180ms ease",
                  transform: expanded ? "scaleY(1)" : "scaleY(0.72)",
                  flexShrink: 0,
                  cursor: isRenamingNotebook ? "default" : "pointer",
                  boxShadow: isColorTriggerFocusVisible
                    ? "0 0 0 3px rgba(37, 99, 235, 0.24)"
                    : isPickingNotebookColor
                      ? `0 0 0 3px ${directoryPalette.background}`
                      : "none",
                }}
              />
            ) : (
              <span
                data-testid={`directory-accent:${node.path}`}
                data-color={directoryColor}
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 18,
                  borderRadius: 999,
                  background: directoryPalette.color,
                  opacity: expanded ? 1 : 0.72,
                  transition: "opacity 180ms ease, transform 220ms ease",
                  transform: expanded ? "scaleY(1)" : "scaleY(0.72)",
                  flexShrink: 0,
                }}
              />
            )}
            {isRenamingNotebook ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitNotebookRename();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flex: 1,
                  minWidth: 0,
                  marginLeft: 8,
                }}
              >
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  aria-label={`重命名笔记本 ${node.name}`}
                  onChange={(event) => onNotebookRenameChange?.(event.target.value)}
                  onBlur={submitNotebookRename}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelNotebookRename();
                    }
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 28,
                    borderRadius: 8,
                    border: "1px solid #bfdbfe",
                    padding: "0 10px",
                    fontSize: 13,
                    color: "#1f2937",
                    background: "rgba(255,255,255,0.94)",
                  }}
                />
              </form>
            ) : (
              <>
                {isNotebook ? (
                  <button
                    type="button"
                onPointerDown={(event) => event.stopPropagation()}
                    aria-label={`切换笔记本 ${node.name}`}
                    aria-expanded={expanded}
                    onClick={toggleExpanded}
                    style={{
                      marginLeft: 6,
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      border: "none",
                      outline: "none",
                      appearance: "none",
                      color: "inherit",
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "default",
                      flexShrink: 0,
                      boxShadow: isToggleFocusVisible ? "0 0 0 2px rgba(37, 99, 235, 0.26)" : "none",
                      background: isToggleFocusVisible ? "rgba(255,255,255,0.72)" : "transparent",
                      transition: "box-shadow 180ms ease, background 180ms ease",
                    }}
                    onFocus={(event) => setIsToggleFocusVisible(event.currentTarget.matches(":focus-visible"))}
                    onBlur={() => setIsToggleFocusVisible(false)}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRight: `1.5px solid ${directoryTextColor}`,
                        borderBottom: `1.5px solid ${directoryTextColor}`,
                        transform: expanded ? "rotate(45deg) translateY(-1px)" : "rotate(-45deg)",
                        transformOrigin: "center",
                        transition: "transform 180ms ease, border-color 180ms ease",
                      }}
                    />
                  </button>
                ) : null}
                {isNotebook ? (
                  <button
                    type="button"
                    aria-label={node.name}
                    onClick={toggleExpanded}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onBeginNotebookRename?.();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "F2") {
                        event.preventDefault();
                        onBeginNotebookRename?.();
                      }
                    }}
                    onFocus={(event) => setIsTitleFocusVisible(event.currentTarget.matches(":focus-visible"))}
                    onBlur={() => setIsTitleFocusVisible(false)}
                    style={{
                      marginLeft: 6,
                      fontSize: 14,
                      cursor: "default",
                      display: "flex",
                      alignItems: "center",
                      minWidth: 0,
                      flex: 1,
                      textAlign: "left",
                      border: "none",
                      outline: "none",
                      appearance: "none",
                      background: dragOverPath === node.path ? "rgb(219, 234, 254)" : "transparent",
                      color: "inherit",
                      padding: 0,
                      borderRadius: 6,
                      boxShadow: isTitleFocusVisible ? "0 0 0 2px rgba(37, 99, 235, 0.26)" : "none",
                      transition: "background 220ms ease, color 180ms ease, box-shadow 220ms ease",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: expanded ? 600 : 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {node.name}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={node.name}
                    aria-expanded={expanded}
                    onClick={toggleExpanded}
                    onFocus={(event) => setIsTitleFocusVisible(event.currentTarget.matches(":focus-visible"))}
                    onBlur={() => setIsTitleFocusVisible(false)}
                    style={{
                      marginLeft: 8,
                      fontSize: 14,
                      cursor: "default",
                      display: "flex",
                      alignItems: "center",
                      minWidth: 0,
                      flex: 1,
                      textAlign: "left",
                      border: "none",
                      outline: "none",
                      appearance: "none",
                      background: "transparent",
                      color: "inherit",
                      padding: 0,
                      borderRadius: 6,
                      boxShadow: isTitleFocusVisible ? "0 0 0 2px rgba(37, 99, 235, 0.26)" : "none",
                      transition: "background 220ms ease, color 180ms ease, box-shadow 220ms ease",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: expanded ? 600 : 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {node.name}
                    </span>
                  </button>
                )}
              </>
            )}
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              paddingRight: 8,
              flexShrink: 0,
            }}
          >
            {isNotebook && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  opacity: areNotebookActionsVisible ? 1 : 0,
                  pointerEvents: areNotebookActionsVisible ? "auto" : "none",
                  transform: areNotebookActionsVisible ? "translateX(0px)" : "translateX(4px)",
                  transition: "opacity 180ms ease, transform 180ms ease",
                }}
              >
                <div
                  data-testid={`notebook-move-group:${node.path}`}
                  style={{
                    display: "inline-flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0,
                    border: "none",
                    background: "transparent",
                  }}
                >
                  <button
                    type="button"
                    aria-label={`上移笔记本 ${node.name}`}
                    disabled={disableMoveUp || isRenamingNotebook}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveNotebookUp?.();
                    }}
                    onFocus={(event) => handleActionFocus("move-up", event)}
                    onBlur={() => clearActionFocus("move-up")}
                    style={{
                      width: 22,
                      height: 16,
                      border: "none",
                      borderBottom: "1px solid #d0d7de",
                      outline: "none",
                      background: disableMoveUp || isRenamingNotebook
                        ? "#f8fafc"
                        : hoveredNotebookAction === "move-up"
                          ? ACTION_HIGHLIGHT_BACKGROUND
                        : isMoveUpFocusVisible
                          ? ACTION_HIGHLIGHT_BACKGROUND
                          : "#fff",
                      color: disableMoveUp || isRenamingNotebook
                        ? "#98a2b3"
                        : hoveredNotebookAction === "move-up" || isMoveUpFocusVisible
                          ? ACTION_HIGHLIGHT_TEXT
                          : "#334155",
                      fontSize: 9,
                      lineHeight: 1,
                      cursor: disableMoveUp || isRenamingNotebook ? "not-allowed" : "pointer",
                      boxShadow: isMoveUpFocusVisible ? `inset 0 0 0 1px ${ACTION_HIGHLIGHT_BORDER}` : "none",
                      transition: "box-shadow 180ms ease, background 180ms ease",
                    }}
                    onMouseEnter={() => setHoveredNotebookAction("move-up")}
                    onMouseLeave={() => setHoveredNotebookAction((current) => (current === "move-up" ? null : current))}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`下移笔记本 ${node.name}`}
                    disabled={disableMoveDown || isRenamingNotebook}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveNotebookDown?.();
                    }}
                    onFocus={(event) => handleActionFocus("move-down", event)}
                    onBlur={() => clearActionFocus("move-down")}
                    style={{
                        width: 22,
                        height: 16,
                      border: "none",
                      outline: "none",
                      background: disableMoveDown || isRenamingNotebook
                        ? "#f8fafc"
                        : hoveredNotebookAction === "move-down"
                          ? ACTION_HIGHLIGHT_BACKGROUND
                        : isMoveDownFocusVisible
                          ? ACTION_HIGHLIGHT_BACKGROUND
                          : "#fff",
                      color: disableMoveDown || isRenamingNotebook
                        ? "#98a2b3"
                        : hoveredNotebookAction === "move-down" || isMoveDownFocusVisible
                          ? ACTION_HIGHLIGHT_TEXT
                          : "#334155",
                      fontSize: 9,
                      lineHeight: 1,
                      cursor: disableMoveDown || isRenamingNotebook ? "not-allowed" : "pointer",
                      boxShadow: isMoveDownFocusVisible ? `inset 0 0 0 1px ${ACTION_HIGHLIGHT_BORDER}` : "none",
                      transition: "box-shadow 180ms ease, background 180ms ease",
                    }}
                    onMouseEnter={() => setHoveredNotebookAction("move-down")}
                    onMouseLeave={() => setHoveredNotebookAction((current) => (current === "move-down" ? null : current))}
                  >
                    ▼
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={`删除笔记本 ${node.name}`}
                  aria-pressed={isConfirmingNotebookDelete}
                  disabled={isRenamingNotebook}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteNotebook?.();
                  }}
                  onFocus={(event) => handleActionFocus("delete", event)}
                  onBlur={() => clearActionFocus("delete")}
                  style={{
                    width: 20,
                    height: 20,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 999,
                    border: isDeleteFocusVisible || hoveredNotebookAction === "delete"
                      ? `1px solid ${ACTION_HIGHLIGHT_BORDER}`
                      : isConfirmingNotebookDelete
                        ? "1px solid #fecaca"
                        : "1px solid #d0d7de",
                    outline: "none",
                    background: isRenamingNotebook
                      ? "#f8fafc"
                      : isConfirmingNotebookDelete
                        ? "#fef2f2"
                        : hoveredNotebookAction === "delete" || isDeleteFocusVisible
                          ? ACTION_HIGHLIGHT_BACKGROUND
                          : "#fff",
                    color: isRenamingNotebook
                      ? "#98a2b3"
                      : isConfirmingNotebookDelete
                        ? "#b91c1c"
                        : hoveredNotebookAction === "delete" || isDeleteFocusVisible
                          ? ACTION_HIGHLIGHT_TEXT
                          : "#334155",
                    fontSize: 11,
                    lineHeight: 1,
                    padding: 0,
                    cursor: isRenamingNotebook ? "not-allowed" : "pointer",
                    boxShadow: isDeleteFocusVisible ? "0 0 0 3px rgba(37, 99, 235, 0.18)" : "none",
                    transition: "border-color 180ms ease, box-shadow 180ms ease, background 180ms ease",
                  }}
                  onMouseEnter={() => setHoveredNotebookAction("delete")}
                  onMouseLeave={() => setHoveredNotebookAction((current) => (current === "delete" ? null : current))}
                >
                  <DeleteNotebookIcon />
                </button>
              </div>
            )}
            <span
              data-testid={`directory-count:${node.path}`}
              style={{
                padding: "1px 7px",
                borderRadius: 999,
                fontSize: 11,
                lineHeight: 1.5,
                background: directoryCountBackground,
                color: directoryCountColor,
                flexShrink: 0,
                transition: "background 180ms ease, color 180ms ease, transform 180ms ease",
                transform: expanded ? "translateX(0px)" : "translateX(-1px)",
              }}
            >
              {noteCount}
            </span>
          </div>
        </div>
        {showNotebookSlots && (
          <div
            style={{
              paddingLeft: indent + 20,
              paddingRight: 8,
              paddingTop: 6,
              display: "grid",
              gap: 6,
            }}
          >
            {isPickingNotebookColor ? notebookColorOptions : null}
            {isConfirmingNotebookDelete ? notebookDeleteConfirmation : null}
            {notebookError ? <div role="alert">{notebookError}</div> : null}
          </div>
        )}
        <div
          data-testid={`directory-content:${node.path}`}
          style={{
            overflow: "hidden",
            maxHeight: shouldDisableHeightAnimation
              ? (expanded ? "none" : "0px")
              : (expanded ? `${contentHeight}px` : "0px"),
            opacity: expanded ? 1 : 0,
            transform: shouldDisableHeightAnimation
              ? "none"
              : (expanded ? "translateY(0px)" : "translateY(-6px)"),
            transition: shouldDisableHeightAnimation
              ? "none"
              : "max-height 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {shouldRenderChildren && (
            <div ref={contentRef}>
              {node.children.map((child) => (
                <FileTreeNode
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  getDefaultExpanded={getDefaultExpanded}
                  onDirectoryExpandedChange={onDirectoryExpandedChange}
                  inheritedDirectoryColor={directoryColor}
                  onSelectFile={onSelectFile}
                  selectedPath={selectedPath}
                  dragOverPath={dragOverPath}
                  onStartDragFile={onStartDragFile}
                  onDragEnterDirectory={onDragEnterDirectory}
                  onDragLeaveDirectory={onDragLeaveDirectory}
                  onDropOnDirectory={onDropOnDirectory}
                  onStartPointerDragFile={onStartPointerDragFile}
                  onPointerEnterDirectory={onPointerEnterDirectory}
                  onPointerLeaveDirectory={onPointerLeaveDirectory}
                  onPointerUpOnDirectory={onPointerUpOnDirectory}
                  onContextMenu={onContextMenu}
                  renamingNotePath={renamingNotePath}
                  noteRenameDrafts={noteRenameDrafts}
                  noteErrors={noteErrors}
                  onBeginNoteRename={onBeginNoteRename}
                  onNoteRenameChange={onNoteRenameChange}
                  onNoteRenameSubmit={onNoteRenameSubmit}
                  onNoteRenameCancel={onNoteRenameCancel}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        draggable={false}
        data-note-drag-source={node.path}
        data-note-drag-label={node.name}
        onClick={() => {
          if (!isRenamingNote) {
            onSelectFile(node);
          }
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!isRenamingNote) {
            onBeginNoteRename?.(node);
          }
        }}
        onContextMenu={(event) => onContextMenu?.(node, event)}
        onDragStart={(event) => onStartDragFile(node, event)}
        onPointerDown={(event) => onStartPointerDragFile(node, event)}
        style={{
          paddingLeft: indent,
          paddingRight: 8,
          paddingTop: 3,
          paddingBottom: 3,
          cursor: "default",
          fontSize: 13,
          background: isSelected ? "#dbeafe" : "transparent",
          color: isSelected ? "#1d4ed8" : "#333",
          borderRadius: 4,
          userSelect: "none",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {isRenamingNote ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onNoteRenameSubmit?.(node);
            }}
            onClick={(event) => event.stopPropagation()}
            style={{ flex: 1, minWidth: 0 }}
          >
            <input
              ref={noteRenameInputRef}
              aria-label={`重命名笔记 ${node.name}`}
              value={noteRenameValue}
              onChange={(event) => onNoteRenameChange?.(node.path, event.target.value)}
              onBlur={() => onNoteRenameSubmit?.(node)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onNoteRenameSubmit?.(node);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onNoteRenameCancel?.(node.path);
                }
              }}
              style={{
                width: "100%",
                minWidth: 0,
                height: 28,
                borderRadius: 8,
                border: "1px solid #bfdbfe",
                padding: "0 10px",
                fontSize: 13,
                color: "#1f2937",
                background: "rgba(255,255,255,0.94)",
                boxSizing: "border-box",
              }}
            />
          </form>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 8fr) minmax(0, 2fr)",
              alignItems: "center",
              flex: 1,
              minWidth: 0,
              columnGap: 6,
            }}
          >
            <span
              title={node.name}
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {node.name}
            </span>
            <span
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                minWidth: 0,
                gap: 4,
              }}
            >
              {node.has_summary ? (
                <span
                  data-testid={`summary-badge:${node.path}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "0 0 auto",
                    width: 15,
                    height: 15,
                    borderRadius: 999,
                    background: "#2563eb",
                    color: "#ffffff",
                    fontSize: 9,
                    fontWeight: 700,
                    lineHeight: 1,
                    textTransform: "uppercase",
                    boxShadow: isSelected ? "0 0 0 1px rgba(255,255,255,0.6)" : "none",
                  }}
                >
                  <span style={{ display: "block", lineHeight: 1, transform: "translateY(-0.5px)" }}>S</span>
                </span>
              ) : null}
            </span>
          </div>
        )}
      </div>
      {noteError ? (
        <div style={{ paddingLeft: indent + 6, paddingRight: 8, paddingTop: 4 }}>{noteError}</div>
      ) : null}
    </div>
  );
}
