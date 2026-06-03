import type { NoteTreeNode } from "../../types";

function cloneNode(node: NoteTreeNode): NoteTreeNode {
  return {
    ...node,
    children: node.children.map(cloneNode),
  };
}

export function buildNotebookTreeView(tree: NoteTreeNode[]): NoteTreeNode[] {
  const notesRoot = tree.find((node) => node.is_dir && node.path === "notes");
  if (!notesRoot) {
    return tree.map(cloneNode);
  }

  const notebooks = notesRoot.children
    .filter((child) => child.is_dir)
    .map(cloneNode);
  const unarchivedNotes = notesRoot.children
    .filter((child) => !child.is_dir)
    .map(cloneNode);

  if (unarchivedNotes.length > 0) {
    notebooks.push({
      id: null,
      name: "未归档",
      path: "notes/__unarchived__",
      is_dir: true,
      notebook_icon: null,
      notebook_color: null,
      children: unarchivedNotes,
    });
  }

  return notebooks;
}
