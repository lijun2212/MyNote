# Front Matter Preview Design

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义 Markdown 预览区默认隐藏 Front Matter 的展示设计。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标](#2-目标)
- [3. 非目标](#3-非目标)
- [4. 设计原则](#4-设计原则)
- [5. 方案选择](#5-方案选择)
- [6. 详细设计](#6-详细设计)
- [7. 数据流](#7-数据流)
- [8. 边界与错误处理](#8-边界与错误处理)
- [9. 测试与验证策略](#9-测试与验证策略)
- [10. 后续扩展](#10-后续扩展)

## 1. 背景

MyNote 当前编辑器会保存完整 Markdown 原文，其中可能包含文档开头的 YAML Front Matter。后端解析、索引、标题推导和标签提取已经会识别 Front Matter 与正文，但前端预览组件目前直接对完整 `content` 调用 `markdown-it` 渲染。

这导致 Front Matter 以普通 Markdown 水平线和正文形式出现在预览区，用户在编辑含元数据的笔记时会看到 `id`、`title`、`tags`、`created_at` 等内部字段。预览区的主要目的应是查看正文排版，而不是展示元数据源文本。

本轮 P1 修复聚焦于预览区默认隐藏 Front Matter，不改变编辑器原文、保存内容、后端解析和索引逻辑。

## 2. 目标

本次修复目标：

- 预览区默认不显示文档开头的 Front Matter。
- 编辑器仍显示完整原文，包括 Front Matter。
- 自动保存仍保存完整原文，包括 Front Matter。
- 后端 note parsing、indexing、tags、links、search 行为不变。
- Wiki link 和外链点击继续在预览正文中工作。
- 只隐藏合法闭合的开头 Front Matter；未闭合内容按普通 Markdown 显示。
- 修复范围保持在前端预览层，避免新增后端命令或数据库迁移。

## 3. 非目标

本轮不做以下内容：

- 新增“显示 Front Matter”开关。
- 将 Front Matter 渲染成折叠元信息块。
- 修改 Front Matter 编辑体验。
- 修改后端 `split_front_matter`、`parse_note` 或索引行为。
- 新增前端测试框架。
- 处理 Markdown 正文中间的 YAML block 或水平线。
- 对 Front Matter YAML 做校验、格式化或错误提示。

## 4. 设计原则

- 预览只影响展示，不影响源内容和保存内容。
- 剥离逻辑必须保守：只有明确识别为文档开头 Front Matter 时才隐藏。
- 未闭合或不规范内容不应被吞掉，避免用户误以为内容丢失。
- 与后端语义保持接近，但不为了实时预览引入后端调用。
- 保持当前 `MarkdownPreview` 的 wiki link、外链、HTML 禁用策略不变。

## 5. 方案选择

### 方案 A：前端预览层剥离 Front Matter（推荐）

在 `MarkdownPreview` 渲染前调用一个小型纯函数，只从预览输入中移除文档开头的 Front Matter，再把正文传给 `markdown-it`。

优点：

- 改动最小，实时预览无需后端往返。
- 不改变编辑器、保存、索引和命令接口。
- 行为集中在预览层，符合“只影响展示”的目标。

缺点：

- 前端会有一份 Front Matter 边界识别逻辑，与后端 Rust 实现存在轻微重复。

### 方案 B：后端提供 preview body

新增或扩展后端 command，由后端复用 Rust `split_front_matter` 返回正文，再由前端渲染。

优点：

- Front Matter 识别语义完全复用后端。

缺点：

- 实时编辑预览会频繁调用后端，不适合当前轻量预览链路。
- 需要新增命令接口和异步状态，扩大 P1 修复范围。

### 方案 C：Front Matter 折叠显示

把 Front Matter 渲染为预览顶部的折叠元信息块，默认收起。

优点：

- 用户仍可在预览中查看元数据。

缺点：

- 增加 UI 状态和样式范围。
- 本轮用户期望是“默认隐藏”，折叠展示不是必要条件。

本轮采用方案 A。

## 6. 详细设计

### 6.1 剥离函数

在前端预览层新增一个纯函数，例如 `stripPreviewFrontMatter(content: string): string`。

识别规则：

- 只有 `content` 以 `---` 开头时才尝试识别。
- 开头 delimiter 必须独占第一行。可接受第一行是 `---` 或 `---\r`。
- 结束 delimiter 必须是后续某一行独占的 `---` 或 `---\r`。
- 找到结束 delimiter 后，返回其后的正文，并移除正文开头的单个换行或连续换行。
- 如果找不到结束 delimiter，返回原始 `content`。
- 如果文档不是以 Front Matter delimiter 开头，返回原始 `content`。

建议实现时按行扫描，不使用过宽正则，以便清楚处理 CRLF 和未闭合场景。

### 6.2 渲染流程

当前预览流程：

1. `MarkdownPreview` 收到完整 `content`。
2. `md.render(content)` 生成 HTML。
3. `processWikiLinks(rawHtml)` 后写入 `innerHTML`。

调整后流程：

1. `MarkdownPreview` 收到完整 `content`。
2. `stripPreviewFrontMatter(content)` 得到 `previewContent`。
3. `md.render(previewContent)` 生成 HTML。
4. `processWikiLinks(rawHtml)` 后写入 `innerHTML`。

除传给 `md.render` 的文本外，不改变现有 HTML 禁用、linkify、typographer 和 wiki link 后处理策略。

### 6.3 组件边界

优先将剥离函数放在 `MarkdownPreview.tsx` 同文件中，原因：

- 当前仅预览层需要该行为。
- 不新增共享 API，避免让其他模块误以为这是内容解析权威实现。
- 后续若前端测试框架建立，可再抽到 `src/utils/markdownPreview.ts` 做单元测试。

如果实现过程中发现 `MarkdownPreview.tsx` 继续膨胀，再抽出独立 helper 文件。本轮不主动扩大文件结构。

### 6.4 与链接逻辑的关系

Wiki link 和外链点击只作用于预览后的正文 HTML：

- Front Matter 内的 `[[Wiki]]` 不会渲染，也不会可点击。
- 正文内的 `[[Wiki]]` 保持可点击。
- 正文内的外链保持通过 Tauri opener 打开。

这符合预览隐藏元数据的预期。

## 7. 数据流

### 7.1 含合法 Front Matter 的笔记

输入：

```markdown
---
title: Demo
tags:
  - note
---

# Demo

[[Other]]
```

预览渲染输入：

```markdown
# Demo

[[Other]]
```

结果：预览区只显示标题和正文链接。

### 7.2 无 Front Matter 的笔记

输入：

```markdown
# Demo

Body
```

预览渲染输入保持不变。

### 7.3 未闭合 Front Matter

输入：

```markdown
---
title: Demo
# Body
```

预览渲染输入保持不变，避免吞掉用户内容。

### 7.4 正文中间水平线

输入：

```markdown
# Demo

---

Body
```

预览渲染输入保持不变，因为 delimiter 不在文档开头。

## 8. 边界与错误处理

- 空内容返回空内容。
- 只有空白或普通 Markdown 的内容不变。
- CRLF 换行应按同样规则识别。
- 未闭合 Front Matter 不隐藏。
- Front Matter YAML 是否有效不在前端判断范围内；只根据 delimiter 判断。
- 剥离函数不抛错；异常输入按普通字符串处理。
- 预览仍使用 `markdown-it` 的 `html: false`，不改变安全边界。

## 9. 测试与验证策略

当前项目尚未引入前端测试框架，本轮验证分三层：

1. TypeScript 构建验证：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

2. Rust 回归验证，确认后端不受影响：

```bash
cd /Users/lijun/mynote/src-tauri && cargo test
```

3. 手动预览验证，使用开发模式：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri dev
```

手动验证用例：

- 含合法 Front Matter 的笔记，预览不显示 `---` 和 YAML 字段。
- 编辑器仍显示完整 Front Matter。
- 保存后文件内容仍包含 Front Matter。
- 正文 wiki link 仍可点击打开。
- Front Matter 内的 wiki link 不显示也不可点击。
- 未闭合 Front Matter 在预览中保持显示。
- 正文中间的 `---` 仍按 Markdown 水平线渲染。

## 10. 后续扩展

后续可考虑：

- 在预览顶部提供“显示元数据”折叠入口。
- 将前端剥离函数抽到可单测 helper，并在引入前端测试框架后补测试。
- 在编辑器中提供 Front Matter 专用编辑 UI。
- 让预览层复用统一 Markdown utility，集中处理 Front Matter、wiki links 和安全渲染策略。
