import { useEffect, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../store/useAppStore";
import { useKnowledgeBase } from "../../hooks/useKnowledgeBase";
import { useOpenNote } from "../../hooks/useOpenNote";
import { FileTreeNode } from "./FileTreeNode";
import { ImportDialog } from "./ImportDialog";
import { api } from "../../api/commands";
import { useContextMenu } from "../ContextMenu/useContextMenu";
import type { NoteTreeNode } from "../../types";
import { buildNotebookTreeView } from "./notebookTree";
import { getDropDirectoryPath } from "./fileTreeDrag";

const DRAG_DEBUG_PREFIX = "[mynote:note-drag]";
const NOTE_DRAG_SOURCE_SELECTOR = "[data-note-drag-source]";
const NOTE_DROP_DIRECTORY_SELECTOR = "[data-note-drop-directory]";
const NOTE_DRAG_THRESHOLD_PX = 4;

const NOTEBOOK_ICON_PRESETS = [
  { value: "folder", label: "文件夹", glyph: "F" },
  { value: "book", label: "书本", glyph: "B" },
  { value: "idea", label: "灵感", glyph: "I" },
  { value: "code", label: "代码", glyph: "C" },
  { value: "list", label: "清单", glyph: "L" },
  { value: "archive", label: "归档", glyph: "A" },
  { value: "star", label: "星标", glyph: "S" },
  { value: "tag", label: "标签", glyph: "T" },
] as const;

const NOTEBOOK_COLOR_PRESETS = [
  { value: "blue", label: "蓝色", swatch: "#2563eb", background: "#dbeafe" },
  { value: "cyan", label: "青色", swatch: "#0891b2", background: "#cffafe" },
  { value: "green", label: "绿色", swatch: "#16a34a", background: "#dcfce7" },
  { value: "orange", label: "橙色", swatch: "#ea580c", background: "#fed7aa" },
  { value: "red", label: "红色", swatch: "#dc2626", background: "#fee2e2" },
  { value: "pink", label: "粉色", swatch: "#db2777", background: "#fce7f3" },
  { value: "brown", label: "棕色", swatch: "#92400e", background: "#ede0d4" },
  { value: "gray", label: "灰色", swatch: "#6b7280", background: "#e5e7eb" },
] as const;

const FALLBACK_NOTEBOOK_ICON = "folder";
const DEFAULT_NOTEBOOK_ICON = "book";
const DEFAULT_NOTEBOOK_COLOR = "blue";

function logNoteDrag(event: string, details: Record<string, unknown>) {
  console.info(DRAG_DEBUG_PREFIX, event, details);
}

function getDataTransferTypes(dataTransfer: DataTransfer): string[] {
  return Array.from(dataTransfer.types ?? []);
}

function findClosestDataValue(element: Element | null, selector: string, key: string): string | null {
  const target = element?.closest<HTMLElement>(selector);
  return target?.dataset[key]?.trim() || null;
}

function getEventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Text) return target.parentElement;
  return null;
}

type InternalNoteDrag = {
  sourcePath: string;
  label: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDragging: boolean;
};

