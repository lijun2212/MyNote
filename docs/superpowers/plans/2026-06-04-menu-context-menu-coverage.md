# Menu Context Menu Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 MyNote 补齐标签区、预览区、右侧链接区、右侧关系区的对象化右键菜单覆盖，并继续复用现有共享菜单体系。

**Architecture:** 本轮不新增第二套右键菜单机制，继续复用 `contextMenuTypes`、`menuIds`、`menuSchema`、`menuActionRunner`、`ContextMenuHost`。实现顺序按“先共享模型，再对象入口，再最终验证”推进，确保每一类新对象都经过统一 schema 和统一 runner，而不是在组件内部私有分叉。

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, React Testing Library, Tauri opener API, existing ContextMenuHost/menu runner infrastructure.

---

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-04 | v1.0 | 根据右键菜单覆盖扩展设计稿，拆解实现任务与验证路径。 |

## 目录

- [1. 文件结构](#1-文件结构)
- [2. Task 1: 扩展共享菜单对象与动作矩阵](#2-task-1-扩展共享菜单对象与动作矩阵)
- [3. Task 2: 落地标签区空白区与上下文项右键菜单](#3-task-2-落地标签区空白区与上下文项右键菜单)
- [4. Task 3: 落地预览区空白区与链接对象右键菜单](#4-task-3-落地预览区空白区与链接对象右键菜单)
- [5. Task 4: 落地右侧链接区与关系区右键菜单](#5-task-4-落地右侧链接区与关系区右键菜单)
- [6. Task 5: 总验证与文档同步](#6-task-5-总验证与文档同步)
- [7. 计划自检](#7-计划自检)

## 1. 文件结构

### 修改

- `src/components/ContextMenu/contextMenuTypes.ts`
  - 为 tagBlank、tagContextItem、previewBlank、previewLink、linksBlank、linkItem、relationBlank、relationItem 增加 payload 类型。
- `src/menu/menuIds.ts`
  - 新增本轮动作 id 和占位 id。
- `src/menu/menuSchema.ts`
  - 为新增对象类型补齐菜单矩阵与 enabled 规则。
- `src/menu/menuActionRunner.ts`
  - 为本轮闭环动作补齐统一执行映射。
- `src/menu/menuSchema.test.ts`
  - 补新对象菜单矩阵测试。
- `src/menu/menuActionRunner.test.ts`
  - 补新动作分发测试。
- `src/components/LeftSidebar/TagPanel.tsx`
  - 接入标签空白区与标签上下文项右键菜单。
- `src/components/LeftSidebar/TagPanel.test.tsx`
  - 覆盖标签空白区与上下文项右键菜单行为。
- `src/components/EditorWorkspace/MarkdownPreview.tsx`
  - 接入预览空白区与预览链接对象右键菜单。
- `src/components/EditorWorkspace/MarkdownPreview.test.tsx`
  - 覆盖预览空白区与链接对象右键菜单行为。
- `src/components/RightSidebar/BacklinksPanel.tsx`
  - 接入链接面板空白区与链接项右键菜单。
- `src/components/RightSidebar/BacklinksPanel.test.tsx`
  - 覆盖链接面板空白区与链接项右键菜单行为。
- `src/components/RightSidebar/ManualRelationsPanel.tsx`
  - 接入关系区空白区与关系项右键菜单。
- `src/components/RightSidebar/ManualRelationsPanel.test.tsx`
  - 覆盖关系区空白区与关系项右键菜单行为。
- `src/components/RightSidebar/RightSidebar.tsx`
  - 如需要，仅做最小上下文透传。

### 不修改

- `src-tauri/**`
  - 本轮不做 Rust 侧改动。
- 右侧大纲组件或大纲数据源
  - 本轮继续排除在实现范围外。

---

## 2. Task 1: 扩展共享菜单对象与动作矩阵

**Files:**
- Modify: `src/components/ContextMenu/contextMenuTypes.ts`
- Modify: `src/menu/menuIds.ts`
- Modify: `src/menu/menuSchema.ts`
- Modify: `src/menu/menuActionRunner.ts`
- Test: `src/menu/menuSchema.test.ts`
- Test: `src/menu/menuActionRunner.test.ts`

- [x] **Step 1: 先写 menuSchema 的失败测试，锁定新增对象菜单矩阵**
- [x] **Step 2: 运行窄测试，确认新增对象分支尚未实现**
- [x] **Step 3: 先补 contextMenuTypes、menuIds、menuSchema 的最小实现**
- [x] **Step 4: 运行 schema 测试，确认菜单矩阵通过**
- [x] **Step 5: 再写 action runner 的失败测试，锁定本轮闭环动作**
- [x] **Step 6: 运行窄测试，确认 runner 尚未支持这些新动作**
- [x] **Step 7: 为 runner 增加最小闭环动作映射**
- [x] **Step 8: 运行共享层窄测试，确认本轮基础设施通过**
- [x] **Step 9: Commit**

状态：已完成，任务结果已通过后续规格与质量审查。

---

## 3. Task 2: 落地标签区空白区与上下文项右键菜单

**Files:**
- Modify: `src/components/LeftSidebar/TagPanel.tsx`
- Test: `src/components/LeftSidebar/TagPanel.test.tsx`

- [x] **Step 1: 先写标签区右键菜单失败测试**
- [x] **Step 2: 运行标签面板窄测试，确认当前未接入这些对象菜单**
- [x] **Step 3: 在 TagPanel 中接入空白区与上下文项对象 payload**
- [x] **Step 4: 运行标签面板窄测试，确认对象菜单行为通过**
- [x] **Step 5: Commit**

状态：已完成。额外修复了标签空白区触发范围，只在真实 panel 空白区域弹出空白区菜单，避免误伤标签行与上下文项对象。

---

## 4. Task 3: 落地预览区空白区与链接对象右键菜单

**Files:**
- Modify: `src/components/EditorWorkspace/MarkdownPreview.tsx`
- Test: `src/components/EditorWorkspace/MarkdownPreview.test.tsx`

- [x] **Step 1: 先写预览区右键菜单失败测试**
- [x] **Step 2: 运行预览窄测试，确认菜单尚未接入**
- [x] **Step 3: 在 MarkdownPreview 中接入空白区和链接对象菜单**
- [x] **Step 4: 运行预览窄测试，确认预览对象菜单通过**
- [x] **Step 5: Commit**

状态：已完成。额外修复了预览链接点击接管的同步 `preventDefault` 时序，以及 `notes/...` 编码链接路径的 decode/normalize 处理。

---

## 5. Task 4: 落地右侧链接区与关系区右键菜单

**Files:**
- Modify: `src/components/RightSidebar/BacklinksPanel.tsx`
- Modify: `src/components/RightSidebar/ManualRelationsPanel.tsx`
- Modify: `src/components/RightSidebar/RightSidebar.tsx`
- Test: `src/components/RightSidebar/BacklinksPanel.test.tsx`
- Test: `src/components/RightSidebar/ManualRelationsPanel.test.tsx`

- [x] **Step 1: 先写链接区与关系区失败测试**
- [x] **Step 2: 运行右侧栏窄测试，确认菜单尚未接入**
- [x] **Step 3: 在 BacklinksPanel 中接入链接空白区和链接项对象菜单**
- [x] **Step 4: 在 ManualRelationsPanel 中接入关系空白区和关系项对象菜单**
- [x] **Step 5: 运行右侧栏窄测试，确认菜单行为通过**
- [x] **Step 6: Commit**

状态：已完成。linksBlank、linkItem、relationBlank、relationItem 的对象菜单均已接入共享 host/schema/runner，并补齐条件启用测试。

---

## 6. Task 5: 总验证与文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-06-04-menu-context-menu-coverage-design.md`
- Optionally modify: `README.md`

- [x] **Step 1: 更新设计文档实现状态**
- [x] **Step 2: 运行本轮完整验证**
- [x] **Step 3: Commit**

验证结果：

- `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm vitest run src/menu/*.test.ts src/menu/*.test.tsx src/components/LeftSidebar/TagPanel.test.tsx src/components/EditorWorkspace/MarkdownPreview.test.tsx src/components/RightSidebar/BacklinksPanel.test.tsx src/components/RightSidebar/ManualRelationsPanel.test.tsx src/components/ContextMenu/*.test.tsx`
  - 8 个测试文件，98 个测试通过。
- `PATH="$HOME/.npm-global/bin:$PATH" corepack pnpm build`
  - 通过，只有 Vite chunk size warning。
- `cd src-tauri && cargo test`
  - 104 个 Rust 测试通过。

状态：已完成。最初的文档同步误把 coverage 专项稿写成总菜单设计稿副本，后续已恢复为正确专项内容并单独补了一笔修正文档提交。

---

## 7. 计划自检

- [x] 计划聚焦于已批准的 8 类真实对象菜单覆盖，没有把右侧大纲对象或预览区选区重新拉入范围。
- [x] 继续复用统一菜单体系，没有要求新增第二套菜单框架。
- [x] 每个任务都包含可执行验证，不依赖纯人工目测。
- [x] Task 5 已明确把 coverage 专项设计稿列为文档同步对象，避免再次与总菜单设计稿混淆。
