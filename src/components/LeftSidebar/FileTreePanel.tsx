import { useEffect, useState } from "react";
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
  }

  function handleDragEnterDirectory(node: NoteTreeNode, event: React.DragEvent<HTMLDivElement>) {
    const targetDirectory = getDropDirectoryPath(node);
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
    if (!targetDirectory) return;

    event.preventDefault();
    const sourcePath = event.dataTransfer.getData("text/plain").trim();
    if (!sourcePath) return;
    await moveNote(sourcePath, targetDirectory);
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
      <div style={{ flex: 1, overflowY: "auto", paddingTop: 4 }}>
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
    </div>
  );
}
