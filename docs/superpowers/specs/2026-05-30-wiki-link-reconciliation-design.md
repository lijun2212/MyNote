# Wiki Link Reconciliation Design

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义 Wiki link reconciliation 的后端数据一致性设计。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标](#2-目标)
- [3. 非目标](#3-非目标)
- [4. 设计方案](#4-设计方案)
- [5. 数据流](#5-数据流)
- [6. 解析规则](#6-解析规则)
- [7. 错误处理](#7-错误处理)
- [8. 测试策略](#8-测试策略)
- [9. 后续扩展](#9-后续扩展)

## 1. 背景

当前 MyNote Phase 2 已支持 Wiki 链接解析、出链、反链和文件监听。现有实现只在索引当前笔记时解析当前笔记中的 links：如果 A 笔记先写 `[[B]]`，而 B 当时不存在，A 的 link 会保存为 unresolved；随后创建 B 时，A 的旧 link 不会自动变成 resolved，B 的反链也不会出现 A。

这个问题会破坏知识库的核心数据一致性：链接状态取决于索引顺序，而不是当前 notes 表的真实状态。

## 2. 目标

本次 P1 修复的目标是让链接解析结果与当前笔记集合保持一致：

- 先创建 A，内容包含 `[[B]]`，B 不存在时，A 的 link 保持 unresolved。
- 后创建 B 后，A 中 `target_raw = "B"` 的 link 自动 resolved 到 B。
- 如果 B 被删除，指向 B 的 incoming links 自动回退 unresolved。
- 如果 B 标题变化，旧标题指向应回退 unresolved，新标题匹配的 unresolved links 应自动 resolved。
- `index_note_full()` 中当前笔记的新 links 与 reconciliation 使用同一套解析规则。
- 保持所有 links、tags、FTS 更新仍在单个 SQLite 事务内完成。

## 3. 非目标

本轮不做以下内容：

- 前端 UI 改动。
- 新增手动关系或知识图谱。
- Markdown 相对路径链接的完整重命名跟踪。
- 多个同名标题的交互式消歧。
- 全库后台任务调度器。

## 4. 设计方案

采用独立 reconciliation 函数，但先保留在 `src-tauri/src/services/index.rs` 中，避免过早拆文件。

新增/调整后端函数：

- `resolve_link_target(tx, target_raw) -> AppResult<Option<String>>`
  - 统一解析 `target_raw` 对应的 note id。
  - 初始规则沿用当前实现：精确标题匹配，失败后忽略大小写标题匹配。

- `reconcile_links_for_note(tx, note_id, title, now) -> AppResult<()>`
  - 当前 note 新建或更新后调用。
  - 将所有 `target_raw` 可解析到当前 note 的 links 更新为 `target_note_id = note_id, resolved = 1`。
  - 将所有原本指向当前 note、但 `target_raw` 已不能解析到当前 note 的 links 回退为 unresolved。

- `reconcile_all_links(conn) -> AppResult<()>`
  - 遍历所有 links，按当前 notes 表重新计算 `target_note_id` 和 `resolved`。
  - 本轮主要用于测试和未来全量重建入口。

调整现有流程：

- `index_note_full()` 插入当前笔记新 links 时调用 `resolve_link_target()`。
- `index_note_full()` 完成当前笔记 note/tags/links/FTS 更新后，在同一事务中调用 `reconcile_links_for_note()`。
- `mark_note_deleted_by_path()` 保留现有行为：软删除 note，清理自身出链，并将 incoming links 回退 unresolved。

## 5. 数据流

创建 A，A 内容为 `[[B]]`：

1. `index_note_full(A)` 解析 A 的 link。
2. `resolve_link_target("B")` 找不到目标。
3. 插入 link：`target_note_id = NULL, resolved = 0`。
4. `reconcile_links_for_note(A)` 不影响该 link。

创建 B，标题为 `B`：

1. `index_note_full(B)` upsert B。
2. B 自身 links/tags/FTS 更新。
3. `reconcile_links_for_note(B)` 查找所有可解析到 B 的 links。
4. A 的旧 unresolved link 更新为 `target_note_id = B.id, resolved = 1`。
5. B 的反链查询开始返回 A。

删除 B：

1. `mark_note_deleted_by_path(B)` 设置 `notes.deleted_at`。
2. 删除 B 自身 FTS、tags、outgoing links。
3. 所有 `target_note_id = B.id` 的 incoming links 更新为 `target_note_id = NULL, resolved = 0`。

标题从 B 改为 C：

1. `index_note_full(B path, title C)` 更新 note title。
2. `reconcile_links_for_note(note_id, "C")` 解析新标题。
3. 原来 `target_raw = "B"` 且指向该 note 的 links 回退 unresolved。
4. `target_raw = "C"` 的 unresolved links resolved 到该 note。

## 6. 解析规则

初始解析优先级：

1. `notes.title = target_raw AND deleted_at IS NULL`。
2. `lower(notes.title) = lower(target_raw) AND deleted_at IS NULL`。

如果存在多个同名标题，沿用当前 `LIMIT 1` 行为。本轮不引入消歧；后续可在唯一标题约束、路径匹配、或 UI 提示中处理。

## 7. 错误处理

- Reconciliation 在 `index_note_full()` 的 SQLite transaction 内执行。
- 任一步失败时事务回滚，避免 notes 已更新但 links 未同步的中间状态。
- 删除笔记时如果 path 不存在于 DB，`mark_note_deleted_by_path()` 保持幂等，返回 Ok。
- 对非法相对路径继续复用 `normalize_kb_relative_path()`，拒绝 `../` 逃逸。

## 8. 测试策略

优先补 Rust 单元测试，走真实 SQLite in-memory/temp DB，不 mock 数据库：

1. `indexing_later_target_resolves_existing_unresolved_wiki_link`
   - 先索引 A：`# A\n\n[[B]]`。
   - 断言 links 中 `resolved = 0`。
   - 再索引 B：`# B\n\n`。
   - 断言 A 的 link `resolved = 1` 且 `target_note_id = B.id`。

2. `renaming_target_unresolves_old_title_and_resolves_new_title`
   - 建立 A 指向 `[[B]]`，C 指向 `[[C]]`。
   - 索引目标 note 初始标题 B。
   - 再用同一路径索引为标题 C。
   - 断言 A 的 link 回退 unresolved，C 的 link resolved。

3. `reconcile_all_links_recomputes_links_from_current_notes`
   - 手工插入 stale link。
   - 调用 `reconcile_all_links()`。
   - 断言 resolved 状态按当前 notes 表修正。

4. 保留并继续运行已有删除测试：`mark_note_deleted_clears_derived_indexes`。

验证命令：

```bash
cd /Users/lijun/mynote/src-tauri && cargo test services::index -- --nocapture
cd /Users/lijun/mynote/src-tauri && cargo test
cd /Users/lijun/mynote && corepack pnpm build
```

## 9. 后续扩展

本轮完成后，后续可继续扩展：

- path/id 解析优先级。
- 全库索引重建 command。
- 同名标题检测与 UI 提示。
- 文件 rename 时更精确地更新 path-based links。
- 前端反链面板增加“重新解析链接”入口。
