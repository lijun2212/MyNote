import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../store/useAppStore";
import { useKnowledgeBase } from "../../hooks/useKnowledgeBase";
import { useOpenNote } from "../../hooks/useOpenNote";
import { FileTreeNode } from "./FileTreeNode";
import { ImportDialog } from "./ImportDialog";
import { api } from "../../api/commands";
import type { NoteTreeNode } from "../../types";
import { buildNotebookTreeView } from "./notebookTree";
import { getDropDirectoryPath } from "./fileTreeDrag";

const DRAG_DEBUG_PREFIX = "[mynote:note-drag]";
const NOTE_DRAG_SOURCE_SELECTOR = "[data-note-drag-source]";
const NOTE_DROP_DIRECTORY_SELECTOR = "[data-note-drop-directory]";
const NOTE_DRAG_THRESHOLD_PX = 4;

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
  const { createNote, createNotebook, moveNote } = useKnowledgeBase();
  const { openNote } = useOpenNote();
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [targetNotebookPath, setTargetNotebookPath] = useState("");
  const [notebookInputVisible, setNotebookInputVisible] = useState(false);
  const [notebookName, setNotebookName] = useState("");
  const [creationHint, setCreationHint] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<InternalNoteDrag | null>(null);
  const pointerDragSourcePathRef = useRef<string | null>(null);
  const internalNoteDragRef = useRef<InternalNoteDrag | null>(null);
  const [importFiles, setImportFiles] = useState<string[] | null>(null);
  const treeView = selectedTagIds.length > 0 ? tree : buildNotebookTreeView(tree);

  function collectNotebookRoots(nodes: NoteTreeNode[]) {
    const notesRoot = nodes.find((node) => node.is_dir && node.path === "notes");
    return notesRoot?.children.filter((node) => node.is_dir) ?? [];
  }

  function getPreferredNotebookPath(notebooks: NoteTreeNode[]) {
    if (selectedNodePath?.startsWith("notes/")) {
      const parts = selectedNodePath.split("/");
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
    }

    return notebooks[0]?.path ?? null;
  }

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

  async function handleSelect(node: NoteTreeNode) {
    if (node.is_dir) return;
    await openNote(node.path);
  }

  function handleNewNote() {
    const notebooks = collectNotebookRoots(tree);
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
    setNotebookInputVisible(true);
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
    setNotebookInputVisible(false);
    if (!name) return;
    await createNotebook(name);
  }

  function handleNoteInputBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
      return;
    }
    void handleInputConfirm();
  }

  function handleNotebookNameBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
      return;
    }
    void handleNotebookInputConfirm();
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleInputConfirm();
    if (e.key === "Escape") setInputVisible(false);
  }

  function handleNotebookInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleNotebookInputConfirm();
    if (e.key === "Escape") setNotebookInputVisible(false);
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

  function handleDragEnterDirectory(node: NoteTreeNode, event: React.DragEvent<HTMLDivElement>) {
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

  async function handleDropOnDirectory(node: NoteTreeNode, event: React.DragEvent<HTMLDivElement>) {
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

  async function handlePointerUpOnDirectory(node: NoteTreeNode, event: React.PointerEvent<HTMLDivElement>) {
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
            onClick={handleNewNote}
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
        <div style={{ padding: "6px 8px", borderBottom: "1px solid #e0e2e7" }}>
          <input
            aria-label="笔记本名称"
            autoFocus
            value={notebookName}
            onChange={(e) => setNotebookName(e.target.value)}
            onKeyDown={handleNotebookInputKeyDown}
            onBlur={handleNotebookNameBlur}
            placeholder="笔记本名称…"
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
            {collectNotebookRoots(tree).map((notebook) => (
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
        onPointerUp={handlePointerDragEnd}
        onPointerCancel={handlePointerDragEnd}
        style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}
      >
        {treeView.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
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
          />
        ))}
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
