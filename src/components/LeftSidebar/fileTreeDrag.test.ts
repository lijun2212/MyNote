import { describe, expect, it } from "vitest";
import { getDropDirectoryPath, isDraggableFileNode, isDroppableDirectoryNode } from "./fileTreeDrag";
import type { NoteTreeNode } from "../../types";

function node(overrides: Partial<NoteTreeNode>): NoteTreeNode {
  return {
    id: null,
    name: "法律",
    path: "notes/法律",
    is_dir: true,
    children: [],
    ...overrides,
  };
}

describe("fileTreeDrag", () => {
  it("allows only file nodes to start dragging", () => {
    expect(
      isDraggableFileNode(
        node({ is_dir: false, path: "notes/法律/合同审查.md", name: "合同审查.md" }),
      ),
    ).toBe(true);
    expect(isDraggableFileNode(node({ is_dir: true }))).toBe(false);
  });

  it("allows only real notes directories to receive drop", () => {
    expect(isDroppableDirectoryNode(node({ path: "notes/法律", is_dir: true }))).toBe(true);
    expect(
      isDroppableDirectoryNode(node({ path: "notes/__unarchived__", name: "未归档", is_dir: true })),
    ).toBe(false);
    expect(
      isDroppableDirectoryNode(node({ path: "notes/__unarchived__/子目录", name: "子目录", is_dir: true })),
    ).toBe(false);
    expect(
      isDroppableDirectoryNode(node({ path: "notes/法律/合同审查.md", is_dir: false })),
    ).toBe(false);
  });

  it("returns the real target directory path for drop", () => {
    expect(getDropDirectoryPath(node({ path: "notes/法律/法规", name: "法规", is_dir: true }))).toBe(
      "notes/法律/法规",
    );
    expect(
      getDropDirectoryPath(node({ path: "notes/__unarchived__", name: "未归档", is_dir: true })),
    ).toBeNull();
    expect(
      getDropDirectoryPath(node({ path: "notes/__unarchived__/子目录", name: "子目录", is_dir: true })),
    ).toBeNull();
  });
});
