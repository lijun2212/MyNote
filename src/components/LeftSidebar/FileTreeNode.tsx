import { useState } from "react";
import type { NoteTreeNode } from "../../types";
import { isDraggableFileNode } from "./fileTreeDrag";

interface Props {
  node: NoteTreeNode;
  depth?: number;
  onSelectFile: (node: NoteTreeNode) => void;
  selectedPath: string | null;
  dragOverPath: string | null;
  onStartDragFile: (node: NoteTreeNode, event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnterDirectory: (node: NoteTreeNode, event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeaveDirectory: (node: NoteTreeNode) => void;
  onDropOnDirectory: (node: NoteTreeNode, event: React.DragEvent<HTMLDivElement>) => void;
}

export function FileTreeNode({
  node,
  depth = 0,
  onSelectFile,
  selectedPath,
  dragOverPath,
  onStartDragFile,
  onDragEnterDirectory,
  onDragLeaveDirectory,
  onDropOnDirectory,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === node.path;
  const indent = depth * 14 + 8;

  if (node.is_dir) {
    return (
      <div>
        <div
          onClick={() => setExpanded((e) => !e)}
          onDragEnter={(event) => onDragEnterDirectory(node, event)}
          onDragOver={(event) => onDragEnterDirectory(node, event)}
          onDragLeave={() => onDragLeaveDirectory(node)}
          onDrop={(event) => onDropOnDirectory(node, event)}
          style={{
            paddingLeft: indent,
            paddingRight: 8,
            paddingTop: 3,
            paddingBottom: 3,
            cursor: "pointer",
            fontSize: 13,
            background: dragOverPath === node.path ? "#dbeafe" : "transparent",
            color: dragOverPath === node.path ? "#1d4ed8" : "#555",
            display: "flex",
            alignItems: "center",
            gap: 4,
            userSelect: "none",
            borderRadius: 4,
          }}
        >
          <span>{expanded ? "▼" : "▶"}</span>
          <span>{node.name}</span>
        </div>
        {expanded && node.children.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onSelectFile={onSelectFile}
            selectedPath={selectedPath}
            dragOverPath={dragOverPath}
            onStartDragFile={onStartDragFile}
            onDragEnterDirectory={onDragEnterDirectory}
            onDragLeaveDirectory={onDragLeaveDirectory}
            onDropOnDirectory={onDropOnDirectory}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      draggable={isDraggableFileNode(node)}
      onClick={() => onSelectFile(node)}
      onDragStart={(event) => onStartDragFile(node, event)}
      style={{
        paddingLeft: indent,
        paddingRight: 8,
        paddingTop: 3,
        paddingBottom: 3,
        cursor: "pointer",
        fontSize: 13,
        background: isSelected ? "#dbeafe" : "transparent",
        color: isSelected ? "#1d4ed8" : "#333",
        borderRadius: 4,
        userSelect: "none",
      }}
    >
      {node.name}
    </div>
  );
}
