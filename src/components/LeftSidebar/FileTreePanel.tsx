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

export function FileTreePanel() {
  const tree = useAppStore((s) => s.tree);
  const selectedNodePath = useAppStore((s) => s.selectedNodePath);
  const selectedTagIds = useAppStore((s) => s.selectedTagIds);
  const setTree = useAppStore((s) => s.setTree);
  const refreshTree = useAppStore((s) => s.refreshTree);
  const { createNote } = useKnowledgeBase();
  const { openNote } = useOpenNote();
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [importFiles, setImportFiles] = useState<string[] | null>(null);

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
    setInputValue("");
    setInputVisible(true);
  }

  async function handleInputConfirm() {
    const title = inputValue.trim();
    setInputVisible(false);
    if (!title) return;
    await createNote("notes", title);
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleInputConfirm();
    if (e.key === "Escape") setInputVisible(false);
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
            style={{ fontSize: 14, background: "none", border: "none", cursor: "pointer", lineHeight: 1, color: "#555", padding: "2px 4px" }}
            title="导入 Markdown 文件"
          >
            ↓
          </button>
          <button
            onClick={handleNewNote}
            style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer", lineHeight: 1, color: "#555", padding: "0 2px" }}
            title="新建笔记"
          >
            +
          </button>
        </div>
      </div>
      {inputVisible && (
        <div style={{ padding: "6px 8px", borderBottom: "1px solid #e0e2e7" }}>
          <input
            autoFocus
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputConfirm}
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
        {tree.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            onSelectFile={handleSelect}
            selectedPath={selectedNodePath}
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
