# Notebook Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class notebook creation and notebook-aware note creation so top-level directories under notes act as notebooks, root notes are shown as unarchived, and new notes must be created inside a notebook.

**Architecture:** Keep notebooks as a path-derived concept instead of adding a new database table. Rust owns notebook directory creation and path validation, while React adds a notebook-aware tree presentation layer plus creation flows that stop writing new notes directly into notes root.

**Tech Stack:** Tauri, Rust, React 19, TypeScript, Zustand, Vitest, React Testing Library.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-02 | v1.0 | 根据已确认的笔记本目录设计创建 implementation plan。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. Task 1: 后端新增笔记本创建能力](#2-task-1-后端新增笔记本创建能力)
- [3. Task 2: 前端接线笔记本创建 API](#3-task-2-前端接线笔记本创建-api)
- [4. Task 3: 文件树增加笔记本与未归档视图层](#4-task-3-文件树增加笔记本与未归档视图层)
- [5. Task 4: 新建笔记流程改为笔记本优先](#5-task-4-新建笔记流程改为笔记本优先)
- [6. Task 5: 总验证](#6-task-5-总验证)
- [7. 计划自检](#7-计划自检)

## 1. 文件结构

### Rust 修改

- Modify: /Users/lijun/mynote/src-tauri/src/domain/note.rs - 新增笔记本创建输入结构。
- Modify: /Users/lijun/mynote/src-tauri/src/commands/note.rs - 暴露 create_notebook command。
- Modify: /Users/lijun/mynote/src-tauri/src/services/note.rs - 实现 create_notebook_service、路径验证和测试。
- Modify: /Users/lijun/mynote/src-tauri/src/lib.rs - 注册 create_notebook command。

### 前端修改

- Modify: /Users/lijun/mynote/src/api/commands.ts - 新增 createNotebook API。
- Modify: /Users/lijun/mynote/src/hooks/useKnowledgeBase.ts - 新增 createNotebook hook。
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx - 增加新建笔记本入口、选择笔记本的新建笔记流程。
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx - 支持视图节点标签或分组展示。
- Add: /Users/lijun/mynote/src/components/LeftSidebar/notebookTree.ts - 将原始 NoteTreeNode 转换为“笔记本 + 未归档”视图树。
- Add: /Users/lijun/mynote/src/components/LeftSidebar/notebookTree.test.ts - 视图转换测试。
- Add: /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx - 文件树创建与未归档分组回归测试。

### 测试与文档

- Modify: /Users/lijun/mynote/docs/personal-knowledge-base-design.md - 将“顶层目录=笔记本仓库/笔记本”的产品定义补入正式设计文档。

## 2. Task 1: 后端新增笔记本创建能力

**Files:**
- Modify: /Users/lijun/mynote/src-tauri/src/domain/note.rs
- Modify: /Users/lijun/mynote/src-tauri/src/commands/note.rs
- Modify: /Users/lijun/mynote/src-tauri/src/services/note.rs
- Modify: /Users/lijun/mynote/src-tauri/src/lib.rs

- [ ] **Step 1: 写一个失败测试，锁定“只允许创建 notes 下一级目录”**

在 /Users/lijun/mynote/src-tauri/src/services/note.rs 的测试模块中添加：

```rust
#[test]
fn create_notebook_service_creates_top_level_notebook_under_notes_only() {
    let root = tempfile::TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("notes")).unwrap();
    let db_path = root.path().join("index.sqlite");
    let conn = crate::infrastructure::db::open_and_migrate(&db_path).unwrap();

    let created = create_notebook_in_root(root.path(), "法律").unwrap();
    assert_eq!(created, "notes/法律");
    assert!(root.path().join("notes/法律").is_dir());

    assert!(create_notebook_in_root(root.path(), "").is_err());
    assert!(create_notebook_in_root(root.path(), "法律").is_err());
    assert!(create_notebook_in_root(root.path(), "notes/二级").is_err());
    assert!(create_notebook_in_root(root.path(), "../outside").is_err());
}
```

- [ ] **Step 2: 运行单测，确认它先失败**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test create_notebook_service_creates_top_level_notebook_under_notes_only
```

Expected: FAIL with “function not found” or equivalent compile failure.

- [ ] **Step 3: 实现最小后端能力**

在 /Users/lijun/mynote/src-tauri/src/domain/note.rs 中新增输入结构：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNotebookInput {
    pub name: String,
}
```

在 /Users/lijun/mynote/src-tauri/src/services/note.rs 中实现：

```rust
pub fn create_notebook_in_root(root: &Path, name: &str) -> AppResult<String> {
    let notebook_name = safe_filename(name);
    if notebook_name.is_empty() {
        return Err(AppError::InvalidInput("Notebook name cannot be empty".into()));
    }
    if notebook_name.contains('/') || notebook_name.contains('\\') {
        return Err(AppError::InvalidInput("Notebook must be a top-level directory under notes".into()));
    }

    let rel_path = format!("notes/{}", notebook_name);
    let abs_path = resolve_kb_path(root, &rel_path)?;
    if abs_path.exists() {
        return Err(AppError::AlreadyExists(format!("Notebook already exists: {}", rel_path)));
    }

    std::fs::create_dir_all(&abs_path)?;
    Ok(rel_path)
}

pub fn create_notebook_service(state: &State<AppState>, input: CreateNotebookInput) -> AppResult<String> {
    let root_guard = state.kb_root.lock().unwrap();
    let root = root_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?;

    create_notebook_in_root(root, &input.name)
}
```

在 /Users/lijun/mynote/src-tauri/src/commands/note.rs 中新增：

```rust
#[tauri::command]
pub async fn create_notebook(
    state: State<'_, AppState>,
    name: String,
) -> Result<String, AppError> {
    create_notebook_service(&state, crate::domain::note::CreateNotebookInput { name })
}
```

并在 /Users/lijun/mynote/src-tauri/src/lib.rs 注册：

```rust
commands::note::create_notebook,
```

- [ ] **Step 4: 重跑后端窄测试**

Run:

```bash
cd /Users/lijun/mynote/src-tauri
cargo test create_notebook_service_creates_top_level_notebook_under_notes_only
```

Expected: PASS.

- [ ] **Step 5: 提交这一块**

```bash
cd /Users/lijun/mynote
git add src-tauri/src/domain/note.rs src-tauri/src/commands/note.rs src-tauri/src/services/note.rs src-tauri/src/lib.rs
git commit -m "feat(notebook): add top-level notebook creation"
```

## 3. Task 2: 前端接线笔记本创建 API

**Files:**
- Modify: /Users/lijun/mynote/src/api/commands.ts
- Modify: /Users/lijun/mynote/src/hooks/useKnowledgeBase.ts

- [ ] **Step 1: 先写一个 hook 级失败测试**

在新测试文件 /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx 中先准备一个 API mock 断言：

```tsx
it("creates a notebook through the knowledge base API and refreshes the tree", async () => {
  apiMocks.createNotebook.mockResolvedValue("notes/法律");
  apiMocks.getNoteTree.mockResolvedValue([]);
  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "新建笔记本" }));
  await user.type(screen.getByRole("textbox", { name: "笔记本名称" }), "法律");
  fireEvent.blur(screen.getByRole("textbox", { name: "笔记本名称" }));

  await waitFor(() => expect(apiMocks.createNotebook).toHaveBeenCalledWith("法律"));
});
```

- [ ] **Step 2: 运行测试，确认它先失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx -t "creates a notebook through the knowledge base API and refreshes the tree"
```

Expected: FAIL because createNotebook and the button do not exist yet.

- [ ] **Step 3: 增加最小前端 API 与 hook**

在 /Users/lijun/mynote/src/api/commands.ts 中新增：

```ts
createNotebook: (name: string) =>
  invoke<string>("create_notebook", { name }),
```

在 /Users/lijun/mynote/src/hooks/useKnowledgeBase.ts 中新增：

```ts
const createNotebook = useCallback(async (name: string) => {
  try {
    await api.createNotebook(name);
    await refreshTree();
  } catch (e) {
    console.error("Failed to create notebook:", e);
  }
}, [refreshTree]);

return { createNote, createNotebook };
```

- [ ] **Step 4: 运行同一个前端窄测试**

Run the same Vitest command.

Expected: still FAIL, but now only because FileTreePanel UI is not implemented.

- [ ] **Step 5: 提交这一块**

```bash
cd /Users/lijun/mynote
git add src/api/commands.ts src/hooks/useKnowledgeBase.ts
git commit -m "feat(notebook): wire frontend notebook creation api"
```

## 4. Task 3: 文件树增加笔记本与未归档视图层

**Files:**
- Add: /Users/lijun/mynote/src/components/LeftSidebar/notebookTree.ts
- Add: /Users/lijun/mynote/src/components/LeftSidebar/notebookTree.test.ts
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx

- [ ] **Step 1: 先写视图转换失败测试**

在 /Users/lijun/mynote/src/components/LeftSidebar/notebookTree.test.ts 中添加：

```ts
import { describe, expect, it } from "vitest";
import { buildNotebookTreeView } from "./notebookTree";

describe("buildNotebookTreeView", () => {
  it("groups root notes under 未归档 and keeps first-level directories as notebooks", () => {
    const input = [
      { id: null, name: "法律", path: "notes", is_dir: true, children: [
        { id: "n1", name: "案例.md", path: "notes/法律/案例.md", is_dir: false, children: [] },
      ] },
      { id: "n2", name: "我的笔记.md", path: "notes/我的笔记.md", is_dir: false, children: [] },
    ];

    const view = buildNotebookTreeView(input as any);

    expect(view[0].name).toBe("法律");
    expect(view[1].name).toBe("未归档");
    expect(view[1].children[0].path).toBe("notes/我的笔记.md");
  });
});
```

- [ ] **Step 2: 运行测试，确认它失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/LeftSidebar/notebookTree.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: 实现最小视图转换 helper**

在 /Users/lijun/mynote/src/components/LeftSidebar/notebookTree.ts 中新增：

```ts
import type { NoteTreeNode } from "../../types";

export function buildNotebookTreeView(tree: NoteTreeNode[]): NoteTreeNode[] {
  const notebooks = tree.filter((node) => node.is_dir);
  const rootNotes = tree.filter((node) => !node.is_dir && node.path.startsWith("notes/"));

  if (rootNotes.length === 0) {
    return notebooks;
  }

  return [
    ...notebooks,
    {
      id: null,
      name: "未归档",
      path: "notes/__unarchived__",
      is_dir: true,
      children: rootNotes,
    },
  ];
}
```

- [ ] **Step 4: 在 FileTreePanel 使用视图转换**

在 /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx 中把渲染输入改成：

```tsx
import { buildNotebookTreeView } from "./notebookTree";

const treeView = selectedTagIds.length > 0 ? tree : buildNotebookTreeView(tree);

{treeView.map((node) => (
  <FileTreeNode
    key={node.path}
    node={node}
    depth={0}
    onSelectFile={handleSelect}
    selectedPath={selectedNodePath}
  />
))}
```

并在 /Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx 中保留当前目录递归逻辑，不把“未归档”视为可选文件。

- [ ] **Step 5: 运行视图层测试**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/LeftSidebar/notebookTree.test.ts
```

Expected: PASS.

- [ ] **Step 6: 提交这一块**

```bash
cd /Users/lijun/mynote
git add src/components/LeftSidebar/notebookTree.ts src/components/LeftSidebar/notebookTree.test.ts src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreeNode.tsx
git commit -m "feat(notebook): add notebook-aware tree view"
```

## 5. Task 4: 新建笔记流程改为笔记本优先

**Files:**
- Modify: /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx
- Add: /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx
- Modify: /Users/lijun/mynote/docs/personal-knowledge-base-design.md

- [ ] **Step 1: 先写 UI 级失败测试**

在 /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx 中添加两条关键测试：

```tsx
it("shows notebook creation action beside the new note action", async () => {
  apiMocks.getNoteTree.mockResolvedValue([]);
  render(<FileTreePanel />);

  expect(await screen.findByRole("button", { name: "新建笔记本" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "新建笔记" })).toBeInTheDocument();
});

it("blocks new note creation when there is no notebook and asks the user to create one first", async () => {
  apiMocks.getNoteTree.mockResolvedValue([]);
  render(<FileTreePanel />);

  await user.click(await screen.findByRole("button", { name: "新建笔记" }));

  expect(screen.getByText("请先创建笔记本")).toBeInTheDocument();
  expect(apiMocks.createNote).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: FAIL because the notebook action and notebook-aware flow are still missing.

- [ ] **Step 3: 实现最小 UI 交互**

在 /Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx 中新增状态：

```tsx
const [notebookInputVisible, setNotebookInputVisible] = useState(false);
const [notebookName, setNotebookName] = useState("");
const [creationHint, setCreationHint] = useState<string | null>(null);
```

接入按钮：

```tsx
<button
  onClick={() => {
    setNotebookName("");
    setNotebookInputVisible(true);
    setCreationHint(null);
  }}
  aria-label="新建笔记本"
  title="新建笔记本"
>
  📁+
</button>
```

把新建笔记逻辑改为：

```tsx
function collectNotebookRoots(nodes: NoteTreeNode[]) {
  return nodes.filter((node) => node.is_dir && node.path.startsWith("notes/") && node.path.split("/").length === 2);
}

function handleNewNote() {
  const notebooks = collectNotebookRoots(buildNotebookTreeView(tree));
  if (notebooks.length === 0) {
    setCreationHint("请先创建笔记本");
    return;
  }
  setCreationHint(null);
  setInputValue("");
  setInputVisible(true);
}
```

并把确认逻辑从固定 notes 改成首个有效笔记本或当前上下文笔记本：

```tsx
function resolveTargetNotebookPath(): string | null {
  if (selectedNodePath?.startsWith("notes/")) {
    const parts = selectedNodePath.split("/");
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
  }
  const notebooks = collectNotebookRoots(buildNotebookTreeView(tree));
  return notebooks[0]?.path ?? null;
}

async function handleInputConfirm() {
  const title = inputValue.trim();
  const targetNotebook = resolveTargetNotebookPath();
  setInputVisible(false);
  if (!title || !targetNotebook) return;
  await createNote(targetNotebook, title);
}
```

同时加入笔记本输入框：

```tsx
{notebookInputVisible && (
  <input
    aria-label="笔记本名称"
    value={notebookName}
    onChange={(e) => setNotebookName(e.target.value)}
    onBlur={async () => {
      const trimmed = notebookName.trim();
      setNotebookInputVisible(false);
      if (!trimmed) return;
      await createNotebook(trimmed);
    }}
  />
)}
```

- [ ] **Step 4: 更新正式设计文档**

在 /Users/lijun/mynote/docs/personal-knowledge-base-design.md 的“知识库管理”与“文件与目录管理”段落补充：

```md
- `notes/` 作为笔记本仓库使用。
- `notes` 下的一级目录表示笔记本。
- 新建笔记默认必须归属到某个顶层笔记本。
- `notes` 根下历史遗留笔记在 UI 中归为“未归档”分组展示。
```

- [ ] **Step 5: 运行前端回归**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx src/components/LeftSidebar/notebookTree.test.ts
```

Expected: PASS.

- [ ] **Step 6: 提交这一块**

```bash
cd /Users/lijun/mynote
git add src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx src/components/LeftSidebar/notebookTree.ts src/components/LeftSidebar/notebookTree.test.ts docs/personal-knowledge-base-design.md
git commit -m "feat(notebook): require notebooks for new notes"
```

## 6. Task 5: 总验证

**Files:**
- Verify only

- [ ] **Step 1: 运行前端聚焦测试**

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx src/components/LeftSidebar/notebookTree.test.ts src/components/LeftSidebar/TagPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: 运行 Rust 聚焦测试**

```bash
cd /Users/lijun/mynote/src-tauri
cargo test create_notebook_service_creates_top_level_notebook_under_notes_only
```

Expected: PASS.

- [ ] **Step 3: 运行构建验证**

```bash
cd /Users/lijun/mynote
corepack pnpm build
```

Expected: build exits 0.

- [ ] **Step 4: 提交最终验证结果**

```bash
cd /Users/lijun/mynote
git status --short
```

Expected: only intended notebook-directory changes remain.

## 7. 计划自检

- 规格覆盖：已覆盖新建笔记本入口、顶层目录=笔记本、notes 为仓库、新建笔记必须进入笔记本、未归档分组、旧数据兼容和测试回归。
- 占位检查：计划中未使用 TBD/TODO/“后续补上”式占位描述。
- 类型一致性：后端以路径推导笔记本，不新增 notebook 表；前端以 NoteTreeNode 视图转换实现“未归档”分组，和规格一致。