export function FileTreePanel() {
  const tree = useAppStore((s) => s.tree);
  const selectedNodePath = useAppStore((s) => s.selectedNodePath);
  const selectedTagIds = useAppStore((s) => s.selectedTagIds);
  const setTree = useAppStore((s) => s.setTree);
  const refreshTree = useAppStore((s) => s.refreshTree);
  const {
    createNote,
    createNotebook,
    moveNote,
    renameNotebook,
    updateNotebookVisual,
    deleteNotebook,
    reorderNotebooks,
  } = useKnowledgeBase();
  const { openNote } = useOpenNote();
  const { openContextMenu } = useContextMenu();
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [targetNotebookPath, setTargetNotebookPath] = useState("");
  const [notebookInputVisible, setNotebookInputVisible] = useState(false);
  const [notebookName, setNotebookName] = useState("");
  const [notebookIcon, setNotebookIcon] = useState<string>(DEFAULT_NOTEBOOK_ICON);
  const [notebookColor, setNotebookColor] = useState<string>(DEFAULT_NOTEBOOK_COLOR);
  const [creationHint, setCreationHint] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<InternalNoteDrag | null>(null);
  const [renamingNotebookPath, setRenamingNotebookPath] = useState<string | null>(null);
  const [colorPickerNotebookPath, setColorPickerNotebookPath] = useState<string | null>(null);
  const [deleteConfirmNotebookPath, setDeleteConfirmNotebookPath] = useState<string | null>(null);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [notebookErrors, setNotebookErrors] = useState<Record<string, string | null>>({});
  const pointerDragSourcePathRef = useRef<string | null>(null);
  const internalNoteDragRef = useRef<InternalNoteDrag | null>(null);
  const fullTreeRef = useRef<NoteTreeNode[]>(tree);
  const [importFiles, setImportFiles] = useState<string[] | null>(null);
  const treeView = selectedTagIds.length > 0 ? tree : buildNotebookTreeView(tree);
  const notebookSourceTree = selectedTagIds.length > 0 ? fullTreeRef.current : tree;

  function collectNotebookRoots(nodes: NoteTreeNode[]) {
    const notesRoot = nodes.find((node) => node.is_dir && node.path === "notes");
    return notesRoot?.children.filter((node) => node.is_dir) ?? [];
  }

  function isTopLevelNotebookPath(path: string) {
    const parts = path.split("/");
    return parts.length === 2 && parts[0] === "notes" && parts[1] !== "__unarchived__";
  }

  function getPreferredNotebookPath(notebooks: NoteTreeNode[]) {
    if (selectedNodePath?.startsWith("notes/")) {
      const parts = selectedNodePath.split("/");
      if (parts.length >= 2) {
        const candidate = `${parts[0]}/${parts[1]}`;
        if (notebooks.some((notebook) => notebook.path === candidate)) {
          return candidate;
        }
      }
    }

    return notebooks[0]?.path ?? null;
  }

  function getNoteTitle(node: NoteTreeNode) {
    return node.name.replace(/\.md$/i, "");
  }

  async function writeClipboardText(text: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(text);
  }

  useEffect(() => {
    if (tree.some((node) => node.path === "notes" && node.is_dir)) {
      fullTreeRef.current = tree;
    }
  }, [tree]);

  useEffect(() => {
    if (selectedTagIds.length > 0) {
      api.listNotesByTag(selectedTagIds)
        .then((notes) => {
          const flatTree = notes.map((n) => ({
            id: n.id,
            name: n.title,
            path: n.path,
            is_dir: false,
            children: [],
          }));
          setTree(flatTree);
        })
        .catch(console.error);
    } else {
      refreshTree();
    }
  }, [selectedTagIds]);

  useEffect(() => {
    const setGlobalDrag = (drag: InternalNoteDrag | null) => {
      internalNoteDragRef.current = drag;
      pointerDragSourcePathRef.current = drag?.sourcePath ?? null;
      setDragPreview(drag?.isDragging ? drag : null);
    };

    const getDropDirectoryAtPoint = (clientX: number, clientY: number) => (
      typeof document.elementFromPoint === "function"
        ? findClosestDataValue(
          document.elementFromPoint(clientX, clientY),
          NOTE_DROP_DIRECTORY_SELECTOR,
          "noteDropDirectory",
        )
        : null
    );

    logNoteDrag("global-listeners-ready", { mode: "pointer+mouse" });

    const startGlobalDrag = (
      target: EventTarget | null,
      button: number,
      clientX: number,
      clientY: number,
      inputType: string,
      preventDefault: () => void,
    ) => {
      if (button !== 0) return;
      const sourceElement = getEventElement(target);
      const sourcePath = findClosestDataValue(
        sourceElement,
        NOTE_DRAG_SOURCE_SELECTOR,
        "noteDragSource",
      );
      if (!sourcePath) return;
      const label = findClosestDataValue(sourceElement, NOTE_DRAG_SOURCE_SELECTOR, "noteDragLabel")
        ?? sourcePath.split("/").pop()
        ?? sourcePath;

      preventDefault();
      setGlobalDrag({ sourcePath, label, startX: clientX, startY: clientY, currentX: clientX, currentY: clientY, isDragging: false });
      logNoteDrag("global-start", {
        sourcePath,
        label,
        inputType,
        clientX,
        clientY,
      });
    };

    const moveGlobalDrag = (clientX: number, clientY: number) => {
      const drag = internalNoteDragRef.current;
      if (!drag) return;
      const distance = Math.hypot(clientX - drag.startX, clientY - drag.startY);
      if (!drag.isDragging && distance < NOTE_DRAG_THRESHOLD_PX) return;
      if (!drag.isDragging) {
        const nextDrag = { ...drag, currentX: clientX, currentY: clientY, isDragging: true };
        internalNoteDragRef.current = nextDrag;
        setDragPreview(nextDrag);
        logNoteDrag("global-dragging", {
          sourcePath: drag.sourcePath,
          distance,
        });
      } else {
        const nextDrag = { ...drag, currentX: clientX, currentY: clientY };
        internalNoteDragRef.current = nextDrag;
        setDragPreview(nextDrag);
      }
      const targetDirectory = getDropDirectoryAtPoint(clientX, clientY);
      setDragOverPath(targetDirectory);
    };

    const finishGlobalDrag = (clientX: number, clientY: number, inputType: string) => {
      const drag = internalNoteDragRef.current;
      if (!drag) return;
      const targetDirectory = getDropDirectoryAtPoint(clientX, clientY);
      const shouldMove = drag.isDragging && Boolean(targetDirectory);
      setGlobalDrag(null);
      setDragOverPath(null);
      logNoteDrag("global-drop", {
        sourcePath: drag.sourcePath,
        targetDirectory,
        inputType,
        isDragging: drag.isDragging,
        shouldMove,
        clientX,
        clientY,
      });
      if (!shouldMove || !targetDirectory) return;
      void moveNote(drag.sourcePath, targetDirectory);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      startGlobalDrag(event.target, event.button, event.clientX, event.clientY, `pointer:${event.pointerType}`, () => event.preventDefault());
    };

    const handlePointerMove = (event: PointerEvent) => {
      moveGlobalDrag(event.clientX, event.clientY);
    };

    const handlePointerUp = (event: PointerEvent) => {
      finishGlobalDrag(event.clientX, event.clientY, `pointer:${event.pointerType}`);
    };

    const handleMouseDown = (event: MouseEvent) => {
      startGlobalDrag(event.target, event.button, event.clientX, event.clientY, "mouse", () => event.preventDefault());
    };

    const handleMouseMove = (event: MouseEvent) => {
      moveGlobalDrag(event.clientX, event.clientY);
    };

    const handleMouseUp = (event: MouseEvent) => {
      finishGlobalDrag(event.clientX, event.clientY, "mouse");
    };

    const handlePointerCancel = () => {
      const sourcePath = pointerDragSourcePathRef.current;
      if (!sourcePath) return;
      logNoteDrag("global-pointer-cancel", { sourcePath });
      setGlobalDrag(null);
      setDragOverPath(null);
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
  }, [moveNote]);

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | undefined;
    listen("note:index_updated", () => {
      if (!isMounted) return;
      if (selectedTagIds.length > 0) {
        api.listNotesByTag(selectedTagIds).then((notes) => {
          setTree(notes.map((n) => ({
            id: n.id, name: n.title, path: n.path, is_dir: false, children: [],
          })));
        }).catch(console.error);
      } else {
        refreshTree();
      }
    }).then((fn) => {
      unlisten = fn;
      if (!isMounted) fn();
    });
    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, [selectedTagIds]);

  // Collect unique directories from tree
  const existingDirs = tree
    .filter(n => n.is_dir)
    .map(n => n.path)
    .concat(tree.filter(n => !n.is_dir).map(n => {
      const parts = n.path.split("/");
      return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    }).filter(Boolean));
  const uniqueDirs = [...new Set(existingDirs.length ? existingDirs : ["notes"])];
  const topLevelNotebookPaths = treeView
    .filter((node) => node.is_dir && isTopLevelNotebookPath(node.path))
    .map((node) => node.path);

  async function handleSelect(node: NoteTreeNode) {
    if (node.is_dir) return;
    await openNote(node.path);
  }

  async function handleNewNote() {
    let notebooks = collectNotebookRoots(notebookSourceTree);
    if (notebooks.length === 0 && selectedTagIds.length > 0) {
      try {
        const fullTree = await api.getNoteTree();
        fullTreeRef.current = fullTree;
        notebooks = collectNotebookRoots(fullTree);
      } catch (error) {
        console.error("Failed to recover notebook tree:", error);
      }
    }

    if (notebooks.length === 0) {
      setCreationHint("请先创建笔记本");
      setInputVisible(false);
      return;
    }

    setCreationHint(null);
    setInputValue("");
    setTargetNotebookPath(getPreferredNotebookPath(notebooks) ?? "");
    setInputVisible(true);
  }

  function handleNewNotebook() {
    setCreationHint(null);
    setNotebookName("");
    setNotebookIcon(DEFAULT_NOTEBOOK_ICON);
    setNotebookColor(DEFAULT_NOTEBOOK_COLOR);
    setNotebookInputVisible(true);
  }

  function closeNotebookCreationPanel() {
    setNotebookInputVisible(false);
    setNotebookName("");
    setNotebookIcon(DEFAULT_NOTEBOOK_ICON);
    setNotebookColor(DEFAULT_NOTEBOOK_COLOR);
  }

  async function handleInputConfirm() {
    const title = inputValue.trim();
    const targetNotebook = targetNotebookPath.trim();
    setInputVisible(false);
    if (!title || !targetNotebook) return;
    await createNote(targetNotebook, title);
  }

  async function handleNotebookInputConfirm() {
    const name = notebookName.trim();
    if (!name) {
      return;
    }
    const created = await createNotebook(name, notebookIcon, notebookColor);
    if (created === false) {
      return;
    }
    closeNotebookCreationPanel();
  }

  function clearNotebookError(path: string) {
    setNotebookErrors((current) => ({
      ...current,
      [path]: null,
    }));
  }

  function beginNotebookRename(node: NoteTreeNode) {
    clearNotebookError(node.path);
    setRenameDrafts((current) => ({
      ...current,
      [node.path]: current[node.path] ?? node.name,
    }));
    setRenamingNotebookPath(node.path);
    setColorPickerNotebookPath(null);
    setDeleteConfirmNotebookPath(null);
  }

  function handleNotebookRenameChange(path: string, value: string) {
    clearNotebookError(path);
    setRenameDrafts((current) => ({
      ...current,
      [path]: value,
    }));
  }

  function cancelNotebookRename(path: string) {
    clearNotebookError(path);
    setRenameDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[path];
      return nextDrafts;
    });
    setRenamingNotebookPath((current) => (current === path ? null : current));
  }

  function toggleNotebookColorPicker(path: string) {
    clearNotebookError(path);
    setColorPickerNotebookPath((current) => (current === path ? null : path));
    setRenamingNotebookPath(null);
    setDeleteConfirmNotebookPath(null);
  }

  function toggleNotebookDeleteConfirmation(path: string) {
    clearNotebookError(path);
    setDeleteConfirmNotebookPath((current) => (current === path ? null : path));
    setRenamingNotebookPath(null);
    setColorPickerNotebookPath(null);
  }

  async function handleRenameNotebook(node: NoteTreeNode) {
    const nextName = (renameDrafts[node.path] ?? node.name).trim();
    if (!nextName) {
      setNotebookErrors((current) => ({
        ...current,
        [node.path]: "笔记本名称不能为空",
      }));
      return;
    }

    try {
      await renameNotebook(node.path, nextName);
      setRenameDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[node.path];
        return nextDrafts;
      });
      clearNotebookError(node.path);
        setRenamingNotebookPath((current) => (current === node.path ? null : current));
    } catch (error) {
      setNotebookErrors((current) => ({
        ...current,
        [node.path]: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function handleNotebookColorSelect(node: NoteTreeNode, color: string) {
    try {
      await updateNotebookVisual(node.path, node.notebook_icon ?? FALLBACK_NOTEBOOK_ICON, color);
      clearNotebookError(node.path);
      setColorPickerNotebookPath((current) => (current === node.path ? null : current));
    } catch (error) {
      setNotebookErrors((current) => ({
        ...current,
        [node.path]: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function handleDeleteNotebook(path: string) {
    try {
      await deleteNotebook(path);
      clearNotebookError(path);
      setDeleteConfirmNotebookPath((current) => (current === path ? null : current));
    } catch (error) {
      setNotebookErrors((current) => ({
        ...current,
        [path]: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function handleReorderNotebook(path: string, direction: -1 | 1) {
    const orderedPaths = treeView
      .filter((node) => node.is_dir && isTopLevelNotebookPath(node.path))
      .map((node) => node.path);
    const currentIndex = orderedPaths.indexOf(path);
    const targetIndex = currentIndex + direction;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedPaths.length) {
      return;
    }

    const nextOrderedPaths = [...orderedPaths];
    [nextOrderedPaths[currentIndex], nextOrderedPaths[targetIndex]] = [
      nextOrderedPaths[targetIndex],
      nextOrderedPaths[currentIndex],
    ];

    try {
      await reorderNotebooks(nextOrderedPaths);
      clearNotebookError(path);
    } catch (error) {
      setNotebookErrors((current) => ({
        ...current,
        [path]: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  function handleNoteInputBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
      return;
    }
    void handleInputConfirm();
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleInputConfirm();
    if (e.key === "Escape") setInputVisible(false);
  }

  function handleNotebookInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleNotebookInputConfirm();
    if (e.key === "Escape") closeNotebookCreationPanel();
  }

  async function handleImport() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];
    if (files.length === 0) return;
    setImportFiles(files);
  }

  function handleStartDragFile(node: NoteTreeNode, event: React.DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData("text/plain", node.path);
    event.dataTransfer.effectAllowed = "move";
    logNoteDrag("dragstart", {
      sourcePath: node.path,
      dataTypes: getDataTransferTypes(event.dataTransfer),
      effectAllowed: event.dataTransfer.effectAllowed,
    });
  }

  function handleDragEnterDirectory(node: NoteTreeNode, event: React.DragEvent<HTMLElement>) {
    const targetDirectory = getDropDirectoryPath(node);
    logNoteDrag("dragover", {
      nodePath: node.path,
      targetDirectory,
      dataTypes: getDataTransferTypes(event.dataTransfer),
    });
    if (!targetDirectory) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverPath(node.path);
  }

  function handleDragLeaveDirectory(node: NoteTreeNode) {
    if (dragOverPath === node.path) {
      setDragOverPath(null);
    }
  }

  async function handleDropOnDirectory(node: NoteTreeNode, event: React.DragEvent<HTMLElement>) {
    const targetDirectory = getDropDirectoryPath(node);
    setDragOverPath(null);
    logNoteDrag("drop", {
      nodePath: node.path,
      targetDirectory,
      dataTypes: getDataTransferTypes(event.dataTransfer),
    });
    if (!targetDirectory) return;

    event.preventDefault();
    const sourcePath = event.dataTransfer.getData("text/plain").trim();
    logNoteDrag("drop-payload", { sourcePath, targetDirectory });
    if (!sourcePath) return;
    await moveNote(sourcePath, targetDirectory);
  }

  function handleStartPointerDragFile(node: NoteTreeNode, event: React.PointerEvent<HTMLDivElement>) {
    logNoteDrag("pointer-start", {
      sourcePath: node.path,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }

  function handlePointerEnterDirectory(node: NoteTreeNode) {
    const sourcePath = pointerDragSourcePathRef.current;
    if (!sourcePath) return;
    const targetDirectory = getDropDirectoryPath(node);
    logNoteDrag("pointer-over", {
      sourcePath,
      nodePath: node.path,
      targetDirectory,
    });
    if (targetDirectory) {
      setDragOverPath(node.path);
    }
  }

  function handlePointerLeaveDirectory(node: NoteTreeNode) {
    if (dragOverPath === node.path) {
      setDragOverPath(null);
    }
  }

  async function handlePointerUpOnDirectory(node: NoteTreeNode, event: React.PointerEvent<HTMLElement>) {
    const drag = internalNoteDragRef.current;
    if (!drag?.isDragging) return;
    event.stopPropagation();
    const sourcePath = drag.sourcePath;
    const targetDirectory = getDropDirectoryPath(node);
    pointerDragSourcePathRef.current = null;
    internalNoteDragRef.current = null;
    setDragPreview(null);
    setDragOverPath(null);
    logNoteDrag("pointer-drop", {
      sourcePath,
      nodePath: node.path,
      targetDirectory,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (!targetDirectory) return;
    await moveNote(sourcePath, targetDirectory);
  }

  function handlePointerDragEnd() {
    const sourcePath = pointerDragSourcePathRef.current;
    if (!sourcePath) return;
    logNoteDrag("pointer-cancel", { sourcePath });
    pointerDragSourcePathRef.current = null;
    internalNoteDragRef.current = null;
    setDragPreview(null);
    setDragOverPath(null);
  }

  function handleNodeContextMenu(node: NoteTreeNode, event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();

    if (node.is_dir) {
      if (!isTopLevelNotebookPath(node.path)) {
        return;
      }

      openContextMenu({
        position: { x: event.clientX, y: event.clientY },
        payload: {
          type: "notebook",
          path: node.path,
          notebookName: node.name,
          handlers: {
            createNote: () => {
              setCreationHint(null);
              setInputValue("");
              setTargetNotebookPath(node.path);
              setInputVisible(true);
            },
            rename: () => beginNotebookRename(node),
            delete: () => toggleNotebookDeleteConfirmation(node.path),
          },
        },
      });
      return;
    }

    openContextMenu({
      position: { x: event.clientX, y: event.clientY },
      payload: {
        type: "note",
        noteId: node.id ?? node.path,
        noteTitle: getNoteTitle(node),
        path: node.path,
        handlers: {
          open: () => openNote(node.path),
          copyLink: () => writeClipboardText(node.path),
          copyWikiLink: () => writeClipboardText(`[[${getNoteTitle(node)}]]`),
        },
      },
    });
  }

  function handleBlankAreaContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    openContextMenu({
      position: { x: event.clientX, y: event.clientY },
      payload: {
        type: "fileTreeBlank",
        path: "notes",
        handlers: {
          createNote: () => void handleNewNote(),
          createNotebook: handleNewNotebook,
          importNote: handleImport,
        },
      },
    });
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{
        padding: "8px 12px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #e0e2e7",
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#6e7681", textTransform: "uppercase" }}>
          文件
        </span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button
            onClick={handleImport}
            aria-label="导入 Markdown 文件"
            style={{ fontSize: 14, background: "none", border: "none", cursor: "pointer", lineHeight: 1, color: "#555", padding: "2px 4px" }}
            title="导入 Markdown 文件"
          >
            ↓
          </button>
          <button
            onClick={handleNewNotebook}
            aria-label="新建笔记本"
            style={{ fontSize: 14, background: "none", border: "none", cursor: "pointer", lineHeight: 1, color: "#555", padding: "2px 4px" }}
            title="新建笔记本"
          >
            ▣
          </button>
          <button
            onClick={() => void handleNewNote()}
            aria-label="新建笔记"
            style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer", lineHeight: 1, color: "#555", padding: "0 2px" }}
            title="新建笔记"
          >
            +
          </button>
        </div>
      </div>
      {creationHint && (
        <div style={{ padding: "6px 8px", borderBottom: "1px solid #e0e2e7", fontSize: 12, color: "#b54708", background: "#fffaeb" }}>
          {creationHint}
        </div>
      )}
      {notebookInputVisible && (
        <div
          style={{
            padding: "8px",
            borderBottom: "1px solid #e0e2e7",
            background: "linear-gradient(180deg, #fcfdff 0%, #f8fafc 100%)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <input
            aria-label="笔记本名称"
            autoFocus
            value={notebookName}
            onChange={(e) => setNotebookName(e.target.value)}
            onKeyDown={handleNotebookInputKeyDown}
            placeholder="笔记本名称…"
            style={{
              width: "100%",
              fontSize: 13,
              padding: "6px 8px",
              border: "1px solid #b6c2cf",
              borderRadius: 6,
              outline: "none",
              background: "#fff",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#6e7681", textTransform: "uppercase" }}>
              图标
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
              {NOTEBOOK_ICON_PRESETS.map((preset) => {
                const selected = notebookIcon === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    aria-label={`图标 ${preset.label}`}
                    aria-pressed={selected}
                    onClick={() => setNotebookIcon(preset.value)}
                    style={{
                      border: selected ? "1px solid #0969da" : "1px solid #d0d7de",
                      background: selected ? "#eff6ff" : "#fff",
                      color: selected ? "#1d4ed8" : "#4b5563",
                      borderRadius: 6,
                      minHeight: 32,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "0 6px",
                    }}
                  >
                    <span aria-hidden="true">{preset.glyph}</span>
                    <span>{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#6e7681", textTransform: "uppercase" }}>
              颜色
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
              {NOTEBOOK_COLOR_PRESETS.map((preset) => {
                const selected = notebookColor === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    aria-label={`颜色 ${preset.label}`}
                    aria-pressed={selected}
                    onClick={() => setNotebookColor(preset.value)}
                    style={{
                      border: selected ? "1px solid #0969da" : "1px solid #d0d7de",
                      background: selected ? "#eff6ff" : "#fff",
                      color: "#4b5563",
                      borderRadius: 6,
                      minHeight: 32,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "0 6px",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: preset.swatch,
                        boxShadow: `0 0 0 3px ${preset.background}`,
                        flex: "0 0 auto",
                      }}
                    />
                    <span>{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => void handleNotebookInputConfirm()}
              style={{
                flex: 1,
                minHeight: 32,
                border: "1px solid #0969da",
                borderRadius: 6,
                background: "#0969da",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              创建笔记本
            </button>
            <button
              type="button"
              aria-label="取消创建笔记本"
              onClick={closeNotebookCreationPanel}
              style={{
                minWidth: 72,
                minHeight: 32,
                border: "1px solid #d0d7de",
                borderRadius: 6,
                background: "#fff",
                color: "#4b5563",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {inputVisible && (
        <div style={{ padding: "6px 8px", borderBottom: "1px solid #e0e2e7" }}>
          <select
            aria-label="目标笔记本"
            value={targetNotebookPath}
            onChange={(e) => setTargetNotebookPath(e.target.value)}
            style={{
              width: "100%",
              fontSize: 12,
              marginBottom: 6,
              padding: "4px 6px",
              border: "1px solid #d0d7de",
              borderRadius: 4,
              background: "#fff",
            }}
          >
            {collectNotebookRoots(notebookSourceTree).map((notebook) => (
              <option key={notebook.path} value={notebook.path}>
                {notebook.name}
              </option>
            ))}
          </select>
          <input
            aria-label="笔记标题"
            autoFocus
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={handleNoteInputBlur}
            placeholder="笔记标题…"
            style={{
              width: "100%",
              fontSize: 13,
              padding: "4px 6px",
              border: "1px solid #0969da",
              borderRadius: 4,
              outline: "none",
            }}
          />
        </div>
      )}
      <div
        onContextMenu={handleBlankAreaContextMenu}
        onPointerUp={handlePointerDragEnd}
        onPointerCancel={handlePointerDragEnd}
        style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}
      >
        {treeView.map((node) => {
          const isNotebook = node.is_dir && isTopLevelNotebookPath(node.path);
          const notebookIndex = topLevelNotebookPaths.indexOf(node.path);
          const notebookError = notebookErrors[node.path];

          return (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              isNotebook={isNotebook}
              isRenamingNotebook={renamingNotebookPath === node.path}
              isPickingNotebookColor={colorPickerNotebookPath === node.path}
              isConfirmingNotebookDelete={deleteConfirmNotebookPath === node.path}
              notebookError={notebookError ? <div style={inlineErrorStyle}>{notebookError}</div> : undefined}
              notebookColorOptions={(
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  {NOTEBOOK_COLOR_PRESETS.map((preset) => {
                    const selected = (node.notebook_color ?? DEFAULT_NOTEBOOK_COLOR) === preset.value;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        aria-label={`笔记本颜色 ${preset.label}`}
                        aria-pressed={selected}
                        onClick={() => void handleNotebookColorSelect(node, preset.value)}
                        style={{
                          ...inlineOptionButtonStyle,
                          borderColor: selected ? "#0969da" : "#d0d7de",
                          background: selected ? "#eff6ff" : "#fff",
                          color: "#4b5563",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 999,
                            background: preset.swatch,
                            boxShadow: `0 0 0 4px ${preset.background}`,
                            flex: "0 0 auto",
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
              notebookDeleteConfirmation={(
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #fecaca",
                    background: "#fff5f5",
                  }}
                >
                  <span style={{ fontSize: 12, color: "#7a271a", lineHeight: 1.4 }}>确认删除该笔记本？</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      aria-label={`确认删除笔记本 ${node.name}`}
                      onClick={() => void handleDeleteNotebook(node.path)}
                      style={{ ...inlinePrimaryButtonStyle, background: "#b42318", borderColor: "#b42318" }}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      aria-label={`取消删除笔记本 ${node.name}`}
                      onClick={() => toggleNotebookDeleteConfirmation(node.path)}
                      style={inlineSecondaryButtonStyle}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
              renameValue={renameDrafts[node.path] ?? node.name}
              onBeginNotebookRename={() => beginNotebookRename(node)}
              onNotebookRenameChange={(value) => handleNotebookRenameChange(node.path, value)}
              onNotebookRenameSubmit={() => void handleRenameNotebook(node)}
              onNotebookRenameCancel={() => cancelNotebookRename(node.path)}
              onNotebookColorTrigger={() => toggleNotebookColorPicker(node.path)}
              onMoveNotebookUp={() => void handleReorderNotebook(node.path, -1)}
              onMoveNotebookDown={() => void handleReorderNotebook(node.path, 1)}
              onDeleteNotebook={() => toggleNotebookDeleteConfirmation(node.path)}
              disableMoveUp={!isNotebook || notebookIndex <= 0}
              disableMoveDown={!isNotebook || notebookIndex < 0 || notebookIndex >= topLevelNotebookPaths.length - 1}
              onSelectFile={handleSelect}
              selectedPath={selectedNodePath}
              dragOverPath={dragOverPath}
              onStartDragFile={handleStartDragFile}
              onDragEnterDirectory={handleDragEnterDirectory}
              onDragLeaveDirectory={handleDragLeaveDirectory}
              onDropOnDirectory={handleDropOnDirectory}
              onStartPointerDragFile={handleStartPointerDragFile}
              onPointerEnterDirectory={handlePointerEnterDirectory}
              onPointerLeaveDirectory={handlePointerLeaveDirectory}
              onPointerUpOnDirectory={handlePointerUpOnDirectory}
              onContextMenu={handleNodeContextMenu}
            />
          );
        })}
      </div>

      {importFiles && (
        <ImportDialog
          files={importFiles}
          existingDirs={uniqueDirs}
          onClose={() => setImportFiles(null)}
          onDone={async (importedNote) => {
            setImportFiles(null);
            await refreshTree();
            if (importedNote) {
              await openNote(importedNote.path);
            }
          }}
        />
      )}
      {dragPreview && (
        <div
          aria-hidden="true"
          data-testid="note-drag-preview"
          style={{
            position: "fixed",
            left: dragPreview.currentX - 12,
            top: dragPreview.currentY - 12,
            zIndex: 9999,
            pointerEvents: "none",
            width: 190,
            minHeight: 30,
            padding: "6px 10px",
            borderRadius: 5,
            border: "1px solid #93c5fd",
            background: "#ffffff",
            color: "#1f2937",
            fontSize: 13,
            fontWeight: 500,
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
              width: 14,
              height: 16,
              borderRadius: 3,
              border: "1px solid #60a5fa",
              background: "#dbeafe",
              flex: "0 0 auto",
              boxShadow: "inset 0 -3px 0 rgba(96, 165, 250, 0.28)",
            }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {dragPreview.label}
          </span>
        </div>
      )}
    </div>
  );
}

const inlinePrimaryButtonStyle: CSSProperties = {
  minHeight: 32,
  border: "1px solid #0969da",
  borderRadius: 6,
  background: "#0969da",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  padding: "0 12px",
};

const inlineSecondaryButtonStyle: CSSProperties = {
  minHeight: 32,
  border: "1px solid #d0d7de",
  borderRadius: 6,
  background: "#fff",
  color: "#4b5563",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  padding: "0 12px",
};

const inlineOptionButtonStyle: CSSProperties = {
  border: "1px solid #d0d7de",
  borderRadius: 6,
  width: 24,
  height: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  flex: "0 0 auto",
};

const inlineErrorStyle: CSSProperties = {
  fontSize: 12,
  color: "#b42318",
  background: "#fef3f2",
  border: "1px solid #fecdca",
  borderRadius: 6,
  padding: "6px 8px",
};
