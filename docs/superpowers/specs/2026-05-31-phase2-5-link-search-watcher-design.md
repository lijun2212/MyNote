# MyNote Phase 2.5 — Link Model, Search Polish, Watcher Diagnostics Design

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-31 | v1.0 | 建立 Phase 2.5 稳基线设计，覆盖链接模型对齐、搜索小补齐和 watcher file_events 诊断。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标](#2-目标)
- [3. 非目标](#3-非目标)
- [4. 当前差距](#4-当前差距)
- [5. 方案概览](#5-方案概览)
- [6. 链接模型对齐](#6-链接模型对齐)
- [7. 搜索小补齐](#7-搜索小补齐)
- [8. Watcher 诊断事件](#8-watcher-诊断事件)
- [9. 前端交互](#9-前端交互)
- [10. 数据与兼容性](#10-数据与兼容性)
- [11. 测试策略](#11-测试策略)
- [12. 验收标准](#12-验收标准)
- [13. 风险与处理](#13-风险与处理)

## 1. 背景

Phase 2 已实现标签、Wiki/Markdown 链接、反链、FTS5 搜索、文件监听和侧边栏交互，并已通过当前 baseline 验证。对照基础设计与详细设计后，Phase 2 的主干功能可以进入后续阶段，但仍有几处设计口径与实现口径不完全一致。

Phase 2.5 的定位是进入 Phase 3 前的稳基线工作：不新增总结陈词、修订快照、手动关系或知识图谱等 Phase 3 正式业务能力，只补齐 Phase 2 基础链路中会影响后续功能的数据模型、交互表达和诊断能力。

## 2. 目标

1. 让链接解析更接近详细设计，支持 ID、路径、标题、别名和大小写宽松匹配。
2. 让 Wiki 预览渲染正确支持 `[[标题]]`、`[[标题|文本]]`、`[[标题#章节]]`、`[[标题#章节|文本]]`。
3. 让反链面板明确展示出链、反链、未解析链接三类信息。
4. 让搜索 command 支持 `limit`，并补齐空搜索的最近笔记展示能力。
5. 让 watcher 在处理外部文件变更时写入 `file_events`，为后续同步、冲突和重建索引诊断提供证据。
6. 保持 Phase 2 已有测试、构建和 Tauri 安全加固不回退。

## 3. 非目标

本轮不实现以下能力：

- 手动关系 CRUD 和关系类型管理。
- 总结陈词编辑面板或总结历史。
- 修订快照、diff 和恢复。
- 知识图谱 API 或图谱视图。
- 搜索高级过滤器，例如标签、时间范围、关系类型、未解析链接过滤。
- 未解析 Wiki 链接的一键创建目标笔记。
- 全量索引重建流程改造。

## 4. 当前差距

### 4.1 链接解析优先级不足

当前 `resolve_link_target` 主要按标题精确匹配和忽略大小写标题匹配。详细设计要求的 ID、相对路径、别名匹配尚未完整落地。

### 4.2 Preview Wiki 语法表达不足

当前预览层把 `[[...]]` 转为一个可点击 `span`，但未拆分显示文本和锚点，也没有 resolved/unresolved 样式区分。

### 4.3 反链面板缺少未解析链接区

当前面板展示 outgoing 和 incoming，未将 unresolved 单独作为用户可扫描的信息区。

### 4.4 搜索 API 固定 limit 且空搜索只显示提示

当前后端查询固定 `LIMIT 20`，前端空查询时显示提示文本。Phase 2 设计期望空输入可以显示最近笔记，搜索结果上限可到 50。

### 4.5 file_events 表未承担诊断职责

当前 schema 已有 `file_events`，但 watcher 处理外部 create/modify/remove 时没有写入事件记录，也没有记录处理失败原因。

## 5. 方案概览

Phase 2.5 采用三个小切片：

| 切片 | 内容 | 主要价值 |
| --- | --- | --- |
| S1 | 链接模型与反链 UI 对齐 | 稳定后续关系、图谱和修订关联的基础数据。 |
| S2 | 搜索小补齐 | 改善搜索入口可用性，同时保持搜索范围克制。 |
| S3 | watcher file_events 诊断 | 为外部同步、冲突处理和索引重建提供可追踪证据。 |

三个切片可以按顺序实施。S1 优先级最高，因为 Phase 3B 的手动关系和 Phase 3C 的局部图谱都依赖清晰的链接基础。

## 6. 链接模型对齐

### 6.1 RawLink 表达

后端 `RawLink` 保持当前字段，但解析规则需要明确：

- Wiki 链接：
  - `[[目标]]` → `target_raw = 目标`，`display_text = null`，`anchor = null`。
  - `[[目标|文本]]` → `target_raw = 目标`，`display_text = 文本`。
  - `[[目标#章节]]` → `target_raw = 目标`，`anchor = 章节`。
  - `[[目标#章节|文本]]` → `target_raw = 目标`，`anchor = 章节`，`display_text = 文本`。
- Markdown 链接：
  - `[文本](notes/a.md)` 作为 `link_type = markdown`。
  - `[文本](notes/a.md#h2)` 拆出 `anchor = h2`。
  - `![图片](../assets/images/a.png)` 作为 `link_type = asset`。
  - `http://` 和 `https://` 作为外链，不参与 note target 解析。

### 6.2 解析优先级

`resolve_link_target` 扩展为以下顺序：

1. 精确匹配 `notes.id`。
2. 精确匹配规范化后的 `notes.path`。
3. 精确匹配 `notes.title`。
4. 精确匹配 `front_matter_json` 中的 `aliases`。
5. 忽略大小写匹配 `notes.title`。
6. 忽略大小写匹配 `aliases`。
7. 无匹配则保持 unresolved。

路径匹配必须使用知识库相对路径，并通过现有安全路径规范化逻辑处理。Markdown 链接中的相对路径如果是相对当前笔记所在目录，需要先归一到知识库相对路径。

### 6.3 Front Matter JSON

当前 `notes.front_matter_json` 写入固定 `{}`。本轮需要在索引时保存解析后的 Front Matter JSON，至少包含 `id`、`title`、`tags`、`summary`、`aliases`。这样 aliases 可以由 SQLite 查询使用，也为 Phase 3 的 summary 和 revision 提供一致来源。

### 6.4 LinkItem 与 NoteLinks

后端 `get_note_links` 返回三类列表：

```text
NoteLinks {
  outgoing: LinkItem[]
  backlinks: LinkItem[]
  unresolved: LinkItem[]
}
```

`unresolved` 表示当前笔记中 `source_note_id = note_id AND resolved = 0` 的链接。对于外链，若不解析到本地笔记但 `link_type = external`，不进入 unresolved。

`LinkItem` 保持前端已有字段命名，避免大范围前端改动：

```text
LinkItem {
  id: string
  note_id: string
  note_title: string
  note_path: string
  link_text: string
  link_url: string
  link_type: string
  resolved: boolean
}
```

未解析链接的 `note_id`、`note_title`、`note_path` 为空字符串，`link_url` 使用原始 target。

## 7. 搜索小补齐

### 7.1 search_notes 参数

后端 command 改为支持可选 limit：

```text
search_notes(query: string, kb_id: string, limit?: number) -> SearchResult[]
```

规则：

- 默认 `limit = 20`。
- 最大 `limit = 50`。
- 小于 1 时按默认值处理。
- 本轮不加入 filters、offset 和分页。

### 7.2 空搜索最近笔记

新增后端 command：

```text
list_recent_notes(limit?: number) -> Note[]
```

首版最近笔记的定义采用可直接实现且稳定的规则：

1. 优先按 `notes.updated_at DESC`。
2. 排除 `deleted_at IS NOT NULL`。
3. 默认返回 10 条，最大返回 20 条。

这不是严格的“最近访问”，但能满足空搜索入口的可用性。真正的最近访问记录可在 Phase 3 设置/历史能力中补充。

### 7.3 前端行为

`SearchOverlay` 空输入时调用最近笔记并展示标题、路径和更新时间。用户输入搜索词后切换为 `useSearch` 的搜索结果。

键盘行为保持不变：

- `ArrowDown` / `ArrowUp` 切换选中项。
- `Enter` 打开选中结果。
- `Escape` 关闭弹层。

## 8. Watcher 诊断事件

### 8.1 事件写入规则

watcher 每次处理 Markdown 文件事件时写入 `file_events`：

| 字段 | 规则 |
| --- | --- |
| `id` | 新 ULID。 |
| `event_type` | `create`、`modify`、`delete`、`rename`。notify 无法稳定区分 rename pair 时使用 `delete` + `create`。 |
| `path` | 知识库相对路径。 |
| `old_path` | rename 可获得旧路径时写入；否则为空。 |
| `content_hash` | 文件存在且可读时写入当前内容 hash；删除事件为空。 |
| `processed` | 成功处理为 1，失败为 0。 |
| `error` | 失败时保存错误摘要。 |
| `created_at` | watcher 收到并准备处理的时间。 |
| `processed_at` | 处理结束时间。 |

### 8.2 事务边界

单个 watcher 事件处理应在数据库层尽量保持一致：

- create/modify：索引成功后写入 processed event，索引失败时写入 failed event。
- remove：软删除成功后写入 processed event，失败时写入 failed event。
- 事件日志失败不能阻断索引主流程，但必须输出错误日志。

### 8.3 事件保留策略

本轮不实现清理策略，只写入事件。后续可以在设置或维护任务中增加按数量或时间清理。

## 9. 前端交互

### 9.1 MarkdownPreview

预览层需要在安全渲染后呈现 Wiki 链接：

- resolved 链接使用普通强调色和实线下划线。
- unresolved 链接使用红色或警示色，并使用虚线下划线。
- hover 显示原始 target 或目标 path。
- 点击 resolved 链接打开目标笔记。
- 点击 unresolved 链接本轮只阻止默认行为，不创建笔记。

由于预览层当前没有每个 Wiki 链接的后端解析结果，本轮可以采用两阶段方案：

1. 根据语法正确渲染显示文本和 data attributes。
2. 点击时按标题或路径解析目标；解析失败时保持 unresolved 样式。

如果要在渲染时就显示 resolved/unresolved，需要新增 preview links 查询，这会扩大范围，暂不作为本轮必需项。

### 9.2 BacklinksPanel

右侧反链面板展示三段：

1. 出链：当前笔记指向的本地笔记和外链。
2. 反链：其他笔记指向当前笔记。
3. 未解析链接：当前笔记中无法解析为本地笔记的 Wiki/Markdown note 链接。

未解析链接需要在视觉上明显区别，但不使用弹窗或复杂操作。

### 9.3 SearchOverlay

空搜索展示最近笔记后，搜索弹层第一屏不再是纯提示。输入关键词后保持当前搜索体验。

## 10. 数据与兼容性

本轮不新增数据库表。使用已有表：

- `notes.front_matter_json`：从 `{}` 改为保存解析后的 Front Matter JSON。
- `links`：继续保存解析结果和 resolved 状态。
- `file_events`：开始记录 watcher 诊断事件。

兼容性要求：

- 旧库中已有 `front_matter_json = '{}'` 的笔记在下一次索引或保存后自动补齐。
- 旧链接在下一次保存、外部修改或全量 reconcile 后按新解析优先级更新。
- 不要求一次性迁移所有旧记录。

## 11. 测试策略

### 11.1 Rust 测试

新增或扩展测试覆盖：

- `extract_links` 支持 `[[目标#章节|文本]]`。
- `index_note_full` 保存 `front_matter_json`。
- 链接按 ID 匹配。
- 链接按相对路径匹配。
- 链接按 aliases 匹配。
- 删除/恢复后 unresolved 状态仍正确。
- `get_note_links` 返回 unresolved 分组。
- `search_notes` limit 默认值、上限和传参生效。
- `list_recent_notes` 排序和上限。
- watcher 事件处理成功/失败时写入 `file_events` 的核心函数测试。

### 11.2 前端测试

新增或扩展 Vitest 测试覆盖：

- `MarkdownPreview` 渲染 Wiki 显示文本和锚点。
- `MarkdownPreview` 对 unresolved 样式不产生危险 HTML。
- `BacklinksPanel` 展示出链、反链、未解析链接三段。
- `SearchOverlay` 空输入显示最近笔记，输入关键词后显示搜索结果。

### 11.3 验证命令

完成后至少运行：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm test:run
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
cd /Users/lijun/mynote/src-tauri && cargo test
```

涉及搜索弹层或启动页交互时补跑：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm test:e2e
```

## 12. 验收标准

1. 一篇笔记通过 `[[目标#章节|阅读这里]]` 显示为 `阅读这里`，点击可打开目标笔记。
2. Wiki 链接能通过 note id、相对路径、标题、aliases 匹配目标。
3. 当前笔记的未解析链接在右侧反链面板独立展示。
4. 空搜索弹层显示最近更新笔记；输入关键词后展示搜索结果。
5. `search_notes` limit 支持传入值并限制最大 50。
6. watcher 处理 Markdown 文件变更后可在 `file_events` 看到处理记录。
7. 现有 Phase 2 功能不回退，自动化验证通过。

## 13. 风险与处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 路径链接解析引入路径逃逸 | 本地文件安全风险 | 所有路径匹配先使用既有知识库相对路径规范化，拒绝 `../` 逃逸。 |
| aliases 查询使用 JSON 字段导致 SQL 复杂 | 实现复杂度上升 | 首版可在 Rust 中读取候选 notes 的 `front_matter_json` 后匹配；后续再考虑 JSON1 查询优化。 |
| preview 渲染时无法提前知道 resolved 状态 | UI 样式可能滞后 | 本轮优先保证语法和点击解析；resolved/unresolved 精确样式可由 BacklinksPanel 提供明确反馈。 |
| file_events 记录过多 | 数据库膨胀 | 本轮只记录，不清理；后续设置/维护任务中增加保留策略。 |
| 搜索最近笔记不是最近访问 | 语义轻微偏差 | 文档明确首版按 `updated_at`，真正访问历史后续实现。 |
