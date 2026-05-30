# Frontend Testing Design

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义 MyNote 前端测试框架和首轮交互测试设计。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标](#2-目标)
- [3. 非目标](#3-非目标)
- [4. 设计方案](#4-设计方案)
- [5. 测试分层](#5-测试分层)
- [6. 测试基础设施](#6-测试基础设施)
- [7. 首轮测试用例](#7-首轮测试用例)
- [8. Mock 和状态隔离](#8-mock-和状态隔离)
- [9. 命令与验证](#9-命令与验证)
- [10. 风险与后续扩展](#10-风险与后续扩展)

## 1. 背景

当前 MyNote 前端已经完成 Phase 2 的核心交互：知识库打开、文件树、编辑器、预览、搜索弹层、自动保存、标签、双链和侧栏 resize。此前多个 P1/P2 风险修复都涉及前端异步行为或 UI 交互，例如搜索旧请求晚返回、打开笔记竞态、自动保存竞态、Front Matter 预览隐藏、搜索结果打开等。

这些行为目前主要依赖手工验证和 `pnpm build` 的类型检查。`pnpm build` 能证明 TypeScript 和 Vite 构建通过，但不能证明用户交互、hook 时序、store 状态流和浏览器行为没有回归。baseline 中剩余 P3 风险是“前端缺少测试框架和交互测试”，本轮目标是建立可持续的前端测试入口，并覆盖最容易反复出问题的关键路径。

## 2. 目标

本次 P3 建设目标如下：

- 引入前端单元/组件测试框架，支持 React 19、TypeScript、Zustand、jsdom 环境。
- 引入浏览器级 smoke 测试框架，验证 Vite 页面能在真实浏览器中启动并执行基础交互。
- 为高风险 hooks 增加首轮回归测试：`useSearch`、`useAutoSave`。
- 为关键组件增加首轮回归测试：`MarkdownPreview`、`SearchOverlay`。
- 建立统一 mock 层，隔离 Tauri `invoke`、dialog、opener 和浏览器缺口。
- 新增稳定的 npm scripts，让后续任务可以用固定命令运行前端测试。
- 保持现有 `pnpm build`、`cargo test` 验证路径不被破坏。

## 3. 非目标

本轮不做以下内容：

- 不启动真实 Tauri 桌面 app 做端到端测试。
- 不建立视觉回归测试、截图 diff 或跨设备布局矩阵。
- 不追求覆盖率阈值，也不要求一次性补齐所有组件测试。
- 不重构 UI 架构或改造现有组件样式。
- 不引入后端测试替代 Rust `cargo test`。
- 不把 Playwright 测试设计为依赖真实本地知识库文件系统。

## 4. 设计方案

采用轻量平衡方案：`Vitest + React Testing Library + jsdom` 负责单元/组件层，`Playwright` 负责浏览器 smoke 层。

Vitest 适合精确验证 hook 时序、组件渲染、store 更新和 Tauri API mock。首轮重点放在已经出现过风险的前端逻辑，而不是追求广泛覆盖。React Testing Library 以用户可见行为为主，避免直接断言组件内部实现。

Playwright 只做最小浏览器 smoke：启动 Vite dev server，打开页面，验证 WelcomeScreen 可见、基础按钮存在、页面没有启动级 JS 错误。对于需要 Tauri API 的流程，首轮优先使用浏览器上下文 mock 或测试专用初始化，避免依赖真实 Tauri shell。

测试文件和源码就近放置或统一放入 `src/test` 辅助目录：

- 测试基础设施集中在 `src/test/`。
- hook/component 测试文件可放在对应源码旁边，使用 `*.test.ts` / `*.test.tsx`。
- Playwright 测试放在 `tests/e2e/`。

## 5. 测试分层

### 5.1 Vitest 单元和组件测试

Vitest 层覆盖以下行为：

- 纯逻辑和 hook 时序：fake timers、deferred promises、旧请求丢弃。
- React 组件行为：输入、键盘、点击、渲染结果。
- DOM 安全行为：Markdown sanitize、Front Matter 隐藏、snippet mark 渲染。
- Zustand store 状态变更：每个测试前 reset，避免测试之间串状态。

运行环境使用 `jsdom`。测试默认不访问真实 Tauri shell；所有 `@tauri-apps/api/core`、`@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-opener` 调用都通过 mock 层提供。

### 5.2 Playwright Smoke 测试

Playwright 层只覆盖应用能在真实浏览器中启动和基础 UI 可交互：

- Vite dev server 能启动。
- 根页面能渲染 `MyNote` WelcomeScreen。
- “新建知识库”和“打开知识库”按钮存在。
- 页面启动时没有 uncaught exception 或 console error。

后续如需覆盖已打开知识库后的 AppShell、搜索弹层、编辑器交互，可以在测试专用入口或浏览器 mock 层成熟后扩展。

## 6. 测试基础设施

新增开发依赖建议如下：

- `vitest`
- `jsdom`
- `@testing-library/react`
- `@testing-library/jest-dom`
- `@testing-library/user-event`
- `@playwright/test`

新增或调整配置：

- `vitest.config.ts`
  - 复用 Vite React 插件。
  - `environment: "jsdom"`。
  - `setupFiles: ["src/test/setup.ts"]`。
  - include `src/**/*.test.{ts,tsx}`。

- `src/test/setup.ts`
  - 引入 `@testing-library/jest-dom/vitest`。
  - 提供测试前清理和通用 DOM mock。

- `src/test/tauriMocks.ts`
  - 提供 `mockApi`、`resetApiMocks()`、deferred promise helper。
  - 集中 mock `api` 模块或 Tauri invoke 层，避免每个测试重复写 mock。

- `playwright.config.ts`
  - `webServer.command = "pnpm dev -- --host 127.0.0.1"`。
  - `url = "http://127.0.0.1:1420"`，沿用 Tauri/Vite 端口。
  - `reuseExistingServer = !process.env.CI`。
  - 首轮只启用 Chromium，降低本地成本。

`tsconfig.json` 当前 include 只有 `src`。Vitest 测试放在 `src` 下可以自然被 TypeScript 看到；Playwright 测试放在 `tests/e2e`，由 Playwright 自己处理，不要求纳入 `tsc && vite build`。

## 7. 首轮测试用例

### 7.1 `useSearch`

首轮测试覆盖：

- 空 query 返回空结果，不调用 API。
- 非空 query debounce 300ms 后调用 `api.searchNotes(query, kb.id)`。
- 后发请求先返回时，旧请求晚返回不能覆盖新结果。
- 切换知识库后，旧知识库请求返回不能覆盖当前状态。

### 7.2 `useAutoSave`

首轮测试覆盖：

- dirty note 在 800ms 后调用 `api.saveNote(noteId, content, expectedHash)`。
- 保存成功后调用 `markSaved`，状态回到 saved。
- 保存期间切换笔记时，旧保存结果不能覆盖新笔记状态。
- conflict 结果设置保存错误，而不是误标记为 saved。

### 7.3 `MarkdownPreview`

首轮测试覆盖：

- 合法闭合的开头 Front Matter 不出现在预览正文。
- 未闭合或非开头 `---` 不被误删。
- `<script>`、危险 HTML、非 http(s) 外链不会作为可执行内容进入 DOM。
- `[[Wiki Title]]` 渲染为 `.wiki-link`，点击时按 title 查询并打开笔记。

### 7.4 `SearchOverlay`

首轮测试覆盖：

- 初始输入框自动 focus。
- 输入 query 后渲染搜索结果。
- ArrowDown / ArrowUp 改变选中项。
- Enter 打开当前选中结果并关闭弹层。
- Escape 关闭弹层。
- snippet 中 `<mark>` 只渲染为 React `<mark>`，不通过 `innerHTML` 执行任意 HTML。

### 7.5 Playwright Smoke

首轮测试覆盖：

- 页面可打开，标题区显示 `MyNote`。
- “新建知识库”和“打开知识库”按钮可见。
- 页面加载期间没有 uncaught exception。
- 控制台没有 `error` 级日志。

## 8. Mock 和状态隔离

测试必须避免共享 Zustand 状态和 unresolved async side effects。

设计规则：

- 每个 Vitest case 前重置 `useAppStore` 和 `useEditorStore` 到初始状态。
- API mock 由统一 helper 提供，并在每个 test 前 `resetApiMocks()`。
- 使用 fake timers 测试 debounce 和 autosave，测试结束后恢复 real timers。
- 使用 deferred promise helper 显式控制请求返回顺序，避免靠 `setTimeout` 猜测。
- 组件测试优先通过用户行为触发状态变化，不直接操作组件内部变量。

Tauri mock 策略：

- 对应用层优先 mock `src/api/commands.ts` 导出的 `api`，因为 hooks 和组件主要依赖它。
- 对直接导入插件的组件，例如 `WelcomeScreen` 和 `MarkdownPreview`，mock `@tauri-apps/plugin-dialog` 与 `@tauri-apps/plugin-opener`。
- 不在首轮测试真实 `invoke` 参数序列化；Tauri command contract 继续由 Rust 侧测试和后续集成测试补齐。

## 9. 命令与验证

新增 scripts 建议：

```json
{
  "test": "vitest",
  "test:run": "vitest run",
  "test:e2e": "playwright test"
}
```

本轮完成后的推荐验证命令：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm test:run
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm test:e2e
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
cd /Users/lijun/mynote/src-tauri && cargo test
```

在 baseline 中，后续提交前至少应保留 `cargo test`、`pnpm build`、`pnpm test:run`。`pnpm test:e2e` 可作为涉及 UI flow 或发布前验证的必跑项；如果本地浏览器依赖缺失，应明确记录安装命令和失败原因。

## 10. 风险与后续扩展

风险：

- Playwright 首次安装浏览器可能耗时较长，需要在 plan 中单独验证。
- CodeMirror 在 jsdom 中不适合做完整编辑器交互测试，首轮不直接测试真实编辑输入。
- React 19 与测试库版本需要匹配，依赖选择应以当前生态兼容版本为准。
- Tauri 插件 mock 如果分散在各测试文件中会变脆，因此需要集中 helper。

后续扩展：

- 为 `useOpenNote`、`useEditorSplitResize`、`useSidebarResize` 增加更细的 hook 测试。
- 为 AppShell 已打开知识库状态添加测试专用 fixture。
- 为导入、创建笔记、打开搜索结果、Wiki link 点击建立 Playwright 级用户流程。
- 在 CI 中拆分 unit/component 和 e2e job，避免浏览器测试拖慢每次本地开发。