import { describe, expect, it } from "vitest";
import { buildNotebookTreeView } from "./notebookTree";
import type { NoteTreeNode } from "../../types";

describe("buildNotebookTreeView", () => {
  it("groups root notes under 未归档 and keeps first-level directories as notebooks", () => {
    const input: NoteTreeNode[] = [
      {
        id: null,
        name: "notes",
        path: "notes",
        is_dir: true,
        children: [
          {
            id: null,
            name: "法律",
            path: "notes/法律",
            is_dir: true,
            children: [
              {
                id: "n1",
                name: "案例.md",
                path: "notes/法律/案例.md",
                is_dir: false,
                children: [],
              },
            ],
          },
          {
            id: "n2",
            name: "我的笔记.md",
            path: "notes/我的笔记.md",
            is_dir: false,
            children: [],
          },
        ],
      },
    ];

    const view = buildNotebookTreeView(input);

    expect(view).toHaveLength(2);
    expect(view[0].name).toBe("法律");
    expect(view[0].path).toBe("notes/法律");
    expect(view[1].name).toBe("未归档");
    expect(view[1].children[0].path).toBe("notes/我的笔记.md");
  });

  it("returns the original top-level tree when notes root is absent", () => {
    const input: NoteTreeNode[] = [
      {
        id: "n1",
        name: "readme.md",
        path: "readme.md",
        is_dir: false,
        children: [],
      },
    ];

    const view = buildNotebookTreeView(input);

    expect(view).toEqual(input);
  });
});
