# Notebook Inline Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing top-level notebook three-dot menu and multi-panel flow with direct inline actions for rename, color, reorder, and delete in the left sidebar.

**Architecture:** Keep all notebook business rules and Tauri commands unchanged. The work is a focused frontend refactor: rewrite the left-sidebar tests to describe the new interaction model, simplify FileTreeNode so notebook rows expose direct inline controls, and collapse FileTreePanel state from a menu-driven panel machine into three local inline modes: renaming, color picking, and delete confirmation.

**Tech Stack:** React 19, TypeScript, Vite, Zustand, Vitest, React Testing Library.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-03 | v1.0 | 根据已批准的 notebook inline actions spec 创建实现计划。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. 执行前准备](#2-执行前准备)
- [3. Task 1: 先把新交互写成失败测试](#3-task-1-先把新交互写成失败测试)
- [4. Task 2: 重构 FileTreeNode 为直接行内操作表面](#4-task-2-重构-filetreenode-为直接行内操作表面)
- [5. Task 3: 重构 FileTreePanel 状态与交互流](#5-task-3-重构-filetreepanel-状态与交互流)
- [6. Task 4: 聚焦验证与收尾](#6-task-4-聚焦验证与收尾)
- [7. 计划自检](#7-计划自检)

## 1. 文件结构

### 需要修改的文件

- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx` - 用新交互替换旧的三点菜单测试，先把目标行为固定住。
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx` - 去掉三点入口与方形图标展示，改为支持标题双击、色条点击、行尾直接动作和局部附属内容。
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx` - 去掉 `menu / visual / rename / delete` 面板状态机，改成行内 rename/color/delete 三种局部状态，并直接复用现有 hooks。

### 只读参考文件

- Reference: `/Users/lijun/mynote/src/hooks/useKnowledgeBase.ts` - 确认 `renameNotebook`、`updateNotebookVisual`、`deleteNotebook`、`reorderNotebooks` 继续原样复用。
- Reference: `/Users/lijun/mynote/docs/superpowers/specs/2026-06-03-notebook-inline-actions-design.md` - 实现依据。

### 不应修改的文件

- Do not modify: Rust command/service files under `/Users/lijun/mynote/src-tauri/src/**`
- Do not modify: `/Users/lijun/mynote/src/hooks/useKnowledgeBase.ts`
- Do not modify: `/Users/lijun/mynote/src/api/commands.ts`

## 2. 执行前准备

- [ ] **Step 1: Verify the current focused baseline**

Run:

```bash
cd /Users/lijun/mynote
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx src/hooks/useKnowledgeBase.test.tsx
```

Expected: all targeted frontend tests PASS before refactor starts.

- [ ] **Step 2: Re-open the approved spec before editing**

Read:

```text
/Users/lijun/mynote/docs/superpowers/specs/2026-06-03-notebook-inline-actions-design.md
```

Expected: the implementer confirms these requirements before touching code:

```text
1. No three-dot button.
2. No large multi-action panel.
3. Double-click title to rename.
4. Click accent bar to pick a color.
5. Up/down triangles reorder directly.
6. Circle-x opens lightweight local delete confirmation.
7. Notebook icon editing is removed.
```

## 3. Task 1: 先把新交互写成失败测试

**Files:**
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx`
- Test: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx`

- [ ] **Step 1: Replace the old menu-entry test with the new visibility contract**

In `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx`, replace the old `shows notebook management only for top-level notebooks` assertions with this target:

```tsx
it("shows inline notebook actions only for top-level notebooks", () => {
  useAppStore.setState({
    tree: [
      {
        id: null,
        name: "notes",
        path: "notes",
        is_dir: true,
        children: [
          {
            id: null,
            name: "项目",
            path: "notes/项目",
            is_dir: true,
            children: [
              {
                id: null,
                name: "子目录",
                path: "notes/项目/子目录",
                is_dir: true,
                children: [],
              },
            ],
          },
          {
            id: null,
            name: "未归档",
            path: "notes/__unarchived__",
            is_dir: true,
            children: [],
          },
        ],
      },
    ],
  });

  render(<FileTreePanel />);

  expect(screen.getByRole("button", { name: "上移笔记本 项目" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下移笔记本 项目" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除笔记本 项目" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "编辑笔记本颜色 项目" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "上移笔记本 子目录" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "删除笔记本 未归档" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /更多操作/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Add the failing rename interaction tests**

Add these tests in the same file:

```tsx
it("enters inline rename mode on notebook title double click and saves on Enter", async () => {
  const user = userEvent.setup();
  hookMocks.renameNotebook.mockResolvedValue({
    notebook_path: "notes/项目管理",
    moved_note_paths: [],
  });

  render(<FileTreePanel />);

  await user.dblClick(screen.getByText("法律"));

  const input = screen.getByRole("textbox", { name: "重命名笔记本 法律" });
  await user.clear(input);
  await user.type(input, "项目管理{Enter}");

  await waitFor(() => expect(hookMocks.renameNotebook).toHaveBeenCalledWith("notes/法律", "项目管理"));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "重命名笔记本 法律" })).not.toBeInTheDocument());
});

it("keeps the rename draft and error inline when renameNotebook fails", async () => {
  const user = userEvent.setup();
  hookMocks.renameNotebook.mockRejectedValue(new Error("名称已存在"));

  render(<FileTreePanel />);

  await user.dblClick(screen.getByText("法律"));

  const input = screen.getByRole("textbox", { name: "重命名笔记本 法律" });
  await user.clear(input);
  await user.type(input, "冲突名称{Enter}");

  await waitFor(() => expect(hookMocks.renameNotebook).toHaveBeenCalledWith("notes/法律", "冲突名称"));
  expect(screen.getByRole("textbox", { name: "重命名笔记本 法律" })).toHaveValue("冲突名称");
  expect(screen.getByText("名称已存在")).toBeInTheDocument();
});
```

- [ ] **Step 3: Add the failing color, delete, and reorder tests**

Add these tests:

```tsx
it("opens the inline color strip from the accent bar and saves immediately on color click", async () => {
  const user = userEvent.setup();
  hookMocks.updateNotebookVisual.mockResolvedValue(undefined);

  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "编辑笔记本颜色 法律" }));
  await user.click(screen.getByRole("button", { name: "笔记本颜色 橙色" }));

  await waitFor(() => expect(hookMocks.updateNotebookVisual).toHaveBeenCalledWith("notes/法律", "book", "orange"));
  await waitFor(() => expect(screen.queryByRole("button", { name: "笔记本颜色 橙色" })).not.toBeInTheDocument());
});

it("shows a lightweight delete confirmation inline and keeps it open on delete failure", async () => {
  const user = userEvent.setup();
  hookMocks.deleteNotebook.mockRejectedValue(new Error("只能删除空笔记本"));

  render(<FileTreePanel />);

  await user.click(screen.getByRole("button", { name: "删除笔记本 法律" }));
  expect(screen.getByText("确认删除该笔记本？")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "确认删除笔记本 法律" }));

  await waitFor(() => expect(hookMocks.deleteNotebook).toHaveBeenCalledWith("notes/法律"));
  expect(screen.getByRole("button", { name: "确认删除笔记本 法律" })).toBeInTheDocument();
  expect(screen.getByText("只能删除空笔记本")).toBeInTheDocument();
});

it("reorders notebooks directly from inline arrow buttons", async () => {
  const user = userEvent.setup();
  hookMocks.reorderNotebooks.mockResolvedValue(undefined);
  useAppStore.setState({
    tree: [
      {
        id: null,
        name: "notes",
        path: "notes",
        is_dir: true,
        children: [
          { id: null, name: "法律", path: "notes/法律", is_dir: true, children: [] },
          { id: null, name: "产品", path: "notes/产品", is_dir: true, children: [] },
          { id: null, name: "研发", path: "notes/研发", is_dir: true, children: [] },
        ],
      },
    ],
  });

  render(<FileTreePanel />);

  expect(screen.getByRole("button", { name: "上移笔记本 法律" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "下移笔记本 研发" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "上移笔记本 产品" }));
  await waitFor(() => expect(hookMocks.reorderNotebooks).toHaveBeenCalledWith([
    "notes/产品",
    "notes/法律",
    "notes/研发",
  ]));

  hookMocks.reorderNotebooks.mockClear();
  await user.click(screen.getByRole("button", { name: "下移笔记本 产品" }));
  await waitFor(() => expect(hookMocks.reorderNotebooks).toHaveBeenCalledWith([
    "notes/法律",
    "notes/研发",
    "notes/产品",
  ]));
});
```

- [ ] **Step 4: Run the focused UI test file and verify it fails for the right reason**

Run:

```bash
cd /Users/lijun/mynote
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: FAIL because the current implementation still renders the three-dot button, old rename panel, old visual panel, and old delete flow.

- [ ] **Step 5: Commit the red test slice**

```bash
cd /Users/lijun/mynote
git add src/components/LeftSidebar/FileTreePanel.test.tsx
git commit -m "test: define notebook inline actions behavior"
```

## 4. Task 2: 重构 FileTreeNode 为直接行内操作表面

**Files:**
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx`
- Test: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx`

- [ ] **Step 1: Replace the notebook action props with direct inline control props**

In `/Users/lijun/mynote/src/components/LeftSidebar/FileTreeNode.tsx`, replace the old props:

```tsx
  showNotebookActions?: boolean;
  notebookActionsOpen?: boolean;
  onToggleNotebookActions?: () => void;
  notebookActionsContent?: ReactNode;
```

with:

```tsx
  isNotebook?: boolean;
  isRenamingNotebook?: boolean;
  isPickingNotebookColor?: boolean;
  isConfirmingNotebookDelete?: boolean;
  notebookError?: string | null;
  notebookColorOptions?: ReactNode;
  notebookDeleteConfirmation?: ReactNode;
  onBeginNotebookRename?: () => void;
  onNotebookRenameChange?: (value: string) => void;
  onNotebookRenameSubmit?: () => void;
  onNotebookRenameCancel?: () => void;
  renameValue?: string;
  onNotebookColorTrigger?: () => void;
  onMoveNotebookUp?: () => void;
  onMoveNotebookDown?: () => void;
  onDeleteNotebook?: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
```

- [ ] **Step 2: Remove the square notebook icon and turn the accent bar into a button**

Inside the directory row render path, replace the old marker block and three-dot block with this structure:

```tsx
<button
  type="button"
  aria-label={`编辑笔记本颜色 ${node.name}`}
  onClick={(event) => {
    event.stopPropagation();
    onNotebookColorTrigger?.();
  }}
  style={{
    width: 10,
    height: 22,
    borderRadius: 999,
    border: "none",
    padding: 0,
    background: directoryPalette.color,
    opacity: isPickingNotebookColor ? 1 : expanded ? 0.96 : 0.72,
    cursor: isNotebook ? "pointer" : "default",
    flexShrink: 0,
  }}
/>

{isRenamingNotebook ? (
  <input
    aria-label={`重命名笔记本 ${node.name}`}
    autoFocus
    value={renameValue ?? node.name}
    onChange={(event) => onNotebookRenameChange?.(event.target.value)}
    onBlur={() => onNotebookRenameSubmit?.()}
    onKeyDown={(event) => {
      if (event.key === "Enter") onNotebookRenameSubmit?.();
      if (event.key === "Escape") onNotebookRenameCancel?.();
    }}
    onClick={(event) => event.stopPropagation()}
    style={{
      flex: 1,
      minWidth: 0,
      height: 28,
      borderRadius: 8,
      border: "1px solid #bfdbfe",
      padding: "0 10px",
      fontSize: 13,
      color: "#0f172a",
      background: "#fff",
    }}
  />
) : (
  <span
    onDoubleClick={(event) => {
      event.stopPropagation();
      onBeginNotebookRename?.();
    }}
    style={{ fontWeight: expanded ? 600 : 500 }}
  >
    {node.name}
  </span>
)}
```

- [ ] **Step 3: Render direct inline move/delete controls and local附属区域**

Replace the old right-side three-dot button region with:

```tsx
{isNotebook && (
  <>
    <button
      type="button"
      aria-label={`上移笔记本 ${node.name}`}
      disabled={disableMoveUp}
      onClick={(event) => {
        event.stopPropagation();
        onMoveNotebookUp?.();
      }}
      style={miniActionButtonStyle}
    >
      ▲
    </button>
    <button
      type="button"
      aria-label={`下移笔记本 ${node.name}`}
      disabled={disableMoveDown}
      onClick={(event) => {
        event.stopPropagation();
        onMoveNotebookDown?.();
      }}
      style={miniActionButtonStyle}
    >
      ▼
    </button>
    <button
      type="button"
      aria-label={`删除笔记本 ${node.name}`}
      onClick={(event) => {
        event.stopPropagation();
        onDeleteNotebook?.();
      }}
      style={{ ...miniActionButtonStyle, borderRadius: 999, color: "#b42318" }}
    >
      ×
    </button>
  </>
)}
```

Then replace:

```tsx
{notebookActionsContent}
```

with:

```tsx
{(notebookColorOptions || notebookDeleteConfirmation || notebookError) && (
  <div style={{ marginLeft: 10, marginRight: 8, marginTop: 6, display: "grid", gap: 6 }}>
    {notebookColorOptions}
    {notebookDeleteConfirmation}
    {notebookError ? <div style={{ fontSize: 12, color: "#b42318" }}>{notebookError}</div> : null}
  </div>
)}
```

- [ ] **Step 4: Run the focused test again to confirm the failures moved into FileTreePanel wiring**

Run:

```bash
cd /Users/lijun/mynote
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: still FAIL, but now because FileTreePanel is still passing the old props/state and not because FileTreeNode still renders the three-dot menu.

- [ ] **Step 5: Commit the FileTreeNode slice**

```bash
cd /Users/lijun/mynote
git add src/components/LeftSidebar/FileTreeNode.tsx
git commit -m "refactor: expose notebook inline controls in file tree node"
```

## 5. Task 3: 重构 FileTreePanel 状态与交互流

**Files:**
- Modify: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx`
- Test: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx`

- [ ] **Step 1: Remove the old panel state machine and replace it with focused inline states**

In `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.tsx`, delete:

```tsx
type NotebookPanelMode = "menu" | "rename" | "visual" | "delete";

type ActiveNotebookPanel = {
  path: string;
  mode: NotebookPanelMode;
};
```

and replace the related state with:

```tsx
const [renamingNotebookPath, setRenamingNotebookPath] = useState<string | null>(null);
const [colorPickerNotebookPath, setColorPickerNotebookPath] = useState<string | null>(null);
const [deleteConfirmNotebookPath, setDeleteConfirmNotebookPath] = useState<string | null>(null);
const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
const [notebookErrors, setNotebookErrors] = useState<Record<string, string | null>>({});
```

Also shrink visual state to color-only:

```tsx
const NOTEBOOK_COLOR_PRESETS = [
  { value: "blue", label: "蓝色", swatch: "#2563eb", background: "#dbeafe" },
  { value: "cyan", label: "青色", swatch: "#0891b2", background: "#cffafe" },
  { value: "green", label: "绿色", swatch: "#16a34a", background: "#dcfce7" },
  { value: "orange", label: "橙色", swatch: "#ea580c", background: "#fed7aa" },
  { value: "red", label: "红色", swatch: "#dc2626", background: "#fee2e2" },
  { value: "pink", label: "粉色", swatch: "#db2777", background: "#fce7f3" },
  { value: "brown", label: "棕色", swatch: "#92400e", background: "#ede0d4" },
  { value: "gray", label: "灰色", swatch: "#6b7280", background: "#e5e7eb" },
] as const;

const DEFAULT_NOTEBOOK_ICON = "book";
```

- [ ] **Step 2: Add the new local action helpers**

Replace `openNotebookMenu`, `openRenamePanel`, `openVisualPanel`, `openDeletePanel`, and `closeNotebookPanel` with these focused helpers:

```tsx
function beginNotebookRename(node: NoteTreeNode) {
  clearNotebookError(node.path);
  setColorPickerNotebookPath((current) => (current === node.path ? null : current));
  setDeleteConfirmNotebookPath((current) => (current === node.path ? null : current));
  setRenameDrafts((current) => ({
    ...current,
    [node.path]: current[node.path] ?? node.name,
  }));
  setRenamingNotebookPath(node.path);
}

function toggleNotebookColorPicker(path: string) {
  clearNotebookError(path);
  setRenamingNotebookPath((current) => (current === path ? null : current));
  setDeleteConfirmNotebookPath((current) => (current === path ? null : current));
  setColorPickerNotebookPath((current) => (current === path ? null : path));
}

function toggleNotebookDeleteConfirm(path: string) {
  clearNotebookError(path);
  setRenamingNotebookPath((current) => (current === path ? null : current));
  setColorPickerNotebookPath((current) => (current === path ? null : current));
  setDeleteConfirmNotebookPath((current) => (current === path ? null : path));
}

function resetNotebookInlineState(path: string) {
  setRenamingNotebookPath((current) => (current === path ? null : current));
  setColorPickerNotebookPath((current) => (current === path ? null : current));
  setDeleteConfirmNotebookPath((current) => (current === path ? null : current));
}
```

- [ ] **Step 3: Keep rename and delete handlers, but make color selection save immediately**

Update the handlers to this target form:

```tsx
async function handleRenameNotebook(node: NoteTreeNode) {
  const nextName = (renameDrafts[node.path] ?? node.name).trim();
  if (!nextName) {
    setNotebookErrors((current) => ({ ...current, [node.path]: "笔记本名称不能为空" }));
    return;
  }

  try {
    await renameNotebook(node.path, nextName);
    setRenameDrafts((current) => {
      const next = { ...current };
      delete next[node.path];
      return next;
    });
    clearNotebookError(node.path);
    resetNotebookInlineState(node.path);
  } catch (error) {
    setNotebookErrors((current) => ({
      ...current,
      [node.path]: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function handleNotebookColorSelect(node: NoteTreeNode, color: string) {
  try {
    await updateNotebookVisual(node.path, node.notebook_icon ?? DEFAULT_NOTEBOOK_ICON, color);
    clearNotebookError(node.path);
    setColorPickerNotebookPath((current) => (current === node.path ? null : current));
  } catch (error) {
    setNotebookErrors((current) => ({
      ...current,
      [node.path]: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function handleDeleteNotebook(path: string) {
  try {
    await deleteNotebook(path);
    clearNotebookError(path);
    resetNotebookInlineState(path);
  } catch (error) {
    setNotebookErrors((current) => ({
      ...current,
      [path]: error instanceof Error ? error.message : String(error),
    }));
  }
}
```

- [ ] **Step 4: Replace `renderNotebookPanel` with color-strip and delete-confirm builders**

Delete the old `renderNotebookPanel` function entirely and add these builders instead:

```tsx
function renderNotebookColorOptions(node: NoteTreeNode) {
  if (colorPickerNotebookPath !== node.path) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {NOTEBOOK_COLOR_PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          aria-label={`笔记本颜色 ${preset.label}`}
          onClick={() => void handleNotebookColorSelect(node, preset.value)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            border: "1px solid #d0d7de",
            background: preset.swatch,
            boxShadow: `0 0 0 3px ${preset.background}`,
            cursor: "pointer",
          }}
        />
      ))}
    </div>
  );
}

function renderNotebookDeleteConfirmation(node: NoteTreeNode) {
  if (deleteConfirmNotebookPath !== node.path) {
    return null;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "#475467" }}>确认删除该笔记本？</span>
      <button
        type="button"
        aria-label={`确认删除笔记本 ${node.name}`}
        onClick={() => void handleDeleteNotebook(node.path)}
        style={{
          height: 26,
          borderRadius: 999,
          border: "1px solid #f3d2cf",
          background: "#fff5f4",
          color: "#b42318",
          padding: "0 10px",
          cursor: "pointer",
        }}
      >
        删除
      </button>
      <button
        type="button"
        aria-label={`取消删除笔记本 ${node.name}`}
        onClick={() => setDeleteConfirmNotebookPath((current) => (current === node.path ? null : current))}
        style={inlineSecondaryButtonStyle}
      >
        取消
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Pass the new props into FileTreeNode and remove all old menu wiring**

In the place where `FileTreeNode` is rendered for top-level nodes, first compute the notebook order once per render:

```tsx
const topLevelNotebookPaths = treeView
  .filter((entry) => entry.is_dir && isTopLevelNotebookPath(entry.path))
  .map((entry) => entry.path);
```

Then inside the `treeView.map((node) => ...)` block, compute the current notebook index and replace the old props:

```tsx
const notebookIndex = topLevelNotebookPaths.indexOf(node.path);
```

Replace:

```tsx
showNotebookActions={isTopLevelNotebookPath(node.path)}
notebookActionsContent={renderNotebookPanel(node)}
notebookActionsOpen={activeNotebookPanel?.path === node.path}
onToggleNotebookActions={() => openNotebookMenu(node.path)}
```

with:

```tsx
isNotebook={node.is_dir && isTopLevelNotebookPath(node.path)}
isRenamingNotebook={renamingNotebookPath === node.path}
isPickingNotebookColor={colorPickerNotebookPath === node.path}
isConfirmingNotebookDelete={deleteConfirmNotebookPath === node.path}
notebookError={notebookErrors[node.path]}
notebookColorOptions={renderNotebookColorOptions(node)}
notebookDeleteConfirmation={renderNotebookDeleteConfirmation(node)}
renameValue={renameDrafts[node.path] ?? node.name}
onBeginNotebookRename={() => beginNotebookRename(node)}
onNotebookRenameChange={(value) => {
  clearNotebookError(node.path);
  setRenameDrafts((current) => ({ ...current, [node.path]: value }));
}}
onNotebookRenameSubmit={() => void handleRenameNotebook(node)}
onNotebookRenameCancel={() => resetNotebookInlineState(node.path)}
onNotebookColorTrigger={() => toggleNotebookColorPicker(node.path)}
onMoveNotebookUp={() => void handleReorderNotebook(node.path, -1)}
onMoveNotebookDown={() => void handleReorderNotebook(node.path, 1)}
onDeleteNotebook={() => toggleNotebookDeleteConfirm(node.path)}
disableMoveUp={notebookIndex <= 0}
disableMoveDown={notebookIndex < 0 || notebookIndex >= topLevelNotebookPaths.length - 1}
```

Keep `handleReorderNotebook` unchanged except for continuing to clear errors on success.

- [ ] **Step 6: Run the focused UI test file and make it pass**

Run:

```bash
cd /Users/lijun/mynote
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run the adjacent hook regression to ensure no contract drift**

Run:

```bash
cd /Users/lijun/mynote
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/hooks/useKnowledgeBase.test.tsx
```

Expected: PASS because the sidebar refactor should not change hook behavior.

- [ ] **Step 8: Commit the FileTreePanel slice**

```bash
cd /Users/lijun/mynote
git add src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx
git commit -m "refactor: switch notebook actions to inline controls"
```

## 6. Task 4: 聚焦验证与收尾

**Files:**
- Modify: none
- Test: `/Users/lijun/mynote/src/components/LeftSidebar/FileTreePanel.test.tsx`
- Test: `/Users/lijun/mynote/src/hooks/useKnowledgeBase.test.tsx`

- [ ] **Step 1: Run the combined focused frontend regression**

Run:

```bash
cd /Users/lijun/mynote
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm vitest run src/components/LeftSidebar/FileTreePanel.test.tsx src/hooks/useKnowledgeBase.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the production frontend build**

Run:

```bash
cd /Users/lijun/mynote
export PATH="$HOME/.npm-global/bin:$PATH"
corepack pnpm build
```

Expected: Vite build exits 0.

- [ ] **Step 3: Inspect the final diff for scope control**

Run:

```bash
cd /Users/lijun/mynote
git diff -- src/components/LeftSidebar/FileTreeNode.tsx src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx docs/superpowers/plans/2026-06-03-notebook-inline-actions.md
```

Expected: diff is limited to the approved inline-actions refactor and its tests.

- [ ] **Step 4: Create the final implementation commit**

```bash
cd /Users/lijun/mynote
git add src/components/LeftSidebar/FileTreeNode.tsx src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx
git commit -m "feat: redesign notebook inline actions"
```

## 7. 计划自检

### Spec coverage

- 去掉三点按钮: Task 1 失败测试固定行为，Task 2 删除入口，Task 3 去掉旧 menu wiring。
- 去掉大面板: Task 1 失败测试覆盖，Task 3 删除 `renderNotebookPanel`。
- 双击标题重命名: Task 1 写失败测试，Task 2 提供输入表面，Task 3 接线保存/取消。
- 单击竖条改颜色: Task 1 写失败测试，Task 2 把竖条做成按钮，Task 3 立即保存颜色。
- 三角排序: Task 1 写失败测试，Task 2 渲染按钮，Task 3 复用 `handleReorderNotebook`。
- 圆叉删除加轻量确认: Task 1 写失败测试，Task 2 渲染删除按钮，Task 3 渲染局部确认条。
- 不再支持图标编辑: Task 2 删除方形图标展示，Task 3 删除 visual icon state。
- 错误贴近当前 notebook 行: Task 2 增加局部错误槽位，Task 3 继续复用 `notebookErrors`。

### Placeholder scan

- Plan 中没有未解决占位词或“之后再补”的步骤描述。
- 每个代码步骤都给了明确代码片段、命令和预期结果。

### Type consistency

- `FileTreeNode` 新 props 名称与 `FileTreePanel` 传参一一对应。
- 颜色选择统一使用 `handleNotebookColorSelect(node, color)`。
- 重命名统一使用 `renamingNotebookPath` 和 `renameDrafts[path]`。
- 删除确认统一使用 `deleteConfirmNotebookPath`。
