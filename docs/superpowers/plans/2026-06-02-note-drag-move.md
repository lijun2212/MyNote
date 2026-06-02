# Note Drag Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a note file in the left tree to be dragged into any real notebook directory under notes, with backend-owned renaming on collisions and a tree refresh after the move.

**Architecture:** Keep drag-and-drop state in the React file tree and keep file movement in Rust. The backend validates paths, performs filesystem moves, reindexes the moved note, and returns the final Note; the frontend only determines whether a node is draggable/droppable, invokes the move API on drop, refreshes the tree, and if the moved note is the current note, synchronizes its path in store without reopening the editor tab.

**Tech Stack:** Tauri, Rust, React 19, TypeScript, Zustand, Vitest, React Testing Library.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-02 | v1.0 | 根据已确认的文章拖拽移动设计创建 implementation plan。 |
| 2026-06-02 | v1.1 | 完成实现与回归，补充当前打开文章移动后的路径同步说明。 |

## 目录

1. 文件结构
2. Task 1: 后端移动文章能力
3. Task 2: 前端接线 moveNote API
4. Task 3: 文件树拖拽判定层
5. Task 4: 文件树拖拽交互接线
6. Task 5: 总验证
7. 计划自检

## 1. 文件结构

### Rust 修改

- Modify: /Users/lijun/mynote/src-tauri/src/commands/note.rs - 暴露 move_note command。
- Modify: /Users/lijun/mynote/src-tauri/src/services/note.rs - 实现移动文件、自动重命名、更新索引、清理旧路径，并补测试。

### 前端修改

- Modify: /Users/lijun/mynote/src/api/commands.ts - 新增 moveNote API。
- Modify: /Users/lijun/mynote/src/hooks/useKnowledgeBase.ts - 新增 moveNote hook。
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx - 为文件节点增加 dragstart，为目录节点增加 dragenter/dragover/dragleave/drop。
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx - 接线 moveNote、刷新树、管理拖拽高亮状态。
- Add: /Users/lijun/mynote/src/components/LeftSidebar/fileTreeDrag.ts - 拖拽判定与目标目录解析的纯函数层。
- Add: /Users/lijun/mynote/src/components/LeftSidebar/fileTreeDrag.test.ts - 拖拽判定纯函数测试。
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx - 覆盖拖拽 drop 调用 moveNote、未归档不可放置等场景。

## 2. Task 1: 后端移动文章能力

**Files:**
- Modify: /Users/lijun/mynote/src-tauri/src/commands/note.rs
- Modify: /Users/lijun/mynote/src-tauri/src/services/note.rs

- [x] **Step 1: 先写 Rust 失败测试，锁定“移动到目录 + 同名自动重命名 + 同目录 no-op”**

在 /Users/lijun/mynote/src-tauri/src/services/note.rs 的测试模块中添加最小帮助函数和以下测试：

```rust
#[test]
fn move_note_in_root_moves_note_into_target_directory() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
    std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();

    let src_rel = "notes/source/合同审查.md";
    let src_abs = root.path().join(src_rel);
    std::fs::write(&src_abs, "---\ntitle: 合同审查\n---\n\n# 合同审查\n").unwrap();

    let db_path = root.path().join("index.sqlite");
    let conn = open_and_migrate(&db_path).unwrap();
    let original = index_note_full(&conn, root.path(), src_rel, &std::fs::read_to_string(&src_abs).unwrap()).unwrap();

    let moved = move_note_in_root(&conn, root.path(), &original.path, "notes/法律").unwrap();
    assert_eq!(moved.path, "notes/法律/合同审查.md");
    assert!(root.path().join("notes/法律/合同审查.md").exists());
    assert!(!root.path().join(src_rel).exists());
}

#[test]
fn move_note_in_root_renames_when_target_has_same_filename() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
    std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();

    let src_rel = "notes/source/合同审查.md";
    let src_abs = root.path().join(src_rel);
    std::fs::write(&src_abs, "---\ntitle: 合同审查\n---\n\n# 合同审查\n").unwrap();
    std::fs::write(root.path().join("notes/法律/合同审查.md"), "# existing\n").unwrap();

    let db_path = root.path().join("index.sqlite");
    let conn = open_and_migrate(&db_path).unwrap();
    let original = index_note_full(&conn, root.path(), src_rel, &std::fs::read_to_string(&src_abs).unwrap()).unwrap();

    let moved = move_note_in_root(&conn, root.path(), &original.path, "notes/法律").unwrap();
    assert_eq!(moved.path, "notes/法律/合同审查-1.md");
}

#[test]
fn move_note_in_root_is_noop_when_note_already_in_target_directory() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();

    let src_rel = "notes/法律/合同审查.md";
    let src_abs = root.path().join(src_rel);
    std::fs::write(&src_abs, "---\ntitle: 合同审查\n---\n\n# 合同审查\n").unwrap();

    let db_path = root.path().join("index.sqlite");
    let conn = open_and_migrate(&db_path).unwrap();
    let original = index_note_full(&conn, root.path(), src_rel, &std::fs::read_to_string(&src_abs).unwrap()).unwrap();

    let moved = move_note_in_root(&conn, root.path(), &original.path, "notes/法律").unwrap();
    assert_eq!(moved.path, original.path);
}
```

