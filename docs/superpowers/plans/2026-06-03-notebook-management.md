# Notebook Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full notebook management to MyNote so top-level notebooks can be renamed, have icon/color updated, be deleted when empty, and be reordered with persisted up/down actions.

**Architecture:** Keep notebook semantics path-based and backend-owned: only `notes/<top-level-dir>` is a notebook, all filesystem changes happen in Rust, and the existing knowledge-base-level notebook metadata file remains the single persistence layer for icon, color, and order. Frontend work stays in the existing left sidebar flow by adding top-level notebook actions, thin command facades, and state refresh/sync logic after successful backend operations.

**Tech Stack:** Rust, Tauri commands, serde_json, React 19, TypeScript, Zustand, Vitest, React Testing Library, cargo test.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-03 | v1.0 | 根据已批准的 notebook management spec 创建 implementation plan。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 执行前准备](#2-执行前准备)
- [3. Task 1: 扩展 Rust notebook metadata 模型以支持顺序和记录迁移](#3-task-1-扩展-rust-notebook-metadata-模型以支持顺序和记录迁移)
- [4. Task 2: 实现后端笔记本重命名、删除与排序命令](#4-task-2-实现后端笔记本重命名删除与排序命令)
- [5. Task 3: 接线前端 API 和 knowledge base hook](#5-task-3-接线前端-api-和-knowledge-base-hook)
- [6. Task 4: 为侧栏顶级笔记本补齐管理 UI](#6-task-4-为侧栏顶级笔记本补齐管理-ui)
- [7. Task 5: 总验证](#7-task-5-总验证)
- [8. 计划自检](#8-计划自检)

## 1. 文件结构

### Rust 修改

- Modify: `/Users/lijun/mynote/src-tauri/src/services/notebook_visual.rs` - 把 notebook metadata 从仅有 icon/color 扩展为 icon/color/order，并增加 rename/delete/reorder 辅助函数与测试。
- Modify: `/Users/lijun/mynote/src-tauri/src/services/note.rs` - 实现顶级笔记本重命名、空目录删除、树排序应用、路径同步更新与测试。
- Modify: `/Users/lijun/mynote/src-tauri/src/commands/note.rs` - 暴露 notebook management commands。
- Modify: `/Users/lijun/mynote/src-tauri/src/lib.rs` - 注册新增 commands。
- Modify: `/Users/lijun/mynote/src-tauri/src/domain/note.rs` - 新增 notebook rename result / metadata contract（如果命令返回需要）。

### 前端修改

- Modify: `/Users/lijun/mynote/src/api/commands.ts` - 新增 rename/update/delete/reorder notebook API。
- Modify: `/Users/lijun/mynote/src/hooks/useKnowledgeBase.ts` - 新增 notebook management hooks，并同步当前打开笔记和选中路径。
- Modify: `/Users/lijun/mynote/src/hooks/useKnowledgeBase.test.tsx` - 验证新的 notebook management hook 合同。
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx` - 增加笔记本更多操作菜单、编辑面板、删除确认和排序动作。
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx` - 仅为顶级笔记本提供管理入口触发区。
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx` - 覆盖 UI 入口、重命名、视觉属性编辑、删除空/非空笔记本和顺序变化。
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/notebookTree.ts` - 确保顶级笔记本顺序遵循后端下发顺序，“未归档”固定末尾。
- Modify: `/Users/lijun/mynote/src/types/index.ts` - 如需补充 notebook command 返回类型。

## 2. 执行前准备

- [ ] **Step 1: Create the implementation worktree**

```bash
cd /Users/lijun/mynote
git status --short
git worktree add .worktrees/notebook-management -b feature/notebook-management
cd .worktrees/notebook-management
```

Expected: a new clean worktree exists at `.worktrees/notebook-management`.

- [ ] **Step 2: Verify the baseline before changes**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx src/hooks/useKnowledgeBase.test.tsx
corepack pnpm build
cd src-tauri
cargo test
```

Expected: targeted frontend tests pass, frontend build exits 0, and Rust tests pass before notebook management changes begin.

## 3. Task 1: 扩展 Rust notebook metadata 模型以支持顺序和记录迁移

**Files:**
- Modify: `/Users/lijun/mynote/src-tauri/src/services/notebook_visual.rs`
- Test: `/Users/lijun/mynote/src-tauri/src/services/notebook_visual.rs`

- [ ] **Step 1: Write the failing Rust tests for order persistence and metadata key migration**

In `/Users/lijun/mynote/src-tauri/src/services/notebook_visual.rs`, add these tests to the existing `#[cfg(test)]` module:

```rust
#[test]
fn save_notebook_visual_persists_order_field() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

    save_notebook_visual(root.path(), "notes/work", "idea", "cyan", Some(20)).unwrap();

    let raw = std::fs::read_to_string(root.path().join(".mynote/notebook-visuals.json")).unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["notes/work"]["order"], 20);
}

#[test]
fn rename_notebook_visual_moves_existing_record_without_losing_fields() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/source")).unwrap();
    std::fs::create_dir_all(root.path().join("notes/target")).unwrap();

    save_notebook_visual(root.path(), "notes/source", "book", "blue", Some(10)).unwrap();
    rename_notebook_visual(root.path(), "notes/source", "notes/target").unwrap();

    let visuals = load_notebook_visuals(root.path());
    assert!(visuals.get("notes/source").is_none());
    let target = visuals.get("notes/target").unwrap();
    assert_eq!(target.icon, "book");
    assert_eq!(target.color, "blue");
    assert_eq!(target.order, Some(10));
}

#[test]
fn delete_notebook_visual_removes_record() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/work")).unwrap();

    save_notebook_visual(root.path(), "notes/work", "tag", "pink", Some(30)).unwrap();
    delete_notebook_visual(root.path(), "notes/work").unwrap();

    let visuals = load_notebook_visuals(root.path());
    assert!(visuals.get("notes/work").is_none());
}
```

- [ ] **Step 2: Run the Rust tests and verify they fail**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management/src-tauri
cargo test notebook_visual
```

Expected: FAIL because `save_notebook_visual` does not accept `order` and the rename/delete helpers do not exist yet.

- [ ] **Step 3: Extend the metadata model and helper functions with minimal code**

In `/Users/lijun/mynote/src-tauri/src/services/notebook_visual.rs`, update the model and helper signatures to:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotebookVisual {
    pub icon: String,
    pub color: String,
    pub order: Option<i64>,
}

impl Default for NotebookVisual {
    fn default() -> Self {
        Self {
            icon: DEFAULT_ICON.to_string(),
            color: DEFAULT_COLOR.to_string(),
            order: None,
        }
    }
}

pub fn save_notebook_visual(
    root: &Path,
    notebook_path: &str,
    icon: &str,
    color: &str,
    order: Option<i64>,
) -> AppResult<()> {
    // existing lock + normalization
    visual_object.insert("icon".into(), Value::String(normalized.icon));
    visual_object.insert("color".into(), Value::String(normalized.color));
    match order {
        Some(value) => {
            visual_object.insert("order".into(), Value::Number(value.into()));
        }
        None => {
            visual_object.remove("order");
        }
    }
    // existing write path
}

pub fn rename_notebook_visual(root: &Path, old_path: &str, new_path: &str) -> AppResult<()> {
    let _lock = NOTEBOOK_VISUAL_SAVE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| AppError::InvalidInput(format!("Notebook visual save lock poisoned: {}", error)))?;

    let old_path = normalize_notebook_path(old_path)?;
    let new_path = normalize_notebook_path(new_path)?;
    let mut visuals = load_notebook_visuals_for_save(root)?;
    if let Some(value) = visuals.remove(&old_path) {
        visuals.insert(new_path, value);
        let content = serde_json::to_string_pretty(&visuals)
            .map_err(|error| AppError::Parse(error.to_string()))?;
        atomic_write(&notebook_visuals_path(root), &format!("{}\n", content))?;
    }
    Ok(())
}

pub fn delete_notebook_visual(root: &Path, notebook_path: &str) -> AppResult<()> {
    let _lock = NOTEBOOK_VISUAL_SAVE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| AppError::InvalidInput(format!("Notebook visual save lock poisoned: {}", error)))?;

    let notebook_path = normalize_notebook_path(notebook_path)?;
    let mut visuals = load_notebook_visuals_for_save(root)?;
    visuals.remove(&notebook_path);
    let content = serde_json::to_string_pretty(&visuals)
        .map_err(|error| AppError::Parse(error.to_string()))?;
    atomic_write(&notebook_visuals_path(root), &format!("{}\n", content))
}
```

Also extend `normalize_visual_from_value` to read `order`:

```rust
Some(NotebookVisual {
    icon: normalize_token(...),
    color: normalize_token(...),
    order: object.get("order").and_then(Value::as_i64),
})
```

- [ ] **Step 4: Re-run the Rust metadata tests**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management/src-tauri
cargo test notebook_visual
```

Expected: PASS.

- [ ] **Step 5: Commit the metadata slice**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
git add src-tauri/src/services/notebook_visual.rs
git commit -m "feat: extend notebook metadata with ordering"
```

## 4. Task 2: 实现后端笔记本重命名、删除与排序命令

**Files:**
- Modify: `/Users/lijun/mynote/src-tauri/src/services/note.rs`
- Modify: `/Users/lijun/mynote/src-tauri/src/commands/note.rs`
- Modify: `/Users/lijun/mynote/src-tauri/src/lib.rs`
- Modify: `/Users/lijun/mynote/src-tauri/src/domain/note.rs`
- Test: `/Users/lijun/mynote/src-tauri/src/services/note.rs`

- [ ] **Step 1: Write the failing Rust tests for notebook rename, empty-delete, and reorder**

In the existing test module inside `/Users/lijun/mynote/src-tauri/src/services/note.rs`, add:

```rust
#[test]
fn rename_notebook_in_root_updates_directory_and_note_paths() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();
    let note_path = root.path().join("notes/法律/案例.md");
    std::fs::write(&note_path, "# 案例\n").unwrap();

    let db_path = root.path().join("index.sqlite");
    let conn = open_and_migrate(&db_path).unwrap();
    index_note_full(&conn, root.path(), "notes/法律/案例.md", "# 案例\n").unwrap();
    save_notebook_visual(root.path(), "notes/法律", "book", "blue", Some(10)).unwrap();

    let result = rename_notebook_in_root(&conn, root.path(), "notes/法律", "法务").unwrap();

    assert_eq!(result.notebook_path, "notes/法务");
    assert!(root.path().join("notes/法务").is_dir());
    assert!(!root.path().join("notes/法律").exists());
    let moved = get_note_by_path_in_db(&conn, "notes/法务/案例.md").unwrap();
    assert_eq!(moved.path, "notes/法务/案例.md");
    let visuals = load_notebook_visuals(root.path());
    assert!(visuals.get("notes/法律").is_none());
    assert_eq!(visuals.get("notes/法务").unwrap().order, Some(10));
}

#[test]
fn delete_notebook_in_root_rejects_non_empty_directory() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/法律")).unwrap();
    std::fs::write(root.path().join("notes/法律/案例.md"), "# 案例\n").unwrap();

    let db_path = root.path().join("index.sqlite");
    let conn = open_and_migrate(&db_path).unwrap();

    let error = delete_notebook_in_root(&conn, root.path(), "notes/法律").unwrap_err();
    assert!(error.to_string().contains("Notebook is not empty"));
}

#[test]
fn reorder_notebook_visuals_updates_top_level_tree_order() {
    let root = TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes/B")).unwrap();
    std::fs::create_dir_all(root.path().join("notes/A")).unwrap();
    std::fs::create_dir_all(root.path().join("notes/C")).unwrap();

    save_notebook_visual(root.path(), "notes/A", "book", "blue", Some(20)).unwrap();
    save_notebook_visual(root.path(), "notes/B", "book", "blue", Some(10)).unwrap();
    save_notebook_visual(root.path(), "notes/C", "book", "blue", Some(30)).unwrap();

    reorder_notebooks_in_root(root.path(), &["notes/C".into(), "notes/A".into(), "notes/B".into()]).unwrap();
    let nodes = build_tree_with_visuals(root.path(), &open_and_migrate(&root.path().join("db.sqlite")).unwrap()).unwrap();
    let notes_root = nodes.iter().find(|node| node.path == "notes").unwrap();
    let ordered: Vec<String> = notes_root.children.iter().map(|node| node.path.clone()).collect();
    assert_eq!(ordered, vec!["notes/C", "notes/A", "notes/B"]);
}
```

- [ ] **Step 2: Run the Rust notebook service tests and verify they fail**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management/src-tauri
cargo test rename_notebook_in_root
cargo test delete_notebook_in_root
cargo test reorder_notebook_visuals_updates_top_level_tree_order
```

Expected: FAIL because these service functions and return contracts do not exist yet.

- [ ] **Step 3: Add minimal backend data contracts and service functions**

In `/Users/lijun/mynote/src-tauri/src/domain/note.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameNotebookResult {
    pub notebook_path: String,
    pub moved_note_paths: Vec<(String, String)>,
}
```

In `/Users/lijun/mynote/src-tauri/src/services/note.rs`, implement the helpers:

```rust
fn is_top_level_notebook_directory(path: &str) -> bool {
    let parts = path.split('/').collect::<Vec<_>>();
    parts.len() == 2 && parts[0] == "notes" && parts[1] != "__unarchived__"
}

pub fn rename_notebook_in_root(
    conn: &rusqlite::Connection,
    root: &Path,
    old_path: &str,
    new_name: &str,
) -> AppResult<RenameNotebookResult> {
    let old_path = normalize_kb_relative_path(old_path)?;
    if !is_top_level_notebook_directory(&old_path) {
        return Err(AppError::InvalidInput("Only top-level notebooks can be renamed".into()));
    }
    let new_segment = safe_filename(new_name.trim());
    if new_segment.is_empty() {
        return Err(AppError::InvalidInput("Notebook name cannot be empty".into()));
    }
    let new_path = format!("notes/{}", new_segment);
    let old_abs = resolve_kb_path(root, &old_path)?;
    let new_abs = resolve_kb_path(root, &new_path)?;
    if new_abs.exists() {
        return Err(AppError::AlreadyExists(format!("Notebook already exists: {}", new_path)));
    }

    std::fs::rename(&old_abs, &new_abs)?;
    let mut stmt = conn.prepare("SELECT path FROM notes WHERE path = ?1 OR path LIKE ?2 ORDER BY path")?;
    let old_prefix = format!("{}/%", old_path);
    let note_paths = stmt
        .query_map(params![old_path, old_prefix], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    let mut moved_note_paths = Vec::new();
    for old_note_path in note_paths {
        let suffix = old_note_path.strip_prefix(&old_path).unwrap_or("");
        let new_note_path = format!("{}{}", new_path, suffix);
        conn.execute("UPDATE notes SET path = ?1 WHERE path = ?2", params![&new_note_path, &old_note_path])?;
        moved_note_paths.push((old_note_path, new_note_path));
    }

    crate::services::notebook_visual::rename_notebook_visual(root, &old_path, &new_path)?;
    Ok(RenameNotebookResult { notebook_path: new_path, moved_note_paths })
}

pub fn delete_notebook_in_root(
    _conn: &rusqlite::Connection,
    root: &Path,
    notebook_path: &str,
) -> AppResult<()> {
    let notebook_path = normalize_kb_relative_path(notebook_path)?;
    if !is_top_level_notebook_directory(&notebook_path) {
        return Err(AppError::InvalidInput("Only top-level notebooks can be deleted".into()));
    }
    let abs = resolve_kb_path(root, &notebook_path)?;
    let mut entries = std::fs::read_dir(&abs)?;
    if entries.next().is_some() {
        return Err(AppError::InvalidInput("Notebook is not empty".into()));
    }
    std::fs::remove_dir(&abs)?;
    crate::services::notebook_visual::delete_notebook_visual(root, &notebook_path)?;
    Ok(())
}

pub fn reorder_notebooks_in_root(root: &Path, ordered_paths: &[String]) -> AppResult<()> {
    for (index, path) in ordered_paths.iter().enumerate() {
        let visuals = load_notebook_visuals(root);
        let visual = visual_for_path(&visuals, path);
        save_notebook_visual(root, path, &visual.icon, &visual.color, Some(((index + 1) * 10) as i64))?;
    }
    Ok(())
}
```

Also update the top-level tree sort in `/Users/lijun/mynote/src-tauri/src/services/note.rs` by sorting notebook children after `apply_notebook_visuals`:

```rust
fn sort_top_level_notebooks(children: &mut [NoteTreeNode]) {
    children.sort_by(|left, right| {
        let left_order = left.notebook_order.unwrap_or(i64::MAX);
        let right_order = right.notebook_order.unwrap_or(i64::MAX);
        left_order.cmp(&right_order).then_with(|| left.name.cmp(&right.name))
    });
}
```

Store `notebook_order` on `NoteTreeNode` if needed for sorting, or perform the sort using the loaded visual map before writing the values onto child nodes.

In `/Users/lijun/mynote/src-tauri/src/commands/note.rs`, expose:

```rust
#[tauri::command]
pub async fn rename_notebook(
    state: State<'_, AppState>,
    old_path: String,
    new_name: String,
) -> Result<RenameNotebookResult, AppError> { /* root + conn + call service */ }

#[tauri::command]
pub async fn update_notebook_visual(
    state: State<'_, AppState>,
    notebook_path: String,
    icon: String,
    color: String,
) -> Result<(), AppError> { /* root + call save_notebook_visual */ }

#[tauri::command]
pub async fn delete_notebook(
    state: State<'_, AppState>,
    notebook_path: String,
) -> Result<(), AppError> { /* root + conn + call service */ }

#[tauri::command]
pub async fn reorder_notebooks(
    state: State<'_, AppState>,
    ordered_paths: Vec<String>,
) -> Result<(), AppError> { /* root + call service */ }
```

Register them in `/Users/lijun/mynote/src-tauri/src/lib.rs`.

- [ ] **Step 4: Run the backend tests again**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management/src-tauri
cargo test rename_notebook_in_root
cargo test delete_notebook_in_root
cargo test reorder_notebook_visuals_updates_top_level_tree_order
cargo test
```

Expected: PASS.

- [ ] **Step 5: Commit the backend notebook management slice**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
git add src-tauri/src/domain/note.rs src-tauri/src/services/notebook_visual.rs src-tauri/src/services/note.rs src-tauri/src/commands/note.rs src-tauri/src/lib.rs
git commit -m "feat: add backend notebook management commands"
```

## 5. Task 3: 接线前端 API 和 knowledge base hook

**Files:**
- Modify: `/Users/lijun/mynote/src/api/commands.ts`
- Modify: `/Users/lijun/mynote/src/hooks/useKnowledgeBase.ts`
- Modify: `/Users/lijun/mynote/src/hooks/useKnowledgeBase.test.tsx`
- Modify: `/Users/lijun/mynote/src/types/index.ts`

- [ ] **Step 1: Write the failing hook tests for rename, visual update, delete, and reorder**

In `/Users/lijun/mynote/src/hooks/useKnowledgeBase.test.tsx`, add:

```tsx
it("renames a notebook and updates the current note path when needed", async () => {
  const refreshTree = vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({ refreshTree, selectedNodePath: "notes/法律/案例.md" });
  useEditorStore.setState({ currentNote: makeNote({ path: "notes/法律/案例.md" }), content: "content" });
  apiMocks.renameNotebook.mockResolvedValue({
    notebook_path: "notes/法务",
    moved_note_paths: [["notes/法律/案例.md", "notes/法务/案例.md"]],
  });

  const { result } = renderHook(() => useKnowledgeBase());
  await act(async () => {
    await result.current.renameNotebook("notes/法律", "法务");
  });

  expect(apiMocks.renameNotebook).toHaveBeenCalledWith("notes/法律", "法务");
  expect(useEditorStore.getState().currentNote?.path).toBe("notes/法务/案例.md");
  expect(useAppStore.getState().selectedNodePath).toBe("notes/法务/案例.md");
  expect(refreshTree).toHaveBeenCalledTimes(1);
});

it("updates notebook visuals through the api and refreshes the tree", async () => {
  const refreshTree = vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({ refreshTree });
  apiMocks.updateNotebookVisual.mockResolvedValue(undefined);

  const { result } = renderHook(() => useKnowledgeBase());
  await act(async () => {
    await result.current.updateNotebookVisual("notes/法律", "star", "orange");
  });

  expect(apiMocks.updateNotebookVisual).toHaveBeenCalledWith("notes/法律", "star", "orange");
  expect(refreshTree).toHaveBeenCalledTimes(1);
});

it("deletes an empty notebook through the api and refreshes the tree", async () => {
  const refreshTree = vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({ refreshTree, selectedNodePath: "notes/空目录" });
  apiMocks.deleteNotebook.mockResolvedValue(undefined);

  const { result } = renderHook(() => useKnowledgeBase());
  await act(async () => {
    await result.current.deleteNotebook("notes/空目录");
  });

  expect(apiMocks.deleteNotebook).toHaveBeenCalledWith("notes/空目录");
  expect(useAppStore.getState().selectedNodePath).toBeNull();
  expect(refreshTree).toHaveBeenCalledTimes(1);
});

it("reorders notebooks through the api and refreshes the tree", async () => {
  const refreshTree = vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({ refreshTree });
  apiMocks.reorderNotebooks.mockResolvedValue(undefined);

  const { result } = renderHook(() => useKnowledgeBase());
  await act(async () => {
    await result.current.reorderNotebooks(["notes/B", "notes/A"]);
  });

  expect(apiMocks.reorderNotebooks).toHaveBeenCalledWith(["notes/B", "notes/A"]);
  expect(refreshTree).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the hook tests and verify they fail**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/hooks/useKnowledgeBase.test.tsx
```

Expected: FAIL because the API mocks and hook methods do not exist yet.

- [ ] **Step 3: Add the frontend command facade and hook methods**

In `/Users/lijun/mynote/src/types/index.ts`, add:

```ts
export interface RenameNotebookResult {
  notebook_path: string;
  moved_note_paths: [string, string][];
}
```

In `/Users/lijun/mynote/src/api/commands.ts`, add:

```ts
  renameNotebook: (oldPath: string, newName: string) =>
    invoke<RenameNotebookResult>("rename_notebook", { oldPath, newName }),

  updateNotebookVisual: (notebookPath: string, icon: string, color: string) =>
    invoke<void>("update_notebook_visual", { notebookPath, icon, color }),

  deleteNotebook: (notebookPath: string) =>
    invoke<void>("delete_notebook", { notebookPath }),

  reorderNotebooks: (orderedPaths: string[]) =>
    invoke<void>("reorder_notebooks", { orderedPaths }),
```

In `/Users/lijun/mynote/src/hooks/useKnowledgeBase.ts`, add:

```ts
  const renameNotebook = useCallback(async (oldPath: string, newName: string) => {
    try {
      const result = await api.renameNotebook(oldPath, newName);
      if (currentNote?.path) {
        const match = result.moved_note_paths.find(([from]) => from === currentNote.path);
        if (match) {
          setCurrentNote({ ...currentNote, path: match[1] });
          setSelectedNodePath(match[1]);
        }
      }
      await refreshTree();
      return true;
    } catch (e) {
      console.error("Failed to rename notebook:", e);
      return false;
    }
  }, [currentNote, refreshTree, setCurrentNote, setSelectedNodePath]);

  const updateNotebookVisual = useCallback(async (notebookPath: string, icon: string, color: string) => {
    try {
      await api.updateNotebookVisual(notebookPath, icon, color);
      await refreshTree();
      return true;
    } catch (e) {
      console.error("Failed to update notebook visual:", e);
      return false;
    }
  }, [refreshTree]);

  const deleteNotebook = useCallback(async (notebookPath: string) => {
    try {
      await api.deleteNotebook(notebookPath);
      if (useAppStore.getState().selectedNodePath === notebookPath) {
        setSelectedNodePath(null);
      }
      await refreshTree();
      return true;
    } catch (e) {
      console.error("Failed to delete notebook:", e);
      return false;
    }
  }, [refreshTree, setSelectedNodePath]);

  const reorderNotebooks = useCallback(async (orderedPaths: string[]) => {
    try {
      await api.reorderNotebooks(orderedPaths);
      await refreshTree();
      return true;
    } catch (e) {
      console.error("Failed to reorder notebooks:", e);
      return false;
    }
  }, [refreshTree]);
```

Return all four methods from the hook.

- [ ] **Step 4: Re-run the hook tests**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/hooks/useKnowledgeBase.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the hook/API slice**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
git add src/types/index.ts src/api/commands.ts src/hooks/useKnowledgeBase.ts src/hooks/useKnowledgeBase.test.tsx
git commit -m "feat: wire frontend notebook management hooks"
```

## 6. Task 4: 为侧栏顶级笔记本补齐管理 UI

**Files:**
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx`
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx`
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx`
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/notebookTree.ts`

- [ ] **Step 1: Write the failing sidebar tests for notebook actions**

In `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx`, add these tests against the existing top-level notebook tree fixture:

```tsx
it("shows notebook actions only for top-level notebooks", async () => {
  const user = userEvent.setup();
  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "笔记本操作 法律" }));
  expect(screen.getByRole("menuitem", { name: "重命名笔记本" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "编辑图标和颜色" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "上移" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "下移" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "删除笔记本" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "笔记本操作 未归档" })).not.toBeInTheDocument();
});

it("renames a notebook from the action menu", async () => {
  const user = userEvent.setup();
  hookMocks.renameNotebook = vi.fn().mockResolvedValue(true);
  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "笔记本操作 法律" }));
  await user.click(screen.getByRole("menuitem", { name: "重命名笔记本" }));
  await user.clear(screen.getByRole("textbox", { name: "编辑笔记本名称" }));
  await user.type(screen.getByRole("textbox", { name: "编辑笔记本名称" }), "法务");
  await user.click(screen.getByRole("button", { name: "保存笔记本设置" }));

  await waitFor(() => expect(hookMocks.renameNotebook).toHaveBeenCalledWith("notes/法律", "法务"));
});

it("updates notebook icon and color from the action panel", async () => {
  const user = userEvent.setup();
  hookMocks.updateNotebookVisual = vi.fn().mockResolvedValue(true);
  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "笔记本操作 法律" }));
  await user.click(screen.getByRole("menuitem", { name: "编辑图标和颜色" }));
  await user.click(screen.getByRole("button", { name: "图标 星标" }));
  await user.click(screen.getByRole("button", { name: "颜色 橙色" }));
  await user.click(screen.getByRole("button", { name: "保存笔记本设置" }));

  await waitFor(() => expect(hookMocks.updateNotebookVisual).toHaveBeenCalledWith("notes/法律", "star", "orange"));
});

it("reorders notebooks with move up and move down actions", async () => {
  const user = userEvent.setup();
  hookMocks.reorderNotebooks = vi.fn().mockResolvedValue(true);
  useAppStore.setState({
    tree: [{
      id: null,
      name: "notes",
      path: "notes",
      is_dir: true,
      children: [
        { id: null, name: "A", path: "notes/A", is_dir: true, children: [] },
        { id: null, name: "B", path: "notes/B", is_dir: true, children: [] },
      ],
    }],
  });

  render(<FileTreePanel />);
  await user.click(screen.getByRole("button", { name: "笔记本操作 B" }));
  await user.click(screen.getByRole("menuitem", { name: "上移" }));

  await waitFor(() => expect(hookMocks.reorderNotebooks).toHaveBeenCalledWith(["notes/B", "notes/A"]));
});

it("shows an error hint when deleting a non-empty notebook fails", async () => {
  const user = userEvent.setup();
  hookMocks.deleteNotebook = vi.fn().mockResolvedValue(false);
  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "笔记本操作 法律" }));
  await user.click(screen.getByRole("menuitem", { name: "删除笔记本" }));
  await user.click(screen.getByRole("button", { name: "确认删除笔记本" }));

  expect(await screen.findByText("笔记本不为空，无法删除")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused sidebar test suite and verify it fails**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: FAIL because the action button, action menu, and edit/delete/reorder flows do not exist yet.

- [ ] **Step 3: Add the notebook action UI with the minimal state needed**

In `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx`, extend the hook destructure to include the new notebook methods:

```tsx
const {
  createNote,
  createNotebook,
  moveNote,
  renameNotebook,
  updateNotebookVisual,
  deleteNotebook,
  reorderNotebooks,
} = useKnowledgeBase();
```

Add local state near the existing notebook creation state:

```tsx
const [activeNotebookMenuPath, setActiveNotebookMenuPath] = useState<string | null>(null);
const [editingNotebookPath, setEditingNotebookPath] = useState<string | null>(null);
const [editingNotebookName, setEditingNotebookName] = useState("");
const [editingNotebookIcon, setEditingNotebookIcon] = useState(DEFAULT_NOTEBOOK_ICON);
const [editingNotebookColor, setEditingNotebookColor] = useState(DEFAULT_NOTEBOOK_COLOR);
const [deleteConfirmNotebookPath, setDeleteConfirmNotebookPath] = useState<string | null>(null);
const [notebookActionError, setNotebookActionError] = useState<string | null>(null);
```

Add helpers:

```tsx
function isTopLevelNotebook(node: NoteTreeNode) {
  return node.is_dir && /^notes\/[^/]+$/.test(node.path) && node.path !== "notes/__unarchived__";
}

function openNotebookEditor(node: NoteTreeNode) {
  setNotebookActionError(null);
  setEditingNotebookPath(node.path);
  setEditingNotebookName(node.name);
  setEditingNotebookIcon(node.notebook_icon ?? "folder");
  setEditingNotebookColor(node.notebook_color ?? "gray");
  setActiveNotebookMenuPath(null);
}

async function handleNotebookEditorSave() {
  if (!editingNotebookPath) return;
  const originalPath = editingNotebookPath;
  const treeNode = collectNotebookRoots(useAppStore.getState().tree).find((item) => item.path === originalPath);
  const nextName = editingNotebookName.trim();

  const renamed = treeNode?.name !== nextName
    ? await renameNotebook(originalPath, nextName)
    : true;
  if (renamed === false) return;

  const visualUpdated = await updateNotebookVisual(
    treeNode?.name !== nextName ? `notes/${nextName}` : originalPath,
    editingNotebookIcon,
    editingNotebookColor,
  );
  if (visualUpdated === false) return;

  setEditingNotebookPath(null);
}

async function handleMoveNotebook(nodePath: string, direction: "up" | "down") {
  const notebooks = buildNotebookTreeView(useAppStore.getState().tree)
    .filter(isTopLevelNotebook)
    .map((node) => node.path);
  const index = notebooks.indexOf(nodePath);
  if (index === -1) return;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= notebooks.length) return;
  const reordered = [...notebooks];
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
  await reorderNotebooks(reordered);
  setActiveNotebookMenuPath(null);
}

async function handleConfirmDeleteNotebook() {
  if (!deleteConfirmNotebookPath) return;
  const deleted = await deleteNotebook(deleteConfirmNotebookPath);
  if (deleted === false) {
    setNotebookActionError("笔记本不为空，无法删除");
    return;
  }
  setDeleteConfirmNotebookPath(null);
}
```

Render the management button and menu by passing action props into `FileTreeNode` and, for the edit panel, reuse the existing creation preset lists in a second panel that shows when `editingNotebookPath` is set. The panel should include:

```tsx
<input aria-label="编辑笔记本名称" ... />
<button type="button">保存笔记本设置</button>
<button type="button" aria-label="取消编辑笔记本">取消</button>
```

In `/Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx`, extend props with:

```tsx
showNotebookActions?: boolean;
onToggleNotebookMenu?: (node: NoteTreeNode) => void;
isNotebookMenuOpen?: boolean;
onRenameNotebook?: (node: NoteTreeNode) => void;
onEditNotebookVisual?: (node: NoteTreeNode) => void;
onMoveNotebookUp?: (node: NoteTreeNode) => void;
onMoveNotebookDown?: (node: NoteTreeNode) => void;
onDeleteNotebook?: (node: NoteTreeNode) => void;
moveUpDisabled?: boolean;
moveDownDisabled?: boolean;
```

For top-level notebook directories, render a trailing button:

```tsx
<button
  type="button"
  aria-label={`笔记本操作 ${node.name}`}
  onClick={(event) => {
    event.stopPropagation();
    onToggleNotebookMenu?.(node);
  }}
  style={{ border: "none", background: "transparent", color: "inherit", cursor: "default" }}
>
  ⋯
</button>
```

When `isNotebookMenuOpen` is true, render a small inline menu with `role="menu"` and these `role="menuitem"` buttons: `重命名笔记本`, `编辑图标和颜色`, `上移`, `下移`, `删除笔记本`.

- [ ] **Step 4: Re-run the focused sidebar tests**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the sidebar slice**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
git add src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreeNode.tsx src/components/LeftSidebar/FileTreePanel.test.tsx src/components/LeftSidebar/notebookTree.ts
git commit -m "feat: add notebook management actions to sidebar"
```

## 7. Task 5: 总验证

**Files:**
- No additional code changes expected.

- [ ] **Step 1: Run focused frontend tests**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/hooks/useKnowledgeBase.test.tsx src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the frontend build**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm build
```

Expected: Vite build exits 0.

- [ ] **Step 3: Run the Rust test suite**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management/src-tauri
cargo test
```

Expected: PASS.

- [ ] **Step 4: Commit the final verified state**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-management
git status --short
git add docs/superpowers/specs/2026-06-03-notebook-management-design.md docs/superpowers/plans/2026-06-03-notebook-management.md
git commit -m "docs: add notebook management implementation artifacts"
```

## 8. 计划自检

- Spec coverage:
  - 重命名：Task 2 backend + Task 3 hook + Task 4 UI 覆盖。
  - 编辑图标颜色：Task 1 metadata + Task 3 hook + Task 4 UI 覆盖。
  - 删除空笔记本 / 禁止非空删除：Task 2 backend tests + Task 4 UI 覆盖。
  - 上移下移排序：Task 1 order persistence + Task 2 reorder service + Task 4 UI 覆盖。
  - 未归档不参与管理：Task 4 tests 覆盖。
- Placeholder scan: no TODO/TBD placeholders intentionally left in tasks.
- Type consistency:
  - Frontend rename returns `RenameNotebookResult` with `moved_note_paths` tuples.
  - Backend order persists in `NotebookVisual.order` and frontend only drives ordered path lists.
  - Notebook management methods share boolean success signaling with the existing `createNotebook` pattern.
