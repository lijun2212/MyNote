import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { useKnowledgeBase } from "../../hooks/useKnowledgeBase";
import { FileTreeNode } from "./FileTreeNode";
import { api } from "../../api/commands";
import type { NoteTreeNode } from "../../types";

export function FileTreePanel() {
  const { tree, selectedNodePath, setSelectedNodePath } = useAppStore();
  const { setCurrentNote, setContent } = useEditorStore();
  const { createNote } = useKnowledgeBase();

  async function handleSelect(node: NoteTreeNode) {
    if (node.is_dir) return;
    setSelectedNodePath(node.path);
    try {
      const detail = await api.getNoteByPath(node.path);
      setCurrentNote(detail.note);
      setContent(detail.content);
    } catch (e) {
      console.error("Failed to open note:", e);
    }
  }

  async function handleNewNote() {
    const title = prompt("笔记标题：");
    if (!title) return;
    await createNote("notes", title);
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
        <button
          onClick={handleNewNote}
          style={{ fontSize: 18, background: "none", border: "none", cursor: "pointer", lineHeight: 1, color: "#555" }}
          title="新建笔记"
        >
          +
        </button>
      </div>
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
    </div>
  );
}
