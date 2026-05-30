# Frontend Async Race Design

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义前端搜索、打开笔记、自动保存的异步竞态修复设计。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标](#2-目标)
- [3. 非目标](#3-非目标)
- [4. 设计原则](#4-设计原则)
- [5. 方案选择](#5-方案选择)
- [6. 详细设计](#6-详细设计)
- [7. 数据流](#7-数据流)
- [8. 错误处理](#8-错误处理)
- [9. 测试与验证策略](#9-测试与验证策略)
- [10. 后续扩展](#10-后续扩展)

## 1. 背景

MyNote 前端目前有多处异步请求会在返回后写入全局 Zustand store 或组件本地状态。典型场景包括搜索、从文件树打开笔记、搜索结果打开笔记、导入后打开最后一篇笔记、预览中的 Wiki link 打开、反链面板打开，以及自动保存。

这些请求现在主要依赖调用顺序，没有统一校验“返回结果是否仍然属于最新意图”。如果旧请求晚于新请求返回，就可能覆盖用户刚切换到的新笔记、显示过期搜索结果，或把旧笔记的保存结果写到当前编辑状态上。

本轮 P1 修复聚焦于异步返回污染状态的问题，不改变现有交互流程。

## 2. 目标

本次修复目标：

- 搜索只允许最新 query / knowledge base 对应的请求更新 `results` 和 `isLoading`。
- 打开笔记采用“最后一次用户主动打开胜出”规则：旧 `getNoteByPath` 请求返回后静默丢弃，不覆盖 `selectedNodePath`、`currentNote`、`content`。
- 所有打开笔记入口使用同一个安全入口，避免不同组件各自实现竞态规则。
- 自动保存返回时必须确认当前编辑器仍然是同一篇 note，旧保存结果不能写回新的当前笔记。
- 保持现有 UI 行为：切换笔记不新增确认弹窗，不阻止切换，不改变搜索和导入流程。
- 修复方案应尽量局限在前端 hook/store/component 层，不改后端命令接口。

## 3. 非目标

本轮不做以下内容：

- 未保存内容切换确认弹窗。
- 自动保存队列、离线重试、冲突合并 UI。
- 引入完整前端测试框架。
- 重构所有 Zustand store。
- 改变后端 `save_note`、`get_note_by_path`、`search_notes` command 的参数或返回结构。
- 修复 Front Matter 预览、编辑/预览分隔线拖动等其他 P1 项。

## 4. 设计原则

- 状态写入必须证明自己仍然属于最新用户意图。
- 竞态规则优先集中到共享 hook 或 store action，避免分散在组件中。
- 旧请求返回后静默丢弃，除非它仍是最新请求且确实失败。
- 不使用复杂取消机制作为 correctness 前提。Tauri `invoke` 不能可靠取消时，request id 校验仍然要独立成立。
- 每次改动都应能通过 TypeScript build 验证类型边界。

## 5. 方案选择

### 方案 A：共享安全打开入口（推荐）

新增统一的 `useOpenNote` hook，内部维护递增 request id。所有需要打开笔记的组件只传入 path，由 hook 完成：

1. 标记本次 open request 为最新请求。
2. 可选地立即更新 `selectedNodePath`，让侧边栏选择态响应用户点击。
3. 调用 `api.getNoteByPath(path)`。
4. 返回后检查 request id 是否仍然最新。
5. 只有最新请求写入 `currentNote` 和 `content`。

优点：规则集中，后续新增打开入口时复用同一 API。缺点：需要调整多个现有组件调用点。

### 方案 B：各组件局部加 request id

在 `FileTreePanel`、`SearchOverlay`、`MarkdownPreview`、`BacklinksPanel` 等组件里分别加 `useRef` 或闭包 token 校验。

优点：单点改动直观。缺点：规则分散，容易漏掉入口，也容易出现不同入口行为不一致。

### 方案 C：只修 baseline 点名的搜索和自动保存

只在 `useSearch` 和 `useAutoSave` 加 request id / note id 校验。

优点：改动最少。缺点：打开笔记请求仍可能互相覆盖，不能真正解决 baseline 所说“打开笔记旧请求晚返回覆盖新状态”。

本轮采用方案 A，同时为搜索和自动保存分别加局部 request id / note id 校验。

## 6. 详细设计

### 6.1 安全打开笔记

新增 `src/hooks/useOpenNote.ts`。

`useOpenNote()` 返回：

- `openNote(path: string): Promise<void>`
- 可选 `isOpening: boolean`，如果实现中能自然维护；本轮 UI 不依赖它。

内部状态：

- `latestRequestIdRef` 保存最新打开请求编号。
- 每次 `openNote(path)` 自增编号，并捕获为 `requestId`。
- 请求返回后只有 `requestId === latestRequestIdRef.current` 才能写入 editor store。

状态写入顺序：

1. 用户主动打开时先调用 `setSelectedNodePath(path)`，保持侧边栏即时反馈。
2. `api.getNoteByPath(path)` 返回后，若仍是最新请求，则调用 `setCurrentNote(detail.note)` 和 `setContent(detail.content)`。
3. 如果请求失败且仍是最新请求，记录 `console.error`；本轮不新增全局 toast。
4. 如果请求失败但已过期，静默忽略。

迁移入口：

- `FileTreePanel.handleSelect`
- `FileTreePanel` 的 `ImportDialog.onDone`
- `SearchOverlay.openResult`
- `MarkdownPreview` Wiki link 点击中 `getNoteByTitle` 成功后的打开
- `BacklinksPanel.handleLinkClick` 中内部链接打开

`MarkdownPreview` 和 `BacklinksPanel` 当前存在直接调用 `useEditorStore.getState()` 的路径。迁移后应把“按 path 打开笔记”通过 prop 传入，或在组件内部使用 `useOpenNote()`。优先选择组件内部使用 hook，保持调用简单。

### 6.2 搜索请求新旧校验

调整 `src/hooks/useSearch.ts`：

- 增加 `requestIdRef`。
- 每次开始搜索前自增 request id。
- `query` 为空时自增 request id，使已发出的旧请求失效。
- `kb` 变化时同步更新 `kbRef`，并让旧请求不能写入当前结果。
- `api.searchNotes(q, kb.id)` 返回后，只有当前 request id 仍然最新且 query/kb 匹配时才写 `results`。
- `finally` 中只有最新请求才能把 `isLoading` 设回 false。

预期行为：用户快速输入 `a` -> `ab` -> `abc` 时，如果 `a` 的结果最后返回，也不会覆盖 `abc` 的结果。

### 6.3 自动保存返回校验

调整 `src/hooks/useAutoSave.ts`：

- 每次 scheduled save 开始前捕获：`noteId`、`content`、`expectedHash`。
- 增加 `saveRequestIdRef`，每次真正发起保存时自增。
- 保存返回后检查：
  - 当前 latest save request id 仍然等于本次 request id。
  - `useEditorStore.getState().currentNote?.id === noteId`。
- 只有满足上述条件时，才能调用 `markSaved(result.note)` 或 `setSaveError(...)`。
- 如果保存旧 note 时用户已经切换到新 note，旧保存结果静默忽略，不改变新 note 的 dirty/saved 状态。
- `setSaving(false)` 不能无条件把当前状态改成 saved；需要只在当前 note 仍是保存发起时的 note 时更新。

为避免引入更大 store 重构，本轮可以在 hook 中用 `useEditorStore.getState()` 做提交前校验。

## 7. 数据流

### 7.1 打开笔记竞态

用户先点击 A，再快速点击 B：

1. `openNote(A)` 分配 request id 1。
2. `openNote(B)` 分配 request id 2。
3. B 请求先返回，id 2 仍是最新，写入 B。
4. A 请求后返回，id 1 已过期，静默丢弃。
5. 当前编辑器保持 B。

用户先点击 A，再快速点击 B，但 A 请求先返回：

1. A 返回时 id 1 已不是最新，因为 B 已经分配 id 2。
2. A 被丢弃。
3. B 返回后写入 B。
4. 当前编辑器仍保持最后一次用户意图 B。

### 7.2 搜索竞态

用户输入 `alpha` 后马上输入 `beta`：

1. `alpha` 搜索分配 request id 1。
2. `beta` 搜索分配 request id 2。
3. `alpha` 后返回时 id 1 过期，不更新 `results`。
4. `beta` 返回时 id 2 最新，更新 `results`。

### 7.3 自动保存竞态

用户正在保存 A，随后切换到 B：

1. A 保存请求捕获 `noteId = A.id`。
2. 用户打开 B，当前 note 变为 B。
3. A 保存返回。
4. hook 检查当前 note id 不等于 A.id，丢弃 A 的保存结果。
5. B 的当前状态不被 A 的 `markSaved` 或错误信息污染。

## 8. 错误处理

- 过期请求返回错误时静默忽略。
- 最新打开请求失败时保留现有行为：输出 `console.error`，不新增用户可见错误面板。
- 最新搜索请求失败时清空 results 并结束 loading；过期搜索失败不影响当前结果。
- 最新保存请求失败且当前 note 仍匹配时设置 `saveError`；过期保存失败不影响当前 note。
- 不依赖 abort/cancel。即使请求不能取消，过期返回也不能写状态。

## 9. 测试与验证策略

当前项目尚未引入前端测试框架，本轮不新增 Vitest/Playwright 作为强依赖。验证分三层：

1. TypeScript 构建验证：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

2. Rust 回归验证，确保后端不受影响：

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

3. 手动竞态验证，使用开发模式：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri dev
```

手动验证用例：

- 快速在文件树中连续点击两篇笔记，最终编辑器显示最后点击的笔记。
- 打开搜索，快速改变 query，结果列表不回退到旧 query 的结果。
- 从搜索结果打开笔记后，立刻从文件树打开另一篇笔记，最终显示最后一次打开的笔记。
- 在保存过程中切换笔记，旧笔记保存完成后不覆盖新笔记标题、正文和保存状态。
- 点击预览 Wiki link 或反链时，再快速打开另一篇笔记，最终显示最后一次打开的笔记。

## 10. 后续扩展

- 引入 Vitest，为 `useSearch`、`useOpenNote`、`useAutoSave` 补 fake timer / deferred promise 单元测试。
- 增加 dirty note 切换确认弹窗。
- 增加可见的打开失败提示和保存失败 toast。
- 将 editor store 的打开/保存状态进一步建模为显式 state machine。