- [x] **Step 2: 运行后端窄测试，确认它先失败**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test move_note_in_root
```

Expected: FAIL with “function not found” or equivalent compile failure.

- [x] **Step 3: 实现最小后端能力**

在 /Users/lijun/mynote/src-tauri/src/services/note.rs 中新增目标路径解析和移动实现：

```rust
fn next_available_note_path(root: &Path, target_dir: &str, filename: &str) -> AppResult<String> {
    let target_rel = format!("{}/{}", target_dir, filename);
    if !resolve_kb_path(root, &target_rel)?.exists() {
        return Ok(target_rel);
    }

    let stem = Path::new(filename)
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid filename: {}", filename)))?;
    let ext = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("md");

    let mut index = 1;
    loop {
        let candidate = format!("{}/{}-{}.{}", target_dir, stem, index, ext);
        if !resolve_kb_path(root, &candidate)?.exists() {
            return Ok(candidate);
        }
        index += 1;
    }
}

pub fn move_note_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    source_path: &str,
    target_directory: &str,
) -> AppResult<Note> {
    let source_rel = normalize_kb_relative_path(source_path)?;
    let target_dir = normalize_kb_relative_path(target_directory)?;
    let source_abs = resolve_kb_path(root, &source_rel)?;
    let target_abs = resolve_kb_path(root, &target_dir)?;

    if !source_abs.exists() {
        return Err(AppError::NotFound(format!("Source note not found: {}", source_rel)));
    }
    if !target_abs.is_dir() || !target_dir.starts_with("notes/") {
        return Err(AppError::InvalidInput(format!("Invalid target directory: {}", target_dir)));
    }

    let current_dir = Path::new(&source_rel)
        .parent()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid source path: {}", source_rel)))?;
    if current_dir == target_dir {
        return get_note_by_path_service_inner(conn, root, &source_rel);
    }

    let filename = Path::new(&source_rel)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::InvalidInput(format!("Invalid source path: {}", source_rel)))?;
    let final_rel = next_available_note_path(root, &target_dir, filename)?;
    let final_abs = resolve_kb_path(root, &final_rel)?;

    std::fs::rename(&source_abs, &final_abs)?;
    conn.execute("DELETE FROM notes WHERE path = ?1", params![&source_rel])?;
    let content = std::fs::read_to_string(&final_abs)?;
    index_note_full(conn, root, &final_rel, &content)
}
```

在 /Users/lijun/mynote/src-tauri/src/commands/note.rs 中新增 command：

```rust
#[tauri::command]
pub async fn move_note(
    state: State<'_, AppState>,
    source_path: String,
    target_directory: String,
) -> Result<Note, AppError> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
        .clone();
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    move_note_in_root(conn, &root, &source_path, &target_directory)
}
```

并在 /Users/lijun/mynote/src-tauri/src/lib.rs 注册：

```rust
commands::note::move_note,
```

- [x] **Step 4: 重跑后端测试，确认通过**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test move_note_in_root
cargo test services::note::tests
```

Expected: PASS.

## 3. Task 2: 前端接线 moveNote API

**Files:**
- Modify: /Users/lijun/mynote/src/api/commands.ts
- Modify: /Users/lijun/mynote/src/hooks/useKnowledgeBase.ts
- Test: /Users/lijun/mynote/src/hooks/useKnowledgeBase.test.tsx

- [x] **Step 1: 先写 hook 级失败测试**

在 /Users/lijun/mynote/src/hooks/useKnowledgeBase.test.tsx 中追加：

