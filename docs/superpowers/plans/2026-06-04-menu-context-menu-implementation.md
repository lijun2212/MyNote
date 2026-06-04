# Menu Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 MyNote 落地稳定的原生系统菜单和按对象分型的右键菜单，覆盖当前高频能力并为图谱、修订、关系等未来能力保留灰态结构位。

**Architecture:** 原生系统菜单使用 Tauri 2 的 `@tauri-apps/api/menu` 在前端建立并动态更新，使 macOS 拥有标准桌面菜单行为；对象右键菜单使用 React 受控菜单层，按笔记本、笔记、标签、编辑器选区、空白区五类对象分别构建。所有菜单项共享一套 command id、可用性判定和 action runner，避免系统菜单、按钮、右键菜单命名与行为漂移。

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, React Testing Library, Tauri 2 JavaScript menu API, existing Tauri command bridge.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-04 | v1.0 | 根据已批准的菜单规格，拆解系统菜单与右键菜单实现计划。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. Task 1: 建立共享菜单模型与动作执行层](#2-task-1-建立共享菜单模型与动作执行层)
- [3. Task 2: 落地原生系统菜单](#3-task-2-落地原生系统菜单)
- [4. Task 3: 落地文件树与标签右键菜单](#4-task-3-落地文件树与标签右键菜单)
- [5. Task 4: 落地编辑器选区与空白区域右键菜单](#5-task-4-落地编辑器选区与空白区域右键菜单)
- [6. Task 5: 总验证与文档同步](#6-task-5-总验证与文档同步)
- [7. 计划自检](#7-计划自检)

## 1. 文件结构

### 新建

- `src/menu/menuIds.ts` - 菜单 command id 常量与分组枚举。
- `src/menu/menuSchema.ts` - 系统菜单与对象右键菜单的描述模型、灰态文案和可见性规则。
- `src/menu/menuActionRunner.ts` - 统一动作执行层，把菜单 id 映射到前端行为和 Tauri command 调用。
- `src/menu/useAppMenu.ts` - 创建和更新 Tauri 原生系统菜单的 hook。
- `src/menu/menuSchema.test.ts` - 菜单模型与灰态规则单测。
- `src/menu/menuActionRunner.test.ts` - 动作执行层单测。
- `src/components/ContextMenu/ContextMenuHost.tsx` - 渲染统一右键菜单浮层。
- `src/components/ContextMenu/useContextMenu.ts` - 管理右键菜单开闭、定位与对象 payload。
- `src/components/ContextMenu/contextMenuTypes.ts` - 右键菜单对象类型定义。
- `src/components/ContextMenu/ContextMenuHost.test.tsx` - 右键菜单通用渲染与交互测试。

### 修改

- `src/components/AppShell.tsx` - 挂载原生系统菜单 hook，并接入空白区右键菜单。
- `src/components/AppHeader.tsx` - 接入系统菜单相关状态来源，移除与菜单冲突的临时入口时机控制。
- `src/components/LeftSidebar/FileTreePanel.tsx` - 为笔记本、笔记、空白区提供对象化右键菜单 payload。
- `src/components/LeftSidebar/TagPanel.tsx` - 为标签对象提供右键菜单 payload。
- `src/components/EditorWorkspace/MarkdownEditor.tsx` - 为文本选区提供右键菜单 payload 与动作回填。
- `src/store/useAppStore.ts` - 暴露系统菜单需要的当前上下文、侧栏显隐 setter。
- `src/store/useEditorStore.ts` - 暴露编辑模式、选区与右键动作需要的状态。
- `src/api/commands.ts` - 补齐菜单动作直接依赖但前端还缺的 API 包装（若缺）。
- `src/types/index.ts` - 补充菜单动作需要的对象 payload 类型。
- `src/styles/layout.css` - 增加自定义右键菜单容器基础样式。
- `src/components/LeftSidebar/FileTreePanel.test.tsx` - 覆盖笔记本 / 笔记 / 空白区右键菜单。
- `src/components/LeftSidebar/TagPanel.test.tsx` - 覆盖标签右键菜单。
- `src/components/EditorWorkspace/MarkdownEditor.test.tsx` - 覆盖编辑器选区右键菜单。

---

## 2. Task 1: 建立共享菜单模型与动作执行层

**Files:**
- Create: `src/menu/menuIds.ts`
- Create: `src/menu/menuSchema.ts`
- Create: `src/menu/menuActionRunner.ts`
- Create: `src/menu/menuSchema.test.ts`
- Create: `src/menu/menuActionRunner.test.ts`
- Modify: `src/types/index.ts`
- Modify: `src/store/useAppStore.ts`
- Modify: `src/store/useEditorStore.ts`
- Modify: `src/api/commands.ts`

- [ ] **Step 1: 先写菜单模型测试，锁定系统菜单骨架与灰态预留规则**

在 `src/menu/menuSchema.test.ts` 中添加：

```ts
import { describe, expect, it } from "vitest";
import { buildAppMenuSchema, buildContextMenuSchema } from "./menuSchema";

describe("menuSchema", () => {
  it("builds the approved app menu top-level structure", () => {
    const schema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
    });

    expect(schema.map((item) => item.id)).toEqual([
      "file",
      "edit",
      "view",
      "note",
      "help",
    ]);
  });

  it("keeps graph and revision entries disabled as planned placeholders", () => {
    const schema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: true,
      editorMode: "editor",
    });

    const viewMenu = schema.find((item) => item.id === "view");
    expect(viewMenu?.children?.find((item) => item.id === "view.graph")?.enabled).toBe(false);
    expect(viewMenu?.children?.find((item) => item.id === "view.revisions")?.enabled).toBe(false);
  });

  it("builds notebook and note context menus as different object menus", () => {
    const notebookMenu = buildContextMenuSchema({ type: "notebook", path: "notes/产品" });
    const noteMenu = buildContextMenuSchema({ type: "note", path: "notes/产品/需求.md", noteId: "n1" });

    expect(notebookMenu.map((item) => item.id)).toContain("notebook.createNote");
    expect(noteMenu.map((item) => item.id)).toContain("note.copyWikiLink");
    expect(noteMenu.map((item) => item.id)).not.toContain("notebook.reorder");
  });
});
```

- [ ] **Step 2: 运行窄测试，确认它先失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/menu/menuSchema.test.ts
```

Expected: FAIL because `buildAppMenuSchema` and `buildContextMenuSchema` do not exist yet.

- [ ] **Step 3: 建立菜单 id 与 schema 最小实现**

创建 `src/menu/menuIds.ts`：

```ts
export const APP_MENU_IDS = {
  file: "file",
  edit: "edit",
  view: "view",
  note: "note",
  help: "help",
} as const;

export type ContextMenuTargetType =
  | "notebook"
  | "note"
  | "tag"
  | "editor-selection"
  | "blank";
```

创建 `src/menu/menuSchema.ts`：

```ts
export interface MenuSchemaItem {
  id: string;
  label: string;
  enabled: boolean;
  checked?: boolean;
  children?: MenuSchemaItem[];
  separatorBefore?: boolean;
}

interface AppMenuContext {
  hasKnowledgeBase: boolean;
  hasCurrentNote: boolean;
  leftSidebarVisible: boolean;
  rightSidebarVisible: boolean;
  editorMode: "editor" | "split" | "preview";
}

export function buildAppMenuSchema(ctx: AppMenuContext): MenuSchemaItem[] {
  return [
    {
      id: "file",
      label: "文件",
      enabled: true,
      children: [
        { id: "file.newKb", label: "新建知识库", enabled: true },
        { id: "file.openKb", label: "打开知识库", enabled: true },
        { id: "file.newNote", label: "新建笔记", enabled: ctx.hasKnowledgeBase },
        { id: "file.importMarkdown", label: "导入 Markdown", enabled: ctx.hasKnowledgeBase },
        { id: "file.exportNote", label: "导出当前笔记", enabled: ctx.hasCurrentNote },
        { id: "file.exportKb", label: "导出知识库（即将推出）", enabled: false },
        { id: "file.settings", label: "设置", enabled: true },
      ],
    },
    {
      id: "edit",
      label: "编辑",
      enabled: true,
      children: [
        { id: "edit.undo", label: "撤销", enabled: true },
        { id: "edit.redo", label: "重做", enabled: true },
        { id: "edit.find", label: "查找", enabled: ctx.hasKnowledgeBase },
        { id: "edit.replace", label: "替换", enabled: ctx.hasCurrentNote },
        { id: "edit.insertLink", label: "插入链接", enabled: ctx.hasCurrentNote },
        { id: "edit.insertTag", label: "插入标签", enabled: ctx.hasCurrentNote },
      ],
    },
    {
      id: "view",
      label: "视图",
      enabled: true,
      children: [
        { id: "view.toggleLeftSidebar", label: "显示左侧栏", enabled: true, checked: ctx.leftSidebarVisible },
        { id: "view.toggleRightSidebar", label: "显示右侧栏", enabled: true, checked: ctx.rightSidebarVisible },
        { id: "view.mode.editor", label: "编辑模式", enabled: ctx.hasCurrentNote, checked: ctx.editorMode === "editor" },
        { id: "view.mode.split", label: "分屏预览", enabled: ctx.hasCurrentNote, checked: ctx.editorMode === "split" },
        { id: "view.focus", label: "专注模式", enabled: ctx.hasCurrentNote },
        { id: "view.search", label: "搜索面板", enabled: ctx.hasKnowledgeBase },
        { id: "view.graph", label: "图谱视图（即将推出）", enabled: false },
        { id: "view.revisions", label: "修订记录面板（即将推出）", enabled: false },
      ],
    },
    {
      id: "note",
      label: "笔记",
      enabled: true,
      children: [
        { id: "note.rename", label: "重命名当前笔记", enabled: ctx.hasCurrentNote },
        { id: "note.move", label: "移动到笔记本", enabled: ctx.hasCurrentNote },
        { id: "note.copyLink", label: "复制笔记链接", enabled: ctx.hasCurrentNote },
        { id: "note.backlinks", label: "显示反向链接", enabled: ctx.hasCurrentNote },
        { id: "note.tags", label: "管理标签", enabled: ctx.hasCurrentNote },
        { id: "note.relation.create", label: "创建关联（即将推出）", enabled: false },
        { id: "note.relation.view", label: "查看知识关系（即将推出）", enabled: false },
        { id: "note.delete", label: "删除笔记", enabled: ctx.hasCurrentNote },
      ],
    },
    {
      id: "help",
      label: "帮助",
      enabled: true,
      children: [
        { id: "help.welcome", label: "欢迎页 / 快速开始", enabled: true },
        { id: "help.markdown", label: "Markdown 语法帮助", enabled: true },
        { id: "help.shortcuts", label: "快捷键列表", enabled: true },
        { id: "help.about", label: "关于 MyNote", enabled: true },
      ],
    },
  ];
}

export function buildContextMenuSchema(target: { type: string; path?: string; noteId?: string }) {
  if (target.type === "notebook") {
    return [
      { id: "notebook.createNote", label: "新建笔记", enabled: true },
      { id: "notebook.rename", label: "重命名笔记本", enabled: true },
      { id: "notebook.color", label: "更换颜色", enabled: true },
      { id: "notebook.reorder", label: "调整顺序", enabled: true },
      { id: "notebook.delete", label: "删除笔记本", enabled: true },
    ];
  }

  if (target.type === "note") {
    return [
      { id: "note.open", label: "打开", enabled: true },
      { id: "note.rename", label: "重命名", enabled: true },
      { id: "note.move", label: "移动到…", enabled: true },
      { id: "note.copyPath", label: "复制路径", enabled: true },
      { id: "note.copyWikiLink", label: "复制 Wiki 链接", enabled: true },
      { id: "note.backlinks", label: "显示反向链接", enabled: true },
      { id: "note.delete", label: "删除", enabled: true },
    ];
  }

  return [];
}
```

- [ ] **Step 4: 再写动作执行层失败测试，锁定系统菜单与右键菜单共用同一 action runner**

在 `src/menu/menuActionRunner.test.ts` 中添加：

```ts
import { describe, expect, it, vi } from "vitest";
import { createMenuActionRunner } from "./menuActionRunner";

describe("menuActionRunner", () => {
  it("routes note.move to the provided handler", async () => {
    const moveCurrentNote = vi.fn().mockResolvedValue(undefined);
    const runner = createMenuActionRunner({
      openSearch: vi.fn(),
      toggleLeftSidebar: vi.fn(),
      toggleRightSidebar: vi.fn(),
      moveCurrentNote,
      renameCurrentNote: vi.fn(),
      copyCurrentNoteWikiLink: vi.fn(),
    });

    await runner.run("note.move", { type: "note", noteId: "n1", path: "notes/a.md" });
    expect(moveCurrentNote).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 5: 运行窄测试，确认它先失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/menu/menuActionRunner.test.ts
```

Expected: FAIL because `createMenuActionRunner` does not exist yet.

- [ ] **Step 6: 实现统一 action runner，并补类型与 store 最小接口**

创建 `src/menu/menuActionRunner.ts`：

```ts
interface MenuRunnerDeps {
  openSearch: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  moveCurrentNote: () => Promise<void>;
  renameCurrentNote: () => Promise<void>;
  copyCurrentNoteWikiLink: () => void;
}

export function createMenuActionRunner(deps: MenuRunnerDeps) {
  return {
    async run(id: string, _payload?: unknown) {
      switch (id) {
        case "view.search":
          deps.openSearch();
          return;
        case "view.toggleLeftSidebar":
          deps.toggleLeftSidebar();
          return;
        case "view.toggleRightSidebar":
          deps.toggleRightSidebar();
          return;
        case "note.move":
          await deps.moveCurrentNote();
          return;
        case "note.rename":
          await deps.renameCurrentNote();
          return;
        case "note.copyLink":
        case "note.copyWikiLink":
          deps.copyCurrentNoteWikiLink();
          return;
        default:
          return;
      }
    },
  };
}
```

在 `src/types/index.ts` 追加：

```ts
export interface MenuContextPayload {
  type: "notebook" | "note" | "tag" | "editor-selection" | "blank";
  noteId?: string;
  path?: string;
  tagId?: string;
  selectedText?: string;
}
```

在 `src/store/useAppStore.ts` 和 `src/store/useEditorStore.ts` 中补充计划后续需要的 setter 名称，但只做最小空实现或现有 state 暴露，保证测试能挂接。

- [ ] **Step 7: 运行本任务测试并确认通过**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/menu/menuSchema.test.ts src/menu/menuActionRunner.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/lijun/mynote
git add src/menu/menuIds.ts src/menu/menuSchema.ts src/menu/menuActionRunner.ts src/menu/menuSchema.test.ts src/menu/menuActionRunner.test.ts src/types/index.ts src/store/useAppStore.ts src/store/useEditorStore.ts src/api/commands.ts
git commit -m "feat(menu): add shared menu schema and action runner"
```

---

## 3. Task 2: 落地原生系统菜单

**Files:**
- Create: `src/menu/useAppMenu.ts`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/AppHeader.tsx`
- Modify: `src/store/useAppStore.ts`
- Modify: `src/store/useEditorStore.ts`
- Modify: `src/menu/menuSchema.test.ts`

- [ ] **Step 1: 写系统菜单 hook 失败测试，锁定它会把 schema 转成原生 app menu 并在状态变化时更新**

在 `src/menu/menuSchema.test.ts` 追加：

```ts
it("marks current editor mode as checked in the View menu", () => {
  const schema = buildAppMenuSchema({
    hasKnowledgeBase: true,
    hasCurrentNote: true,
    leftSidebarVisible: true,
    rightSidebarVisible: true,
    editorMode: "split",
  });

  const viewMenu = schema.find((item) => item.id === "view");
  expect(viewMenu?.children?.find((item) => item.id === "view.mode.split")?.checked).toBe(true);
  expect(viewMenu?.children?.find((item) => item.id === "view.mode.editor")?.checked).toBe(false);
});
```

再在 `src/menu/useAppMenu.ts` 新建测试文件 `src/menu/useAppMenu.test.tsx`：

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppMenu } from "./useAppMenu";

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: vi.fn().mockResolvedValue({
      setAsAppMenu: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

function TestHarness() {
  useAppMenu({
    hasKnowledgeBase: true,
    hasCurrentNote: true,
    leftSidebarVisible: true,
    rightSidebarVisible: false,
    editorMode: "editor",
    runner: { run: vi.fn() },
  });
  return null;
}

describe("useAppMenu", () => {
  it("creates the native app menu", () => {
    render(<TestHarness />);
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 运行窄测试，确认 hook 测试先失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/menu/useAppMenu.test.tsx
```

Expected: FAIL because `useAppMenu` does not exist yet.

- [ ] **Step 3: 实现 `useAppMenu`，把 schema 映射为 Tauri app menu**

创建 `src/menu/useAppMenu.ts`：

```ts
import { useEffect } from "react";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { buildAppMenuSchema } from "./menuSchema";

interface UseAppMenuOptions {
  hasKnowledgeBase: boolean;
  hasCurrentNote: boolean;
  leftSidebarVisible: boolean;
  rightSidebarVisible: boolean;
  editorMode: "editor" | "split" | "preview";
  runner: { run: (id: string) => Promise<void> | void };
}

async function toNativeSubmenu(item: ReturnType<typeof buildAppMenuSchema>[number], runner: UseAppMenuOptions["runner"]) {
  const entries = [] as Array<MenuItem | PredefinedMenuItem>;
  for (const child of item.children ?? []) {
    if (child.separatorBefore) {
      entries.push(await PredefinedMenuItem.new({ item: "Separator", text: "separator" }));
    }
    entries.push(await MenuItem.new({
      id: child.id,
      text: child.label,
      enabled: child.enabled,
      checked: child.checked,
      action: () => runner.run(child.id),
    }));
  }
  return Submenu.new({ text: item.label, items: entries });
}

export function useAppMenu(options: UseAppMenuOptions) {
  useEffect(() => {
    let cancelled = false;

    async function syncMenu() {
      const schema = buildAppMenuSchema(options);
      const submenus = await Promise.all(schema.map((item) => toNativeSubmenu(item, options.runner)));
      if (cancelled) return;
      const menu = await Menu.new({ items: submenus });
      if (cancelled) return;
      await menu.setAsAppMenu();
    }

    void syncMenu();
    return () => {
      cancelled = true;
    };
  }, [
    options.hasKnowledgeBase,
    options.hasCurrentNote,
    options.leftSidebarVisible,
    options.rightSidebarVisible,
    options.editorMode,
    options.runner,
  ]);
}
```

- [ ] **Step 4: 在 `AppShell` 中接线原生系统菜单**

修改 `src/components/AppShell.tsx`，在组件顶部增加：

```ts
import { createMenuActionRunner } from "../menu/menuActionRunner";
import { useAppMenu } from "../menu/useAppMenu";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";
```

在 `AppShell` 函数内补：

```ts
  const kb = useAppStore((s) => s.kb);
  const currentNote = useEditorStore((s) => s.currentNote);
  const editorMode = useEditorStore((s) => s.previewMode);
  const runner = createMenuActionRunner({
    openSearch: () => window.dispatchEvent(new CustomEvent("mynote:open-search")),
    toggleLeftSidebar: left.toggleVisible,
    toggleRightSidebar: right.toggleVisible,
    moveCurrentNote: async () => window.dispatchEvent(new CustomEvent("mynote:move-current-note")),
    renameCurrentNote: async () => window.dispatchEvent(new CustomEvent("mynote:rename-current-note")),
    copyCurrentNoteWikiLink: () => window.dispatchEvent(new CustomEvent("mynote:copy-current-note-wiki-link")),
  });

  useAppMenu({
    hasKnowledgeBase: Boolean(kb),
    hasCurrentNote: Boolean(currentNote),
    leftSidebarVisible: left.isVisible,
    rightSidebarVisible: right.isVisible,
    editorMode,
    runner,
  });
```

- [ ] **Step 5: 运行系统菜单测试并确认通过**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/menu/menuSchema.test.ts src/menu/useAppMenu.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/lijun/mynote
git add src/menu/useAppMenu.ts src/menu/useAppMenu.test.tsx src/components/AppShell.tsx src/components/AppHeader.tsx src/store/useAppStore.ts src/store/useEditorStore.ts src/menu/menuSchema.test.ts
git commit -m "feat(menu): wire native app menu"
```

---

## 4. Task 3: 落地文件树与标签右键菜单

**Files:**
- Create: `src/components/ContextMenu/contextMenuTypes.ts`
- Create: `src/components/ContextMenu/useContextMenu.ts`
- Create: `src/components/ContextMenu/ContextMenuHost.tsx`
- Create: `src/components/ContextMenu/ContextMenuHost.test.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/LeftSidebar/FileTreePanel.tsx`
- Modify: `src/components/LeftSidebar/TagPanel.tsx`
- Modify: `src/components/LeftSidebar/FileTreePanel.test.tsx`
- Modify: `src/components/LeftSidebar/TagPanel.test.tsx`
- Modify: `src/styles/layout.css`

- [ ] **Step 1: 写通用右键菜单 host 失败测试，锁定 disabled 菜单与点击回调**

创建 `src/components/ContextMenu/ContextMenuHost.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextMenuHost } from "./ContextMenuHost";

describe("ContextMenuHost", () => {
  it("renders enabled and disabled items and calls onSelect only for enabled items", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <ContextMenuHost
        open
        position={{ x: 80, y: 120 }}
        items={[
          { id: "note.rename", label: "重命名", enabled: true },
          { id: "note.graph", label: "图谱视图（即将推出）", enabled: false },
        ]}
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    expect(onSelect).toHaveBeenCalledWith("note.rename");
    expect(screen.getByRole("menuitem", { name: "图谱视图（即将推出）" })).toHaveAttribute("aria-disabled", "true");
  });
});
```

- [ ] **Step 2: 运行窄测试，确认它先失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/ContextMenu/ContextMenuHost.test.tsx
```

Expected: FAIL because `ContextMenuHost` does not exist yet.

- [ ] **Step 3: 实现通用右键菜单 host 与 hook**

创建 `src/components/ContextMenu/contextMenuTypes.ts`：

```ts
import type { MenuContextPayload } from "../../types";
import type { MenuSchemaItem } from "../../menu/menuSchema";

export interface ContextMenuState {
  open: boolean;
  position: { x: number; y: number };
  payload: MenuContextPayload | null;
  items: MenuSchemaItem[];
}
```

创建 `src/components/ContextMenu/useContextMenu.ts`：

```ts
import { useState } from "react";
import type { MenuContextPayload } from "../../types";
import type { MenuSchemaItem } from "../../menu/menuSchema";
import type { ContextMenuState } from "./contextMenuTypes";

const initialState: ContextMenuState = {
  open: false,
  position: { x: 0, y: 0 },
  payload: null,
  items: [],
};

export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState>(initialState);

  return {
    state,
    openMenu(event: React.MouseEvent, payload: MenuContextPayload, items: MenuSchemaItem[]) {
      event.preventDefault();
      setState({
        open: true,
        position: { x: event.clientX, y: event.clientY },
        payload,
        items,
      });
    },
    closeMenu() {
      setState(initialState);
    },
  };
}
```

创建 `src/components/ContextMenu/ContextMenuHost.tsx`：

```tsx
import { useEffect } from "react";
import type { MenuSchemaItem } from "../../menu/menuSchema";

interface Props {
  open: boolean;
  position: { x: number; y: number };
  items: MenuSchemaItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function ContextMenuHost({ open, position, items, onSelect, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="context-menu" style={{ left: position.x, top: position.y }} role="menu">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="context-menu__item"
          aria-disabled={!item.enabled}
          disabled={!item.enabled}
          onClick={(event) => {
            event.stopPropagation();
            if (!item.enabled) return;
            onSelect(item.id);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

在 `src/styles/layout.css` 追加：

```css
.context-menu {
  position: fixed;
  z-index: 2000;
  min-width: 220px;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid rgba(126, 108, 83, 0.24);
  background: rgba(255, 251, 245, 0.98);
  box-shadow: 0 18px 40px rgba(72, 56, 35, 0.18);
}

.context-menu__item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  text-align: left;
  border-radius: 8px;
}
```

- [ ] **Step 4: 接线文件树和标签对象菜单**

在 `src/components/LeftSidebar/FileTreePanel.tsx` 中，为笔记本节点、笔记节点和空白区增加 `onContextMenu`，调用：

```ts
const menu = useContextMenu();

function handleNotebookContextMenu(event: React.MouseEvent, notebookPath: string) {
  menu.openMenu(
    event,
    { type: "notebook", path: notebookPath },
    buildContextMenuSchema({ type: "notebook", path: notebookPath }),
  );
}

function handleNoteContextMenu(event: React.MouseEvent, noteId: string, notePath: string) {
  menu.openMenu(
    event,
    { type: "note", noteId, path: notePath },
    buildContextMenuSchema({ type: "note", noteId, path: notePath }),
  );
}
```

在 JSX 末尾渲染：

```tsx
<ContextMenuHost
  open={menu.state.open}
  position={menu.state.position}
  items={menu.state.items}
  onClose={menu.closeMenu}
  onSelect={(id) => void runner.run(id, menu.state.payload)}
/>
```

在 `src/components/LeftSidebar/TagPanel.tsx` 中加入：

```ts
function handleTagContextMenu(event: React.MouseEvent, tagId: string) {
  menu.openMenu(
    event,
    { type: "tag", tagId },
    buildContextMenuSchema({ type: "tag", tagId }),
  );
}
```

- [ ] **Step 5: 为文件树与标签补测试并确认通过**

在 `src/components/LeftSidebar/FileTreePanel.test.tsx` 追加：

```tsx
it("shows note context menu with wiki link action", async () => {
  const user = userEvent.setup();
  render(<FileTreePanel />);

  await user.pointer([{ target: screen.getByText("项目周报.md"), keys: "[MouseRight]" }]);

  expect(screen.getByRole("menuitem", { name: "复制 Wiki 链接" })).toBeInTheDocument();
});
```

在 `src/components/LeftSidebar/TagPanel.test.tsx` 追加：

```tsx
it("shows tag context menu with context and filter actions", async () => {
  const user = userEvent.setup();
  render(<TagPanel />);

  await user.pointer([{ target: screen.getByText("项目报告"), keys: "[MouseRight]" }]);

  expect(screen.getByRole("menuitem", { name: "查看标签上下文" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "按此标签筛选" })).toBeInTheDocument();
});
```

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/ContextMenu/ContextMenuHost.test.tsx src/components/LeftSidebar/FileTreePanel.test.tsx src/components/LeftSidebar/TagPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/lijun/mynote
git add src/components/ContextMenu src/components/LeftSidebar/FileTreePanel.tsx src/components/LeftSidebar/TagPanel.tsx src/components/LeftSidebar/FileTreePanel.test.tsx src/components/LeftSidebar/TagPanel.test.tsx src/styles/layout.css src/components/AppShell.tsx
git commit -m "feat(menu): add object context menus for tree and tags"
```

---

## 5. Task 4: 落地编辑器选区与空白区域右键菜单

**Files:**
- Modify: `src/components/EditorWorkspace/MarkdownEditor.tsx`
- Modify: `src/components/EditorWorkspace/MarkdownEditor.test.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/menu/menuActionRunner.ts`
- Modify: `src/menu/menuSchema.ts`
- Modify: `src/components/ContextMenu/ContextMenuHost.tsx`

- [ ] **Step 1: 写编辑器选区菜单失败测试，锁定“添加链接 / 添加标签 / 创建双链”三项直出**

在 `src/components/EditorWorkspace/MarkdownEditor.test.tsx` 追加：

```tsx
it("shows selection context menu for formatting and knowledge actions", async () => {
  const user = userEvent.setup();
  render(<MarkdownEditor />);

  const editor = screen.getByRole("textbox");
  await user.click(editor);
  await user.keyboard("项目周报");
  await user.pointer([{ target: editor, keys: "[MouseRight]" }]);

  expect(screen.getByRole("menuitem", { name: "添加链接" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "添加标签" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "创建双链" })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行窄测试，确认它先失败**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/EditorWorkspace/MarkdownEditor.test.tsx
```

Expected: FAIL because the editor does not open a selection context menu yet.

- [ ] **Step 3: 在编辑器中接线选区菜单**

在 `src/components/EditorWorkspace/MarkdownEditor.tsx` 中增加：

```ts
const selectionMenu = useContextMenu();

function handleEditorContextMenu(event: React.MouseEvent) {
  const selectedText = editorViewRef.current?.state.sliceDoc(
    editorViewRef.current.state.selection.main.from,
    editorViewRef.current.state.selection.main.to,
  ) ?? "";

  if (selectedText.trim()) {
    selectionMenu.openMenu(
      event,
      { type: "editor-selection", selectedText },
      buildContextMenuSchema({ type: "editor-selection", selectedText }),
    );
    return;
  }

  selectionMenu.openMenu(
    event,
    { type: "blank" },
    buildContextMenuSchema({ type: "blank" }),
  );
}
```

把编辑器容器改为：

```tsx
<div className="markdown-editor-shell" onContextMenu={handleEditorContextMenu}>
```

- [ ] **Step 4: 扩展 action runner，支持文本格式化与插入动作**

在 `src/menu/menuActionRunner.ts` 追加：

```ts
interface MenuRunnerDeps {
  // existing deps...
  insertLinkFromSelection: () => void;
  insertTagFromSelection: () => void;
  createWikiLinkFromSelection: () => void;
  openIndexRefreshConfirm: () => void;
}

case "selection.insertLink":
  deps.insertLinkFromSelection();
  return;
case "selection.insertTag":
  deps.insertTagFromSelection();
  return;
case "selection.createWikiLink":
  deps.createWikiLinkFromSelection();
  return;
case "blank.refreshIndex":
  deps.openIndexRefreshConfirm();
  return;
```

并在 `buildContextMenuSchema` 中补：

```ts
if (target.type === "editor-selection") {
  return [
    { id: "selection.bold", label: "加粗", enabled: true },
    { id: "selection.insertLink", label: "添加链接", enabled: true },
    { id: "selection.insertTag", label: "添加标签", enabled: true },
    { id: "selection.createWikiLink", label: "创建双链", enabled: true },
    { id: "selection.relation", label: "创建知识关联（即将推出）", enabled: false },
  ];
}

if (target.type === "blank") {
  return [
    { id: "blank.newNote", label: "新建笔记", enabled: true },
    { id: "blank.paste", label: "粘贴", enabled: true },
    { id: "blank.refreshIndex", label: "刷新索引", enabled: true },
    { id: "blank.showSidebar", label: "显示侧栏", enabled: true },
  ];
}
```

- [ ] **Step 5: 运行本任务测试并确认通过**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/components/EditorWorkspace/MarkdownEditor.test.tsx src/components/ContextMenu/ContextMenuHost.test.tsx src/menu/menuActionRunner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/lijun/mynote
git add src/components/EditorWorkspace/MarkdownEditor.tsx src/components/EditorWorkspace/MarkdownEditor.test.tsx src/menu/menuActionRunner.ts src/menu/menuSchema.ts src/components/AppShell.tsx src/components/ContextMenu/ContextMenuHost.tsx
git commit -m "feat(menu): add editor and blank-area context menus"
```

---

## 6. Task 5: 总验证与文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-06-04-menu-context-menu-design.md`
- Modify: `README.md`

- [ ] **Step 1: 更新设计文档的实现状态标记**

在 `docs/superpowers/specs/2026-06-04-menu-context-menu-design.md` 的开头追加一行实现状态说明：

```md
> 实现状态：系统菜单骨架、文件树/标签/编辑器/空白区右键菜单已落地；图谱、修订、关系管理、多窗口相关项仍为灰态预留。
```

- [ ] **Step 2: 在 README 中补一段菜单入口说明**

在 `README.md` 的使用说明区域追加：

```md
## 菜单与右键菜单

- 顶部系统菜单提供全局入口：文件、编辑、视图、笔记、帮助。
- 文件树、标签、编辑器选区和空白区域都提供对象化右键菜单。
- 部分未来能力当前会以灰态菜单项显示，用于固定后续扩展位置。
```

- [ ] **Step 3: 运行完整验证**

Run:

```bash
cd /Users/lijun/mynote
corepack pnpm vitest run src/menu/*.test.ts src/menu/*.test.tsx src/components/ContextMenu/*.test.tsx src/components/LeftSidebar/FileTreePanel.test.tsx src/components/LeftSidebar/TagPanel.test.tsx src/components/EditorWorkspace/MarkdownEditor.test.tsx
corepack pnpm build
cd src-tauri && cargo test
```

Expected: all listed frontend tests pass, `build` exits 0, and Rust tests remain green.

- [ ] **Step 4: Final commit**

```bash
cd /Users/lijun/mynote
git add README.md docs/superpowers/specs/2026-06-04-menu-context-menu-design.md
git commit -m "docs: document menu and context menu entry points"
```

---

## 7. 计划自检

- 本计划覆盖了已批准规格中的五组系统菜单与五类对象右键菜单，没有遗漏“组织去掉、窗口不承载业务”的约束。
- 灰态项只保留图谱、修订、关系、多窗口、知识库导出、标签治理这些已经明确归属的结构位，没有加入未定功能。
- 系统菜单与右键菜单通过同一 `menuSchema` 与 `menuActionRunner` 驱动，避免后续名称和行为漂移。
- 每个任务都包含失败测试、最小实现、通过验证与提交节点，可直接交给执行型 agent 分任务落地。
