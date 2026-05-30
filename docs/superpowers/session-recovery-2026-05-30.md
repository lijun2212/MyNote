# MyNote 会话恢复记录

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 从本地 Copilot/VS Code 日志、Git 历史、仓库计划文档和当前工作区恢复项目上下文。 |

## 目录

- [1. 恢复结论](#1-恢复结论)
- [2. 已检查的数据源](#2-已检查的数据源)
- [3. 当前项目进度](#3-当前项目进度)
- [4. 当前未提交修改](#4-当前未提交修改)
- [5. 当前待处理问题](#5-当前待处理问题)
- [6. 验证结果](#6-验证结果)
- [7. 建议续接顺序](#7-建议续接顺序)

## 1. 恢复结论

之前 Copilot CLI 的完整对话正文没有在当前可读索引中恢复出来。已找到的 VS Code Copilot debug 日志只有 `session_start`，没有用户/助手对话正文；`~/.config/github-copilot/py` 下存在 Copilot CLI 的 Nitrite 数据库，但通过关键词与可读字符串抽取未命中 `mynote`、`personal-knowledge-base`、`phase2` 等当前项目线索。

虽然完整会话正文不可用，但仓库本身保留了足够完整的续接上下文：Phase 1/Phase 2 计划文档、Phase 2 设计稿、最近提交历史、当前未提交 diff、以及一份待处理问题便签。

## 2. 已检查的数据源

- VS Code Copilot 本地 session index：重建索引后只有 2 个 VS Code session，且 turns/files/refs 为空。
- VS Code debug logs：`main.jsonl` 仅包含 session_start 事件。
- Copilot CLI 本地目录：`~/.config/github-copilot/py/chat-agent-sessions`、`chat-sessions`、`chat-edit-sessions`。
- Copilot CLI Nitrite DB：用 `strings` 抽取后未命中当前项目关键词。
- Shell 历史：未找到有用的 `copilot` / `mynote` 线索。
- 仓库文档：`docs/superpowers/plans/2026-05-29-mynote-phase1-foundation.md`、`docs/superpowers/plans/2026-05-30-mynote-phase2.md`、`docs/superpowers/specs/2026-05-30-mynote-phase2-design.md`。
- Git 历史与当前工作区 diff。

## 3. 当前项目进度

项目是 Tauri 2 + Rust 后端 + React/TypeScript 前端的本地个人知识库应用。

Phase 1 已基本完成：知识库管理、笔记 CRUD、文件树、CodeMirror 编辑器、Markdown 预览、自动保存、SQLite 迁移等已落地。

Phase 2 已有一系列提交完成主要功能：

- `feat(db): add migrations 5-8 for tags, note_tags, links, file_events`
- `feat(ui): resizable and collapsible sidebars with localStorage persistence`
- `feat(markdown): add extract_inline_tags and extract_links`
- `feat(index): full indexing service with tags, links, and FTS`
- `feat(tags): tag extraction, list_tags command, TagPanel with multi-select filter`
- `feat(links): link commands, BacklinksPanel, wiki link rendering`
- `feat(search): FTS5 search command, SearchOverlay with ⌘K shortcut`
- `feat(watcher): file watcher with debounce, auto-reindex on external changes`

之后还有若干修复提交，最新提交为：

- `78b3cea fix(markdown): fix unused_assignments warning for in_inline_code`

## 4. 当前未提交修改

当前工作区存在未提交修改，主要集中在导入、搜索、链接打开、错误边界和 Markdown 解析体验修复上。

已修改文件：

- `src-tauri/src/commands/link.rs`
- `src-tauri/src/commands/search.rs`
- `src-tauri/src/infrastructure/markdown.rs`
- `src/App.tsx`
- `src/components/EditorWorkspace/MarkdownPreview.tsx`
- `src/components/LeftSidebar/FileTreePanel.tsx`
- `src/components/LeftSidebar/ImportDialog.tsx`
- `src/components/LeftSidebar/TagPanel.tsx`
- `src/components/RightSidebar/BacklinksPanel.tsx`
- `src/components/SearchOverlay.tsx`

新增未跟踪文件：

- `src/components/ErrorBoundary.tsx`
- `docs/test.md`
- `docs/superpowers/session-recovery-2026-05-30.md`

未提交改动要点：

- 搜索增加 `LIKE` fallback，用于匹配导入文件名/路径/摘要/正文中的子串。
- 搜索结果点击后真正加载笔记内容，而不只是设置选中路径。
- Markdown Front Matter 支持 `tags: test` 单字符串写法。
- Markdown 链接开始支持外链类型 `external`，并用 `@tauri-apps/plugin-opener` 打开 HTTP/HTTPS 链接。
- BacklinksPanel 对外链和内部链接分别处理。
- 导入完成后自动打开最后导入的笔记。
- App 增加 ErrorBoundary。
- Zustand selector 从对象选择改为独立选择，减少不必要渲染/潜在循环。

## 5. 当前待处理问题

`docs/test.md` 记录了两个明确的下一步问题：

1. 编辑区和预览区中间的竖线不能左右拖动，用户需要能调整编辑区/预览区宽度。
2. Front Matter 区不要显示在预览区；如果要显示，也应默认隐藏，展开后用灰色小字号，并与正文有明显区隔。

这两个问题是目前最适合继续处理的入口。

## 6. 验证结果

已运行 Rust 测试：

```bash
cd src-tauri && cargo test
```

结果：23 个测试全部通过。

已运行前端构建：

```bash
corepack pnpm build
```

结果：TypeScript + Vite 构建通过。Vite 提示 bundle 大于 500KB，这是体积警告，不是构建失败。

本机当前没有直接可用的 `pnpm` 命令，但 `corepack pnpm` 可用。

## 7. 建议续接顺序

1. 先处理 `docs/test.md` 中的两个 UI 问题：编辑/预览分隔线拖拽、Front Matter 预览隐藏/折叠。
2. 对当前未提交修改做一次 review，确认 `external` link 类型是否需要同步更新后端类型/前端显示文案。
3. 运行 `cd src-tauri && cargo test` 与 `corepack pnpm build`。
4. 若验证通过，将当前修复整理为一次提交。
5. 再继续 Phase 2 收尾：文件监听真实场景验证、搜索和标签过滤交互验收、导入/打开/外链行为验收。