```tsx
it("moves a note through the api and refreshes the tree", async () => {
  const refreshTree = vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({ refreshTree });
  apiMocks.moveNote.mockResolvedValue(makeNote({ path: "notes/法律/合同审查.md" }));

  const { result } = renderHook(() => useKnowledgeBase());

  await act(async () => {
    await result.current.moveNote("notes/source/合同审查.md", "notes/法律");
  });

  expect(apiMocks.moveNote).toHaveBeenCalledWith("notes/source/合同审查.md", "notes/法律");
  expect(refreshTree).toHaveBeenCalledTimes(1);
  expect(openNoteMock).not.toHaveBeenCalled();
});
```

- [x] **Step 2: 运行单测，确认先失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/hooks/useKnowledgeBase.test.tsx
```

Expected: FAIL because moveNote does not exist yet.

- [x] **Step 3: 实现最小 API 和 hook**

在 /Users/lijun/mynote/src/api/commands.ts 中新增：

```ts
  moveNote: (sourcePath: string, targetDirectory: string) =>
    invoke<Note>("move_note", { sourcePath, targetDirectory }),
```

在 /Users/lijun/mynote/src/hooks/useKnowledgeBase.ts 中新增：

```ts
  const moveNote = useCallback(async (sourcePath: string, targetDirectory: string) => {
    try {
      await api.moveNote(sourcePath, targetDirectory);
      await refreshTree();
    } catch (e) {
      console.error("Failed to move note:", e);
    }
  }, [refreshTree]);

  return { createNote, createNotebook, moveNote };
```

- [x] **Step 4: 重跑 hook 测试，确认通过**

Run the same Vitest command.

Expected: PASS.

## 4. Task 3: 文件树拖拽判定层

**Files:**
- Add: /Users/lijun/mynote/src/components/LeftSidebar/fileTreeDrag.ts
- Add: /Users/lijun/mynote/src/components/LeftSidebar/fileTreeDrag.test.ts

- [x] **Step 1: 先写纯函数失败测试**

创建 /Users/lijun/mynote/src/components/LeftSidebar/fileTreeDrag.test.ts：

```ts
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
    expect(isDraggableFileNode(node({ is_dir: false, path: "notes/法律/合同审查.md", name: "合同审查.md" }))).toBe(true);
    expect(isDraggableFileNode(node({ is_dir: true }))).toBe(false);
  });

  it("allows only real notes directories to receive drop", () => {
    expect(isDroppableDirectoryNode(node({ path: "notes/法律", is_dir: true }))).toBe(true);
    expect(isDroppableDirectoryNode(node({ path: "notes/__unarchived__", name: "未归档", is_dir: true }))).toBe(false);
    expect(isDroppableDirectoryNode(node({ path: "notes/法律/合同审查.md", is_dir: false }))).toBe(false);
  });

  it("returns the real target directory path for drop", () => {
    expect(getDropDirectoryPath(node({ path: "notes/法律/法规", name: "法规", is_dir: true }))).toBe("notes/法律/法规");
    expect(getDropDirectoryPath(node({ path: "notes/__unarchived__", name: "未归档", is_dir: true }))).toBeNull();
  });
});
```

- [x] **Step 2: 运行单测，确认先失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/LeftSidebar/fileTreeDrag.test.ts
```

Expected: FAIL because the helper file does not exist yet.

- [x] **Step 3: 实现最小纯函数层**

创建 /Users/lijun/mynote/src/components/LeftSidebar/fileTreeDrag.ts：

```ts
import type { NoteTreeNode } from "../../types";

export function isDraggableFileNode(node: NoteTreeNode): boolean {
  return !node.is_dir;
}

export function isDroppableDirectoryNode(node: NoteTreeNode): boolean {
  return node.is_dir && node.path.startsWith("notes/") && node.path !== "notes/__unarchived__";
}

export function getDropDirectoryPath(node: NoteTreeNode): string | null {
  return isDroppableDirectoryNode(node) ? node.path : null;
}
```

- [x] **Step 4: 重跑纯函数测试，确认通过**

Run the same Vitest command.

Expected: PASS.

## 5. Task 4: 文件树拖拽交互接线

**Files:**
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx

- [x] **Step 1: 先写组件级失败测试**

在 /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx 中追加：

