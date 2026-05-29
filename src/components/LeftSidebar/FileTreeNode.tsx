import { useState } from "react";
import type { NoteTreeNode } from "../../types";

interface Props {
  node: NoteTreeNode;
  depth?: number;
  onSelectFile: (node: NoteTreeNode) => void;
  selectedPath: string | null;
}

export function FileTreeNode({ node, depth = 0, onSelectFile, selectedPath }: Props) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === node.path;
  const indent = depth * 14 + 8;

  if (node.is_dir) {
    return (
      <div>
        <div
          onClick={() => setExpanded((e) => !e)}
          style={{
            paddingLeft: indent,
            paddingRight: 8,
            paddingTop: 3,
            paddingBottom: 3,
            cursor: "pointer",
            fontSize: 13,
            color: "#555",
            display: "flex",
            alignItems: "center",
            gap: 4,
            userSelect: "none",
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
          />
        ))}
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelectFile(node)}
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
