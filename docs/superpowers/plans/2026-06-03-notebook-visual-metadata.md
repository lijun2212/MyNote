# Notebook Visual Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add notebook icon and color selection to the notebook creation flow, persist the chosen values in a knowledge-base-level hidden metadata file, and render top-level notebooks in the sidebar with those visuals.

**Architecture:** Keep notebook structure ownership in the existing tree-building code, but introduce a separate knowledge-base-level notebook visual metadata file and a focused Rust service to read/write it. Extend the existing notebook creation command so the backend creates the directory and writes metadata in one flow, then expose the new typed fields through the existing note tree contract so the React sidebar can render them without inventing local-only state.

**Tech Stack:** Rust, serde_json, Tauri commands, React 19, TypeScript, Zustand, Vitest/React Testing Library, cargo test.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-03 | v1.0 | 根据已批准的 notebook visual metadata spec 创建 implementation plan。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 执行前准备](#2-执行前准备)
- [3. Task 1: 定义前后端视觉元数据类型合同](#3-task-1-定义前后端视觉元数据类型合同)
- [4. Task 2: 实现 Rust 元数据文件读写与容错](#4-task-2-实现-rust-元数据文件读写与容错)
- [5. Task 3: 扩展创建笔记本命令与知识库 hook](#5-task-3-扩展创建笔记本命令与知识库-hook)
- [6. Task 4: 扩展树构建结果并在侧边栏渲染](#6-task-4-扩展树构建结果并在侧边栏渲染)
- [7. Task 5: 重做新建笔记本面板 UI](#7-task-5-重做新建笔记本面板-ui)
- [8. Task 6: 总验证](#8-task-6-总验证)
- [9. 计划自检](#9-计划自检)

## 1. 文件结构

### Rust 修改

- Modify: `src-tauri/src/domain/note.rs` - 为 `CreateNotebookInput` 和 `NoteTreeNode` 增加 notebook visual fields.
- Modify: `src-tauri/src/services/note.rs` - 创建笔记本时接收 visual metadata，并在树构建时合并展示字段。
- Create: `src-tauri/src/services/notebook_visual.rs` - 知识库级隐藏元数据文件的读写、清洗、默认回退。
- Modify: `src-tauri/src/services/mod.rs` - 暴露 `notebook_visual` service。
- Modify: `src-tauri/src/commands/note.rs` - 扩展 `create_notebook` command 参数。

### 前端修改

- Modify: `src/types/index.ts` - 给 `NoteTreeNode` 增加 `notebook_icon`、`notebook_color`。
- Modify: `src/api/commands.ts` - 扩展 `createNotebook` API 参数。
- Modify: `src/hooks/useKnowledgeBase.ts` - 扩展 `createNotebook` hook 签名。
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx` - 将新建笔记本单行输入改为创建面板，管理 icon/color 选择。
- Modify: `src/components/LeftSidebar/FileTreeNode.tsx` - 渲染顶级笔记本图标和颜色。
- Modify: `src/components/LeftSidebar/notebookTree.ts` - 保证 `未归档` 不带 notebook visual metadata。

### 测试修改

- Modify: `src/hooks/useKnowledgeBase.test.tsx` - 断言 createNotebook 参数扩展。
- Modify: `src/components/LeftSidebar/FileTreePanel.test.tsx` - 面板、默认值、切换值、取消行为。
- Modify: `src-tauri/src/services/note.rs` tests - 创建笔记本时写入 visual metadata。
- Create: `src-tauri/src/services/notebook_visual.rs` tests - 文件缺失、非法记录、清理不存在目录、读写回退。

## 2. 执行前准备

Implementation should happen in an isolated worktree.

- [ ] **Step 1: Create the implementation worktree**

Run from the main repository:

```bash
cd /Users/lijun/mynote
git status --short
git worktree add .worktrees/notebook-visual-metadata -b feature/notebook-visual-metadata
cd .worktrees/notebook-visual-metadata
```

Expected: a new clean worktree exists at `.worktrees/notebook-visual-metadata`.

- [ ] **Step 2: Verify the baseline before changes**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx src/hooks/useKnowledgeBase.test.tsx
corepack pnpm build
cd src-tauri
cargo test
```

Expected: the targeted frontend tests pass, frontend build exits 0, and Rust tests pass before notebook visual changes begin.

## 3. Task 1: 定义前后端视觉元数据类型合同

**Files:**
- Modify: `src-tauri/src/domain/note.rs`
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Modify: `src/hooks/useKnowledgeBase.ts`
- Modify: `src/hooks/useKnowledgeBase.test.tsx`

- [ ] **Step 1: Write the failing frontend hook test for the expanded createNotebook signature**

In `src/hooks/useKnowledgeBase.test.tsx`, replace the existing create notebook assertion with this test body:

```ts
it("creates a notebook with icon and color metadata", async () => {
  apiMocks.createNotebook.mockResolvedValue("notes/法律");
  const { result } = renderHook(() => useKnowledgeBase());

  await act(async () => {
    await result.current.createNotebook("法律", "book", "blue");
  });

  expect(apiMocks.createNotebook).toHaveBeenCalledWith("法律", "book", "blue");
  expect(refreshTreeMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the hook test and verify it fails**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/hooks/useKnowledgeBase.test.tsx
```

Expected: FAIL because `createNotebook` still only accepts a single `name` argument.

- [ ] **Step 3: Extend shared TypeScript and Rust contracts**

In `src/types/index.ts`, update `NoteTreeNode` to:

```ts
export interface NoteTreeNode {
  id: string | null;
  name: string;
  path: string;
  is_dir: boolean;
  children: NoteTreeNode[];
  notebook_icon?: string | null;
  notebook_color?: string | null;
}
```

In `src/api/commands.ts`, change `createNotebook` to:

```ts
  createNotebook: (name: string, icon: string, color: string) =>
    invoke<string>("create_notebook", { name, icon, color }),
```

In `src/hooks/useKnowledgeBase.ts`, change the callback to:

```ts
  const createNotebook = useCallback(async (name: string, icon: string, color: string) => {
    try {
      await api.createNotebook(name, icon, color);
      await refreshTree();
    } catch (e) {
      console.error("Failed to create notebook:", e);
    }
  }, [refreshTree]);
```

In `src-tauri/src/domain/note.rs`, change the Rust structs to:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteTreeNode {
    pub id: Option<String>,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<NoteTreeNode>,
    pub notebook_icon: Option<String>,
    pub notebook_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNotebookInput {
    pub name: String,
    pub icon: String,
    pub color: String,
}
```

- [ ] **Step 4: Run the hook test again**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/hooks/useKnowledgeBase.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
git add src/types/index.ts src/api/commands.ts src/hooks/useKnowledgeBase.ts src/hooks/useKnowledgeBase.test.tsx src-tauri/src/domain/note.rs
git commit -m "feat: extend notebook contracts with visual metadata"
```

## 4. Task 2: 实现 Rust 元数据文件读写与容错

**Files:**
- Create: `src-tauri/src/services/notebook_visual.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/services/note.rs`

- [ ] **Step 1: Write the failing Rust tests for notebook visual metadata I/O**

Create `src-tauri/src/services/notebook_visual.rs` with these tests first:

```rust
#[cfg(test)]
mod tests {
    use super::{load_notebook_visuals, save_notebook_visual};
    use tempfile::TempDir;

    #[test]
    fn load_notebook_visuals_returns_empty_when_file_missing() {
        let temp_dir = TempDir::new().unwrap();
        let visuals = load_notebook_visuals(temp_dir.path()).unwrap();
        assert!(visuals.is_empty());
    }

    #[test]
    fn save_notebook_visual_persists_and_reload_filters_missing_directories() {
        let temp_dir = TempDir::new().unwrap();
        std::fs::create_dir_all(temp_dir.path().join("notes/法律")).unwrap();

        save_notebook_visual(temp_dir.path(), "notes/法律", "book", "blue").unwrap();
        save_notebook_visual(temp_dir.path(), "notes/已删除", "tag", "pink").unwrap();

        let visuals = load_notebook_visuals(temp_dir.path()).unwrap();

        assert_eq!(visuals.get("notes/法律").unwrap().icon, "book");
        assert_eq!(visuals.get("notes/法律").unwrap().color, "blue");
        assert!(visuals.get("notes/已删除").is_none());
    }
}
```

- [ ] **Step 2: Run the Rust test and verify it fails**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata/src-tauri
cargo test notebook_visual
```

Expected: FAIL because the service module and functions do not exist yet.

- [ ] **Step 3: Implement the metadata service with safe defaults**

Create `src-tauri/src/services/notebook_visual.rs` with this implementation:

```rust
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const NOTEBOOK_VISUAL_FILE: &str = ".mynote/notebook-visuals.json";
const ALLOWED_ICONS: &[&str] = &["folder", "book", "idea", "code", "list", "archive", "star", "tag"];
const ALLOWED_COLORS: &[&str] = &["blue", "cyan", "green", "orange", "red", "pink", "brown", "gray"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NotebookVisualMetadata {
    pub icon: String,
    pub color: String,
}

fn metadata_file(root: &Path) -> PathBuf {
    root.join(NOTEBOOK_VISUAL_FILE)
}

fn default_visual() -> NotebookVisualMetadata {
    NotebookVisualMetadata {
        icon: "folder".into(),
        color: "gray".into(),
    }
}

fn normalize_visual(icon: &str, color: &str) -> NotebookVisualMetadata {
    NotebookVisualMetadata {
        icon: if ALLOWED_ICONS.contains(&icon) { icon } else { "folder" }.into(),
        color: if ALLOWED_COLORS.contains(&color) { color } else { "gray" }.into(),
    }
}

pub fn load_notebook_visuals(root: &Path) -> AppResult<BTreeMap<String, NotebookVisualMetadata>> {
    let file = metadata_file(root);
    if !file.exists() {
      return Ok(BTreeMap::new());
    }

    let raw = match std::fs::read_to_string(&file) {
        Ok(value) => value,
        Err(_) => return Ok(BTreeMap::new()),
    };

    let parsed: BTreeMap<String, NotebookVisualMetadata> = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Ok(BTreeMap::new()),
    };

    Ok(parsed
        .into_iter()
        .filter(|(path, _)| root.join(path).is_dir())
        .map(|(path, metadata)| {
            let normalized = normalize_visual(&metadata.icon, &metadata.color);
            (path, normalized)
        })
        .collect())
}

pub fn save_notebook_visual(root: &Path, notebook_path: &str, icon: &str, color: &str) -> AppResult<()> {
    let file = metadata_file(root);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut visuals = load_notebook_visuals(root)?;
    visuals.insert(notebook_path.to_string(), normalize_visual(icon, color));
    let serialized = serde_json::to_string_pretty(&visuals)
        .map_err(|error| AppError::InvalidInput(error.to_string()))?;
    std::fs::write(file, serialized)?;
    Ok(())
}

pub fn visual_for_path(
    visuals: &BTreeMap<String, NotebookVisualMetadata>,
    notebook_path: &str,
) -> NotebookVisualMetadata {
    visuals.get(notebook_path).cloned().unwrap_or_else(default_visual)
}
```

Expose it from `src-tauri/src/services/mod.rs`:

```rust
pub mod notebook_visual;
```

- [ ] **Step 4: Run the Rust test again**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata/src-tauri
cargo test notebook_visual
```

Expected: PASS.

- [ ] **Step 5: Commit the metadata service slice**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
git add src-tauri/src/services/notebook_visual.rs src-tauri/src/services/mod.rs
git commit -m "feat: add notebook visual metadata service"
```

## 5. Task 3: 扩展创建笔记本命令与知识库 hook

**Files:**
- Modify: `src-tauri/src/commands/note.rs`
- Modify: `src-tauri/src/services/note.rs`
- Modify: `src-tauri/src/services/note.rs` tests

- [ ] **Step 1: Write the failing Rust service test for notebook creation with visuals**

In `src-tauri/src/services/note.rs`, add this test near the existing notebook creation tests:

```rust
#[test]
fn create_notebook_service_writes_visual_metadata() {
    let root = tempfile::TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes")).unwrap();

    let created = create_notebook_in_root(root.path(), "法律", "book", "blue").unwrap();
    assert_eq!(created, "notes/法律");

    let visuals = crate::services::notebook_visual::load_notebook_visuals(root.path()).unwrap();
    assert_eq!(visuals.get("notes/法律").unwrap().icon, "book");
    assert_eq!(visuals.get("notes/法律").unwrap().color, "blue");
}
```

- [ ] **Step 2: Run the Rust notebook creation test and verify it fails**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata/src-tauri
cargo test create_notebook_service_writes_visual_metadata
```

Expected: FAIL because `create_notebook_in_root` does not accept icon and color yet.

- [ ] **Step 3: Extend the command and service signatures**

In `src-tauri/src/commands/note.rs`, change the command to:

```rust
#[tauri::command]
pub async fn create_notebook(
    state: State<'_, AppState>,
    name: String,
    icon: String,
    color: String,
) -> Result<String, AppError> {
    create_notebook_service(&state, CreateNotebookInput { name, icon, color })
}
```

In `src-tauri/src/services/note.rs`, change notebook creation to:

```rust
pub fn create_notebook_in_root(root: &Path, name: &str, icon: &str, color: &str) -> AppResult<String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::InvalidInput("Notebook name cannot be empty".into()));
    }
    if trimmed_name == "." || trimmed_name == ".." {
        return Err(AppError::InvalidInput("Notebook name cannot be a reserved path segment".into()));
    }
    if trimmed_name.contains('/') || trimmed_name.contains('\\') {
        return Err(AppError::InvalidInput("Notebook must be a top-level directory under notes".into()));
    }

    let notebook_name = safe_filename(trimmed_name);
    let rel_path = format!("notes/{}", notebook_name);
    let abs_path = resolve_kb_path(root, &rel_path)?;
    if abs_path.exists() {
        return Err(AppError::AlreadyExists(format!("Notebook already exists: {}", rel_path)));
    }

    std::fs::create_dir_all(&abs_path)?;
    crate::services::notebook_visual::save_notebook_visual(root, &rel_path, icon, color)?;
    Ok(rel_path)
}

pub fn create_notebook_service(state: &State<AppState>, input: CreateNotebookInput) -> AppResult<String> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;

    create_notebook_in_root(root, &input.name, &input.icon, &input.color)
}
```

- [ ] **Step 4: Run the Rust notebook creation test again**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata/src-tauri
cargo test create_notebook_service_writes_visual_metadata
```

Expected: PASS.

- [ ] **Step 5: Commit the create-notebook backend slice**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
git add src-tauri/src/commands/note.rs src-tauri/src/services/note.rs
git commit -m "feat: persist notebook visuals during notebook creation"
```

## 6. Task 4: 扩展树构建结果并在侧边栏渲染

**Files:**
- Modify: `src-tauri/src/services/note.rs`
- Modify: `src/components/LeftSidebar/FileTreeNode.tsx`
- Modify: `src/components/LeftSidebar/notebookTree.ts`

- [ ] **Step 1: Write the failing sidebar render test for top-level notebook visuals**

In `src/components/LeftSidebar/FileTreePanel.test.tsx`, add this test:

```ts
it("renders notebook icon and color for top-level notebooks only", () => {
  useAppStore.setState({
    tree: [
      {
        id: null,
        name: "法律",
        path: "notes/法律",
        is_dir: true,
        notebook_icon: "book",
        notebook_color: "blue",
        children: [
          {
            id: null,
            name: "案例",
            path: "notes/法律/案例",
            is_dir: true,
            notebook_icon: null,
            notebook_color: null,
            children: [],
          },
        ],
      },
    ],
  });

  render(<FileTreePanel />);

  expect(screen.getByTestId("notebook-icon:notes/法律")).toHaveAttribute("data-icon", "book");
  expect(screen.getByTestId("notebook-icon:notes/法律")).toHaveAttribute("data-color", "blue");
  expect(screen.queryByTestId("notebook-icon:notes/法律/案例")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the sidebar test and verify it fails**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: FAIL because there is no notebook icon rendering yet.

- [ ] **Step 3: Merge metadata into top-level tree nodes in Rust**

In `src-tauri/src/services/note.rs`, update the top-level tree builder to load visuals once and attach them only to `notes/*` first-level directories:

```rust
let notebook_visuals = crate::services::notebook_visual::load_notebook_visuals(root).unwrap_or_default();
```

And when constructing each top-level `NoteTreeNode` under `notes`, use:

```rust
let visual = if is_top_level_notebook {
    Some(crate::services::notebook_visual::visual_for_path(&notebook_visuals, &node_path))
} else {
    None
};

NoteTreeNode {
    id,
    name,
    path: node_path,
    is_dir,
    children,
    notebook_icon: visual.as_ref().map(|item| item.icon.clone()),
    notebook_color: visual.as_ref().map(|item| item.color.clone()),
}
```

- [ ] **Step 4: Render notebook visuals in the sidebar node component**

In `src/components/LeftSidebar/FileTreeNode.tsx`, add a fixed preset map and top-level rendering branch similar to:

```tsx
const NOTEBOOK_COLOR_STYLES: Record<string, React.CSSProperties> = {
  blue: { color: "#2563eb" },
  cyan: { color: "#0891b2" },
  green: { color: "#16a34a" },
  orange: { color: "#ea580c" },
  red: { color: "#dc2626" },
  pink: { color: "#db2777" },
  brown: { color: "#92400e" },
  gray: { color: "#6b7280" },
};

const NOTEBOOK_ICON_GLYPHS: Record<string, string> = {
  folder: "▣",
  book: "◫",
  idea: "◌",
  code: "⟨⟩",
  list: "☰",
  archive: "▤",
  star: "★",
  tag: "⌂",
};
```

Render the top-level notebook marker as:

```tsx
{depth === 0 && node.is_dir && node.path.startsWith("notes/") && node.path !== "notes/__unarchived__" ? (
  <span
    data-testid={`notebook-icon:${node.path}`}
    data-icon={node.notebook_icon ?? "folder"}
    data-color={node.notebook_color ?? "gray"}
    style={{
      width: 18,
      display: "inline-flex",
      justifyContent: "center",
      ...NOTEBOOK_COLOR_STYLES[node.notebook_color ?? "gray"],
    }}
  >
    {NOTEBOOK_ICON_GLYPHS[node.notebook_icon ?? "folder"]}
  </span>
) : null}
```

In `src/components/LeftSidebar/notebookTree.ts`, ensure the synthetic `未归档` node is created with null visuals:

```ts
      notebook_icon: null,
      notebook_color: null,
```

- [ ] **Step 5: Run the sidebar test again**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the tree rendering slice**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
git add src-tauri/src/services/note.rs src/components/LeftSidebar/FileTreeNode.tsx src/components/LeftSidebar/notebookTree.ts src/components/LeftSidebar/FileTreePanel.test.tsx
git commit -m "feat: render notebook icons and colors in sidebar"
```

## 7. Task 5: 重做新建笔记本面板 UI

**Files:**
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
- Modify: `src/components/LeftSidebar/FileTreePanel.test.tsx`

- [ ] **Step 1: Write the failing UI tests for the notebook creation panel**

In `src/components/LeftSidebar/FileTreePanel.test.tsx`, add these tests:

```ts
it("creates a notebook with default icon and color from the creation panel", async () => {
  const user = userEvent.setup();
  hookMocks.createNotebook.mockResolvedValue(undefined);

  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "新建笔记本" }));
  expect(screen.getByRole("textbox", { name: "笔记本名称" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "图标 book" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "颜色 blue" })).toHaveAttribute("aria-pressed", "true");

  await user.type(screen.getByRole("textbox", { name: "笔记本名称" }), "法律");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(hookMocks.createNotebook).toHaveBeenCalledWith("法律", "book", "blue"));
});

it("allows changing notebook icon and color before creation and supports cancel", async () => {
  const user = userEvent.setup();

  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "新建笔记本" }));
  await user.click(screen.getByRole("button", { name: "图标 star" }));
  await user.click(screen.getByRole("button", { name: "颜色 orange" }));
  await user.click(screen.getByRole("button", { name: "取消新建笔记本" }));

  expect(screen.queryByRole("textbox", { name: "笔记本名称" })).not.toBeInTheDocument();
  expect(hookMocks.createNotebook).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the panel test and verify it fails**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: FAIL because the creation panel still only shows a single input.

- [ ] **Step 3: Replace the single notebook name input with a panel**

In `src/components/LeftSidebar/FileTreePanel.tsx`, add presets near the top:

```ts
const NOTEBOOK_ICON_OPTIONS = ["book", "folder", "idea", "code", "list", "archive", "star", "tag"] as const;
const NOTEBOOK_COLOR_OPTIONS = ["blue", "cyan", "green", "orange", "red", "pink", "brown", "gray"] as const;
const DEFAULT_NOTEBOOK_ICON = "book";
const DEFAULT_NOTEBOOK_COLOR = "blue";
```

Replace notebook local state with:

```ts
  const [notebookInputVisible, setNotebookInputVisible] = useState(false);
  const [notebookName, setNotebookName] = useState("");
  const [notebookIcon, setNotebookIcon] = useState<string>(DEFAULT_NOTEBOOK_ICON);
  const [notebookColor, setNotebookColor] = useState<string>(DEFAULT_NOTEBOOK_COLOR);
```

Reset in `handleNewNotebook`:

```ts
  function handleNewNotebook() {
    setCreationHint(null);
    setNotebookName("");
    setNotebookIcon(DEFAULT_NOTEBOOK_ICON);
    setNotebookColor(DEFAULT_NOTEBOOK_COLOR);
    setNotebookInputVisible(true);
  }
```

Update confirm logic:

```ts
  async function handleNotebookInputConfirm() {
    const name = notebookName.trim();
    if (!name) return;
    setNotebookInputVisible(false);
    await createNotebook(name, notebookIcon, notebookColor);
  }
```

Render the panel body with explicit create/cancel actions:

```tsx
      {notebookInputVisible && (
        <div style={{ padding: "10px 10px 12px", borderBottom: "1px solid #e0e2e7", display: "grid", gap: 10 }}>
          <input
            aria-label="笔记本名称"
            autoFocus
            value={notebookName}
            onChange={(e) => setNotebookName(e.target.value)}
            onKeyDown={handleNotebookInputKeyDown}
            placeholder="笔记本名称…"
            style={{ width: "100%", fontSize: 13, padding: "6px 8px", border: "1px solid #0969da", borderRadius: 6, outline: "none" }}
          />
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#667085", fontWeight: 600 }}>图标</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {NOTEBOOK_ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  aria-label={`图标 ${icon}`}
                  aria-pressed={notebookIcon === icon}
                  onClick={() => setNotebookIcon(icon)}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#667085", fontWeight: 600 }}>颜色</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {NOTEBOOK_COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`颜色 ${color}`}
                  aria-pressed={notebookColor === color}
                  onClick={() => setNotebookColor(color)}
                >
                  {color}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" aria-label="取消新建笔记本" onClick={() => setNotebookInputVisible(false)}>取消</button>
            <button type="button" aria-label="确认新建笔记本" onClick={() => void handleNotebookInputConfirm()}>创建</button>
          </div>
        </div>
      )}
```

Update keyboard handling:

```ts
  function handleNotebookInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") void handleNotebookInputConfirm();
    if (e.key === "Escape") setNotebookInputVisible(false);
  }
```

- [ ] **Step 4: Run the panel test again**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the creation panel slice**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
git add src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx
git commit -m "feat: add notebook visual selection to create panel"
```

## 8. Task 6: 总验证

**Files:**
- Modify: none
- Test: `src/components/LeftSidebar/FileTreePanel.test.tsx`
- Test: `src/hooks/useKnowledgeBase.test.tsx`
- Test: `src-tauri/src/services/notebook_visual.rs`
- Test: `src-tauri/src/services/note.rs`

- [ ] **Step 1: Run focused frontend tests**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx src/hooks/useKnowledgeBase.test.tsx
```

Expected: all targeted frontend tests pass.

- [ ] **Step 2: Run focused Rust tests**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata/src-tauri
cargo test notebook_visual
cargo test create_notebook_service_writes_visual_metadata
```

Expected: both focused Rust slices pass.

- [ ] **Step 3: Run the frontend build**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm build
```

Expected: build exits 0.

- [ ] **Step 4: Run full Rust test suite**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata/src-tauri
cargo test
```

Expected: full Rust suite exits 0.

- [ ] **Step 5: Commit the final verification point**

```bash
cd /Users/lijun/mynote/.worktrees/notebook-visual-metadata
git status --short
```

Expected: only the planned notebook visual metadata files are modified; no unexpected files remain.

## 9. 计划自检

### Spec coverage

- 知识库级集中元数据文件：Task 2.
- 创建时选择图标和颜色：Task 5.
- 顶级笔记本侧边栏渲染：Task 4.
- 元数据缺失/损坏/不存在目录回退：Task 2 + Task 4.
- 当前阶段不支持后续编辑：计划未包含任何编辑入口，符合 spec。

### Placeholder scan

- 所有任务都包含明确文件路径。
- 所有代码步骤都给出具体代码片段。
- 所有验证步骤都给出明确命令与预期结果。

### Type consistency

- `createNotebook(name, icon, color)` 在 API、hook、command、service 四层保持一致。
- `notebook_icon` / `notebook_color` 在 Rust `NoteTreeNode` 与 TypeScript `NoteTreeNode` 中保持一致。