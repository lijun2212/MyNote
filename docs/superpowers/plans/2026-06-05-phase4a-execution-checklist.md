# Phase 4A 回看摘要执行清单（文件/函数级）

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-05 | v1.0 | 基于 2026-06-05-phase4-lookback-summary.md 输出可直接分派的执行清单。 |

## 目录

- [1. 目标](#1-目标)
- [2. 实施顺序](#2-实施顺序)
- [3. 前端任务清单](#3-前端任务清单)
- [4. 后端任务清单](#4-后端任务清单)
- [5. 测试任务清单](#5-测试任务清单)
- [6. 验收门槛](#6-验收门槛)
- [7. 分工建议](#7-分工建议)

## 1. 目标

把“总结陈词”升级为“回看摘要”，并满足三条硬约束：

- 半自动：先给候选摘要，用户确认后再落库。
- 低负担：默认不强制，不高频打扰。
- 开头可见：放在文章标题下方、正文前。

## 2. 实施顺序

1. 数据层先行：确认 `summary` 字段读写、搜索链路稳定。
2. 展示层落位：把回看摘要区块放到文章开头。
3. 候选摘要接入：实现规则生成和“确认写入”。
4. 低打扰策略：加入高价值触发和节流。
5. 全链路回归：单测 + 集成 + e2e。

## 3. 前端任务清单

### FE-1 文案与类型统一

- 文件：`src/types/index.ts`
  - 任务：确认笔记元数据 DTO 的 `summary` 注释语义改为“回看摘要”。
- 文件：`src/components/**`（全局检索）
  - 任务：把 UI 可见文案“总结陈词”替换为“回看摘要”。

完成标准：

- UI 内不再出现“总结陈词”旧文案。

### FE-2 开头区块（预览视图）

- 文件：`src/components/EditorWorkspace/MarkdownPreview.tsx`
  - 任务：在标题渲染后、正文渲染前插入回看摘要区块。
  - 任务：区块状态
    - 有 `summary`：展示摘要 + 编辑入口。
    - 无 `summary`：展示“生成候选摘要”按钮与简短说明。
  - 任务：默认展开，允许折叠。

完成标准：

- 打开笔记时第一屏可见该区块。

### FE-3 开头区块（编辑视图）

- 文件：`src/components/EditorWorkspace/*`（按当前编辑器容器实际文件落点）
  - 任务：编辑模式同步显示回看摘要区块，位置与预览保持一致。
  - 任务：支持轻量编辑（单行/多行输入 + 保存）。

完成标准：

- 编辑和预览两个模式视觉位置一致，不出现“只在某一侧可见”。

### FE-4 候选摘要交互

- 文件：`src/api/commands.ts`
  - 任务：新增或扩展命令调用：请求候选摘要。
- 文件：`src/components/EditorWorkspace/*`
  - 任务：新增“生成候选摘要”流程：
    - 点击生成。
    - 显示候选文本。
    - 用户确认后保存到 `summary`。
    - 用户取消则不落库。

完成标准：

- 候选摘要不是自动保存，必须用户显式确认。

### FE-5 低打扰触发与节流

- 文件：`src/store/useEditorStore.ts`
  - 任务：增加提示展示状态与节流时间戳（按 note 维度）。
- 文件：`src/hooks/useOpenNote.ts`
  - 任务：打开笔记后根据条件决定是否提示“可生成回看摘要”。
- 文件：`src/hooks/useKnowledgeBase.ts` 或相关统计来源
  - 任务：接入“高价值笔记”判断输入（字数、访问次数、反向链接数）。

完成标准：

- 同一笔记 24 小时内最多提示一次。
- 非高价值笔记默认不提示。

### FE-6 搜索与列表展示联动

- 文件：`src/hooks/useSearch.ts`
  - 任务：确认搜索结果 DTO 中可回传 `summary` 片段。
- 文件：`src/components/SearchOverlay.tsx`
  - 任务：在结果项展示回看摘要片段（有值时显示）。
- 文件：`src/components/LeftSidebar/*`（列表项渲染位置）
  - 任务：可选显示回看摘要短片段，不制造空占位噪音。

完成标准：

- 用户可凭摘要片段快速判断是否打开目标笔记。

## 4. 后端任务清单

### BE-1 命令层

- 文件：`src-tauri/src/commands/`（建议新建 `summary.rs`，并在 mod 中注册）
  - 任务：新增命令
    - `generate_summary_candidate(note_id | path)`
    - `save_note_summary(note_id | path, summary)`
  - 任务：命令返回结构统一（成功、可读错误信息）。

完成标准：

- 前端通过 Tauri 命令可完整走通“生成 -> 确认保存”。

### BE-2 规则生成器

- 文件：`src-tauri/src/services/`（建议 `summary_service.rs`）
  - 任务：实现规则候选摘要：
    - 提取首段主旨。
    - 合并 h1/h2 关键信息。
    - 截断到合理长度（例如 120-220 字可配置）。
  - 任务：保证空文档、超短文档可返回可理解结果。

完成标准：

- 不依赖外部模型，离线可用，耗时可控。

### BE-3 存储与索引

- 文件：`src-tauri/src/infrastructure/`（笔记读写与索引相关模块）
  - 任务：确认 Front Matter `summary` 读写稳定。
  - 任务：SQLite 冗余索引字段与更新逻辑保持一致。
- 文件：`src-tauri/src/domain/`
  - 任务：补齐摘要相关 DTO 和序列化字段。

完成标准：

- `summary` 在文件层、内存层、索引层三处一致。

### BE-4 搜索融合

- 文件：`src-tauri/src/commands/search.rs` 与相关服务
  - 任务：将 `summary` 纳入搜索命中与排序信号。
  - 任务：命中信息可回传前端展示片段。

完成标准：

- 搜索关键字可命中回看摘要内容。

## 5. 测试任务清单

### TEST-1 前端单测

- 文件：`src/components/EditorWorkspace/MarkdownPreview.test.tsx`
  - 覆盖：区块开头可见、无摘要时入口、有摘要时展示。
- 文件：`src/components/SearchOverlay.test.tsx`
  - 覆盖：结果项展示摘要片段。
- 文件：`src/hooks/useOpenNote*.test.tsx`
  - 覆盖：高价值触发、24h 节流、非高价值不提示。

### TEST-2 后端单测

- 文件：`src-tauri/src/services/summary_service.rs`（新建）
  - 覆盖：空文档、短文档、长文档、含标题结构文档。
- 文件：`src-tauri/src/commands/summary.rs`（新建）
  - 覆盖：生成命令和保存命令成功/失败分支。

### TEST-3 端到端

- 文件：`tests/e2e/`（新增回看摘要场景）
  - 覆盖：打开笔记 -> 生成候选 -> 保存 -> 搜索命中 -> 再打开可见。

## 6. 验收门槛

满足以下全部条件才可标记完成：

- 用户不填写也可正常写作。
- 开头区块稳定可见，不与现有编辑/预览布局冲突。
- 候选摘要需要用户确认才保存。
- 提示不骚扰：同笔记 24h 最多一次。
- 自动化测试通过：
  - `corepack pnpm vitest run`
  - `corepack pnpm build`
  - `cd src-tauri && cargo test`

## 7. 分工建议

- FE-A：FE-1、FE-2、FE-3
- FE-B：FE-4、FE-5、FE-6
- BE-A：BE-1、BE-2
- BE-B：BE-3、BE-4
- QA：TEST-1、TEST-2、TEST-3

每个子任务提交时需附：

- 改动文件列表
- 测试命令与通过截图/日志
- 风险点与回退说明