```tsx
it("moves a note when a file is dropped onto a notebook directory", async () => {
  hookMocks.moveNote.mockResolvedValue(undefined);

  render(<FileTreePanel />);

  const fileNode = screen.getByText("案例.md");
  const notebookNode = screen.getByText("法律");

  fireEvent.dragStart(fileNode, {
    dataTransfer: {
      setData: vi.fn(),
      effectAllowed: "",
    },
  });

  fireEvent.dragOver(notebookNode, {
    dataTransfer: {
      dropEffect: "",
    },
  });
  fireEvent.drop(notebookNode, {
    dataTransfer: {
      getData: () => "notes/法律/案例.md",
    },
  });

  await waitFor(() => expect(hookMocks.moveNote).toHaveBeenCalledWith("notes/法律/案例.md", "notes/法律"));
});

it("does not move a note when dropped on 未归档", async () => {
  render(<FileTreePanel />);

  const unarchivedNode = screen.getByText("未归档");
  fireEvent.drop(unarchivedNode, {
    dataTransfer: {
      getData: () => "notes/我的笔记.md",
    },
  });

  expect(hookMocks.moveNote).not.toHaveBeenCalled();
});
```

并让 hook mock 返回：

```tsx
useKnowledgeBase: () => ({
  createNote: hookMocks.createNote,
  createNotebook: hookMocks.createNotebook,
  moveNote: hookMocks.moveNote,
}),
```

- [x] **Step 2: 运行组件测试，确认先失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: FAIL because drag handlers do not exist yet.

- [x] **Step 3: 在 FileTreeNode 中加入拖拽接口**

将 /Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx 扩展为接收：

```tsx
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
```

目录节点增加：

```tsx
onDragEnter={(event) => onDragEnterDirectory(node, event)}
onDragOver={(event) => onDragEnterDirectory(node, event)}
onDragLeave={() => onDragLeaveDirectory(node)}
onDrop={(event) => onDropOnDirectory(node, event)}
```

文件节点增加：

```tsx
draggable={isDraggableFileNode(node)}
onDragStart={(event) => onStartDragFile(node, event)}
```

目录高亮样式：

```tsx
background: dragOverPath === node.path ? "#dbeafe" : "transparent",
color: dragOverPath === node.path ? "#1d4ed8" : "#555",
```

- [x] **Step 4: 在 FileTreePanel 中接线拖拽状态和 moveNote**

在 /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx 中新增：

```tsx
const { createNote, createNotebook, moveNote } = useKnowledgeBase();
const [dragOverPath, setDragOverPath] = useState<string | null>(null);

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
```

渲染 FileTreeNode 时传入这些 props。

- [x] **Step 5: 重跑组件测试，确认通过**

Run the same Vitest command.

Expected: PASS.

## 6. Task 5: 总验证

**Files:**
- Modify: /Users/lijun/mynote/src/hooks/useKnowledgeBase.test.tsx
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx
- Add: /Users/lijun/mynote/src/components/LeftSidebar/fileTreeDrag.test.ts
- Modify: /Users/lijun/mynote/src-tauri/src/services/note.rs

- [x] **Step 1: 跑本次前端相关测试集合**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/hooks/useKnowledgeBase.test.tsx src/components/LeftSidebar/fileTreeDrag.test.ts src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: PASS.

- [x] **Step 2: 跑本次后端相关测试集合**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test services::note::tests
```

Expected: PASS.

- [x] **Step 3: 静态诊断本次改动文件**

Check:

```text
/Users/lijun/mynote/src/api/commands.ts
/Users/lijun/mynote/src/hooks/useKnowledgeBase.ts
/Users/lijun/mynote/src/hooks/useKnowledgeBase.test.tsx
/Users/lijun/mynote/src/components/LeftSidebar/fileTreeDrag.ts
/Users/lijun/mynote/src/components/LeftSidebar/fileTreeDrag.test.ts
/Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx
/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx
/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx
/Users/lijun/mynote/src-tauri/src/commands/note.rs
/Users/lijun/mynote/src-tauri/src/services/note.rs
```

Expected: no new errors.

## 7. 计划自检

- Spec coverage: 已覆盖拖拽对象、可放置目标、未归档排除、同名自动重命名、同目录 no-op、后端索引更新、前端 drop 调用 moveNote 并刷新树。
- Outcome note: 额外修正了“移动当前打开文章后仍持有旧 path”的前端状态偏差；现在只同步 store 中的 note path 与选中路径，不重新打开编辑页。
- Placeholder scan: 计划中的每个任务都给出了明确文件、示例代码和验证命令，没有保留 TBD/TODO。
- Type consistency: 前端 API 使用 `moveNote(sourcePath, targetDirectory)`，后端 command 使用 `move_note(source_path, target_directory)`，返回 `Note`；与现有 `api/commands.ts`、`useKnowledgeBase.ts` 和 `Note` 类型一致。