# Search Fallback Performance Design

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义搜索 fallback 性能风险的后端查询收敛设计。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标](#2-目标)
- [3. 非目标](#3-非目标)
- [4. 设计方案](#4-设计方案)
- [5. 查询行为](#5-查询行为)
- [6. 数据流](#6-数据流)
- [7. 错误处理](#7-错误处理)
- [8. 测试策略](#8-测试策略)
- [9. 后续扩展](#9-后续扩展)

## 1. 背景

当前搜索命令使用 SQLite FTS5 作为主搜索路径，并额外提供 LIKE fallback。fallback 的初衷是补足 FTS 分词无法覆盖的场景，例如导入文件名、路径片段、中文文件名中的子串，以及用户输入 `%`、`_`、`\\` 等字符时仍按字面量搜索。

现有 fallback 在同一条查询中对 `note_fts.summary` 和 `note_fts.body` 执行 `%term%`。在大知识库或长正文场景下，这会绕开 FTS 索引并扫描大文本列。搜索入口有前端 debounce，但 debounce 只能减少请求次数，不能消除单次查询的正文扫描风险。

本轮 P2 风险修复优先保证大知识库响应稳定，而不是保留正文任意子串匹配。

## 2. 目标

本次修复目标如下：

- 搜索正文、摘要、标题时继续优先使用 FTS5。
- fallback 只覆盖轻量 metadata 子串匹配：`notes.title` 和 `notes.path`。
- 移除 fallback 对 `summary/body` 的 `%term%` 扫描。
- 保留导入文件名和路径片段搜索能力。
- 保留 LIKE wildcard 转义，确保 `%`、`_`、`\\` 被当作普通字符。
- 保持前端 API、返回结构、结果数量上限和主要排序规则不变。
- 增加回归测试，证明 body-only 子串不会再由 fallback 命中。

## 3. 非目标

本轮不做以下内容：

- 前端 UI 或 `SearchResult` 类型变更。
- 新增分页、过滤器、搜索设置或异步二阶段结果刷新。
- 引入 trigram tokenizer、外部分词库或新的全文索引表。
- 为 `summary/body` 提供任意子串搜索。
- 重写搜索排序模型或结果高亮模型。

## 4. 设计方案

采用“FTS 主路径 + title/path metadata fallback”的方案。

后端仍以 `src-tauri/src/commands/search.rs` 中的 `search_notes_in_conn()` 为唯一查询入口。查询保留两个来源：

- `fts_matches`：使用 `note_fts MATCH ?1`，覆盖 `title`、`summary`、`body` 的 FTS 搜索。结果优先展示，继续使用 `snippet(note_fts, 2, '<mark>', '</mark>', '...', 20)` 生成摘要片段。
- `metadata_matches`：使用 `notes.title LIKE ?2 ESCAPE '\\' OR notes.path LIKE ?2 ESCAPE '\\'`，只覆盖标题和路径子串。结果排在 FTS 之后，并排除已在 FTS 中命中的 note。

需要删除现有 fallback 中的以下条件：

```sql
OR COALESCE(note_fts.summary, '') LIKE ?2 ESCAPE '\\'
OR COALESCE(note_fts.body, '') LIKE ?2 ESCAPE '\\'
```

为了让命名表达真实行为，`like_matches` 可以重命名为 `metadata_matches`。这不是功能要求，但能降低后续误把 fallback 扩回正文扫描的风险。

## 5. 查询行为

查询语义如下：

1. 空白 query 直接返回空数组。
2. 非空 query 构造 FTS prefix query：`"{escaped}"*`。
3. 同时构造 LIKE query：`%{escaped}%`，并转义 `%`、`_`、`\\`。
4. `fts_matches` 返回 FTS 命中的未删除笔记。
5. `metadata_matches` 返回标题或路径子串命中的未删除笔记，并排除已在 `fts_matches` 中出现的 note。
6. 最终结果 `UNION ALL` 后按 `source_order, rank` 排序，保留 `LIMIT 20`。

预期行为变化：

- 如果 query 是正文或摘要中的完整 FTS token/prefix，仍可通过 FTS 命中。
- 如果 query 只存在于正文或摘要的任意子串中，且 FTS 不能命中，不再通过 fallback 返回。
- 如果 query 只存在于标题或路径子串中，仍通过 metadata fallback 返回。

## 6. 数据流

用户在前端搜索框输入 query：

1. `useSearch()` debounce 后调用 `api.searchNotes(query, kb.id)`。
2. Tauri command `search_notes()` 获取当前 SQLite connection。
3. `search_notes_in_conn()` 执行 FTS 主查询和 metadata fallback。
4. Rust 返回 `Vec<SearchResult>`，字段保持 `note_id/title/path/snippet`。
5. 前端继续按现有方式渲染搜索结果。

本轮不改变索引写入流程。`index_note_full()` 仍将 `title/summary/body` 写入 `note_fts`，保证 FTS 主路径覆盖全文搜索。

## 7. 错误处理

- SQLite 查询准备或执行失败时继续返回 `AppError`。
- LIKE 转义函数继续作为纯函数测试，避免 wildcard 被解释成模式字符。
- 删除笔记通过 `n.deleted_at IS NULL` 排除，保持现有语义。
- metadata fallback 不再 `LEFT JOIN note_fts`，避免 note 与 FTS 不一致时因为 join 影响标题/路径匹配。

## 8. 测试策略

在 `src-tauri/src/commands/search.rs` 的现有测试模块中扩展测试：

- `search_notes_matches_imported_filename_substrings`：保留现有路径/标题子串命中测试。
- `search_notes_treats_like_wildcards_as_literals`：保留 wildcard 字面量测试。
- 新增 `search_notes_matches_body_fts_prefix`：正文中存在 FTS 可命中的词，query 通过 FTS 返回结果。
- 新增 `search_notes_does_not_scan_body_substrings_in_fallback`：正文中存在一个 FTS 不可命中的子串，标题和路径不包含该 query，搜索返回空。
- 新增 `search_notes_does_not_scan_summary_substrings_in_fallback`：摘要中存在一个 FTS 不可命中的子串，标题和路径不包含该 query，搜索返回空。

可选增加轻量性能回归测试：构造多篇包含长 body 的笔记，搜索只存在于 body 子串中的 query，断言返回空并避免依赖耗时阈值。测试重点是查询行为，而不是用不稳定的时间断言证明性能。

验证命令：

```bash
cd /Users/lijun/mynote/src-tauri && cargo test commands::search::tests
cd /Users/lijun/mynote/src-tauri && cargo test
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm build
```

## 9. 后续扩展

如果后续确实需要正文任意子串搜索，可以单独设计：

- SQLite FTS5 trigram tokenizer，用存储空间换取正文子串查询性能。
- 后台异步慢搜索，在主结果返回后追加更宽泛的匹配。
- 用户可配置搜索模式，例如“快速搜索”和“深度搜索”。

这些能力会改变搜索体验和索引成本，不纳入本次 P2 性能风险修复。