import type { NoteTreeNode } from "../../types";

export function isDraggableFileNode(node: NoteTreeNode): boolean {
  return !node.is_dir;
}

export function isDroppableDirectoryNode(node: NoteTreeNode): boolean {
  return (
    node.is_dir
    && node.path.startsWith("notes/")
    && node.path !== "notes/__unarchived__"
    && !node.path.startsWith("notes/__unarchived__/")
  );
}

export function getDropDirectoryPath(node: NoteTreeNode): string | null {
  return isDroppableDirectoryNode(node) ? node.path : null;
}
