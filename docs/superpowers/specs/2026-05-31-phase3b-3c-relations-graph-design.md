# MyNote Phase 3B/3C — Manual Relations and Local Graph Design

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-31 | v1.0 | 建立 Phase 3B/3C 设计，统一手动关系管理边界，并为局部知识图谱预留数据契约。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标](#2-目标)
- [3. 非目标](#3-非目标)
- [4. 当前基线与差距](#4-当前基线与差距)
- [5. 方案概览](#5-方案概览)
- [6. 手动关系模型](#6-手动关系模型)
- [7. 后端接口与服务边界](#7-后端接口与服务边界)
- [8. 前端交互设计](#8-前端交互设计)
- [9. 为 Phase 3C 预留的图谱契约](#9-为-phase-3c-预留的图谱契约)
- [10. 数据迁移与兼容性](#10-数据迁移与兼容性)
- [11. 测试策略](#11-测试策略)
- [12. 验收标准](#12-验收标准)
- [13. 风险与处理](#13-风险与处理)

## 1. 背景

Phase 3A 已完成总结陈词和修订记录，当前产品已具备笔记内容沉淀、历史回溯和基础链接导航能力。对照基础设计与详细设计，阶段四剩余核心能力是手动关系管理，阶段五的首要能力是当前笔记的一跳或两跳局部图谱。

本轮采用“3B 和 3C 一起设计、但只实现 3B”的策略。原因不是为了提前扩 scope，而是为了避免 3B 在数据模型、命令接口和前端交互上做完后，3C 再来时被迫改 schema、改 DTO 或改面板结构。

## 2. 目标

1. 在 SQLite 中建立稳定的手动关系数据模型，作为 Markdown 无法推导数据的一部分长期保存。
2. 提供最小可用的手动关系 CRUD，支持用户从当前笔记创建、查看和删除关系。
3. 在右侧栏中把自动链接信息和手动关系信息放在同一知识关联工作面内，减少切换成本。
4. 固定 Phase 3C 将要消费的 GraphData 契约，确保 3B 完成后无需返工 relation schema 或 relation DTO。
5. 保持 Markdown 文件仍然是正文和 Front Matter 的权威来源，手动关系继续以 SQLite 为权威来源。

## 3. 非目标

本轮不实现以下能力：

- GraphView 组件或局部图谱渲染。
- 一跳和两跳图谱查询逻辑。
- 按标签、目录、关系类型的图谱过滤 UI。
- 关系批量编辑、关系类型自定义和关系说明富文本。
- 未解析链接到手动关系的自动建议或自动转换。
- 在 Markdown Front Matter 中持久化手动关系。
- 关系导入导出、数据库备份策略增强或跨知识库关系。

## 4. 当前基线与差距

### 4.1 已有基础能力

当前系统已具备：

- `links` 表和 `get_note_links(note_id)`，可展示出链、反链和未解析链接。
- 右侧栏 `links` 页签，可作为知识关联信息的现有入口。
- 已稳定的 note ID、path、title、aliases、summary 索引和 watcher 更新链路。
- 已完成的 summary/revision 体系，可为后续图谱节点补充 summary 元数据。

### 4.2 当前差距

当前缺少以下能力，导致设计与实现仍不完全一致：

- 无 `relations` 表，也无手动关系 service 或 command。
- UI 无法表达“相关 / 前置 / 支撑 / 反驳”等非链接关系。
- 右侧栏的知识关联信息仍局限在自动解析链接，没有为关系管理留出稳定位置。
- GraphData 只存在于详细设计文档中，当前工程还没有面向前端的实际 API 契约。

## 5. 方案概览

本轮方案分为两个切片：

| 切片 | 内容 | 本轮状态 |
| --- | --- | --- |
| S1 | 手动关系管理 | 本轮实现 |
| S2 | 局部图谱数据契约与 UI 落点 | 本轮只定边界，不实现 |

实施顺序：

1. 新增 `relations` 表及索引。
2. 新增 relation 领域模型、service 和 Tauri commands。
3. 在右侧栏 `链接` 页签内增加手动关系区和创建入口。
4. 固定 GraphData、GraphNode、GraphEdge 的前后端契约，供 3C 直接复用。

推荐交互策略是：右侧栏继续保留现有 `链接` 页签，不新增新的关系页签；在 `链接` 页签内部把自动链接和手动关系作为同一类“知识关联信息”分区展示。这样可以保持右侧栏紧凑，也更符合“关系是在链接基础上进一步补充语义”的产品心智。

## 6. 手动关系模型

### 6.1 数据权威性

手动关系仍以 SQLite `relations` 表为权威来源，不回写 Markdown。理由：

- 手动关系不是当前 Markdown 文件能够稳定表达的结构化字段。
- 回写 Front Matter 会扩大文件冲突面，也会增加用户直接编辑文件时的负担。
- 图谱、过滤和未来的关系统计都更适合直接查询数据库。

### 6.2 Relation 结构

Relation 延续详细设计中的主结构：

```text
Relation {
  id: string
  source_note_id: string
  target_note_id: string
  relation_type: "related" | "prerequisite" | "extension" | "opposes" | "supports" | "similar"
  description: string | null
  created_at: datetime
  updated_at: datetime
}
```

### 6.3 关系类型

首版固定六种关系类型，不开放自定义：

- `related`：相关
- `prerequisite`：前置知识
- `extension`：延伸阅读
- `opposes`：反驳
- `supports`：支撑
- `similar`：同义或相似

前端展示使用中文标签，后端和数据库持久化使用英文枚举值。

### 6.4 方向性语义

所有手动关系在存储层均为有向边：

- `source_note_id` 表示当前发起关系的笔记。
- `target_note_id` 表示关系指向的目标笔记。

即使 `related` 和 `similar` 在语义上更接近双向关系，首版也不自动写入反向记录。原因：

- 只保存一条记录，避免删除和编辑时双写一致性问题。
- 未来图谱层可以在渲染时把 `related` / `similar` 作为弱方向或无箭头边来展示。
- 右侧关系列表可以同时展示 outgoing 和 incoming，满足用户认知需要。

### 6.5 去重规则

首版禁止完全重复关系：

- 同一 `source_note_id`
- 同一 `target_note_id`
- 同一 `relation_type`

三者完全相同视为同一条关系。若用户再次创建，返回已存在关系而不是插入新记录。

`description` 不参与唯一性判断；同类型同目标只允许维护一条说明，后续若需要编辑说明，再单独补 `update_relation`。

### 6.6 删除与笔记生命周期

- 任一笔记删除或进入软删除状态后，该笔记相关的手动关系不再在前端展示。
- 若后端沿用外键 `ON DELETE CASCADE`，物理删除时同步清理 relations。
- 本轮不新增“关系回收站”。

### 6.7 列表返回模型

为了让 UI 不必自行拼接方向语义，`list_relations(note_id)` 首版返回分组模型而不是扁平数组：

```text
NoteRelations {
  outgoing: RelationItem[]
  incoming: RelationItem[]
}

RelationItem {
  id: string
  relation_type: string
  description: string | null
  note_id: string
  note_title: string
  note_path: string
  created_at: string
  updated_at: string
}
```

其中：

- `outgoing` 的 `note_*` 字段表示 target note。
- `incoming` 的 `note_*` 字段表示 source note。

这样前端不需要再根据 direction 额外查 note 详情。

## 7. 后端接口与服务边界

### 7.1 数据库 schema

本轮新增 `relations` 表及索引：

```sql
CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  source_note_id TEXT NOT NULL,
  target_note_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX idx_relations_source ON relations(source_note_id);
CREATE INDEX idx_relations_target ON relations(target_note_id);
CREATE INDEX idx_relations_type ON relations(relation_type);
CREATE UNIQUE INDEX idx_relations_unique_triplet
ON relations(source_note_id, target_note_id, relation_type);
```

### 7.2 Command 设计

本轮落以下 commands：

```text
create_relation(source_note_id, target_note_id, relation_type, description) -> Relation
delete_relation(relation_id) -> void
list_relations(note_id) -> NoteRelations
```

本轮不实现 `update_relation`。如果用户需要修改关系类型或说明，首版通过“删除再重建”解决，避免本轮扩散到更多 UI 状态和测试面。

### 7.3 Service 边界

新增 `RelationService`，职责为：

- 校验 `source_note_id` 和 `target_note_id` 是否存在且未删除。
- 拒绝自关联，即 `source_note_id == target_note_id`。
- 校验 `relation_type` 是否属于固定枚举。
- 按唯一 triplet 去重。
- 返回当前笔记视角下的 outgoing 和 incoming 关系。

### 7.4 错误语义

建议明确以下错误分支：

- `source_not_found`
- `target_not_found`
- `relation_type_invalid`
- `duplicate_relation`
- `self_relation_not_allowed`

前端不直接暴露错误码原文，但应能区分“目标不存在 / 重复关系 / 自关联”三类用户可理解提示。

## 8. 前端交互设计

### 8.1 右侧栏落点

当前右侧栏已有 `大纲` 和 `链接` 两个页签。本轮不新增第三个页签，而是在 `链接` 页签中扩展为四个分区：

1. 出链
2. 反链
3. 未解析链接
4. 手动关系

手动关系区再拆为：

- 我关联到的笔记
- 关联到我的笔记

这种布局能保持“自动链接 + 手动关系”处于同一认知平面，也避免右侧栏页签继续膨胀。

### 8.2 创建关系入口

在手动关系区顶部提供 `添加关系` 按钮。点击后展开轻量表单，而不是新建全屏视图。

表单字段：

- 目标笔记
- 关系类型
- 说明，可选

目标笔记选择器优先复用现有搜索能力：

- 输入关键字后按标题和路径搜索笔记。
- 不展示当前笔记自身，避免自关联。
- 首版不支持从未解析链接直接带入。

### 8.3 交互反馈

- 创建中：按钮禁用并显示提交中状态。
- 创建成功：刷新关系列表，并清空表单。
- 重复关系：展示轻量错误提示，不关闭表单。
- 删除关系：使用行内删除按钮，首次不加二次确认弹窗。

首版删除不加确认，前提是行内动作明确且操作后立即刷新；如果后续用户反馈误删风险高，再补确认机制。

### 8.4 与编辑器脏状态的关系

手动关系不依赖当前编辑器正文保存，因此本轮不因 dirty 或 saving 状态禁用关系创建和删除。原因：

- 关系的权威源是 SQLite，不与 Markdown 保存事务强绑定。
- 若强行和正文保存绑定，会引入无必要的交互阻塞。

唯一限制是：当前无选中笔记时，不展示或禁用关系操作。

### 8.5 空态设计

- 无当前笔记：显示“选择一篇笔记后查看关系”。
- 当前笔记暂无手动关系：显示空态文案，并保留 `添加关系` 按钮。
- 搜索不到目标笔记：目标笔记选择器显示空结果，不自动创建新笔记。

## 9. 为 Phase 3C 预留的图谱契约

### 9.1 GraphData 保持统一结构

3C 直接使用详细设计中的统一图谱契约：

```text
GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

GraphNode {
  id: string
  title: string
  path: string
  summary: string | null
  tags: string[]
  node_type: "note" | "tag" | "unresolved"
  weight: number
}

GraphEdge {
  id: string
  source: string
  target: string
  edge_type: "link" | "backlink" | "manual_relation" | "tag_cooccurrence" | "directory"
  label: string | null
  weight: number
}
```

### 9.2 3B 对 3C 的预留要求

为了让 3C 不返工，3B 需要满足：

1. `relations.relation_type` 直接映射到 `GraphEdge.label`。
2. `manual_relation` 作为稳定的 `edge_type`，不要后续再拆字段名。
3. `list_relations` 虽然是面向当前笔记 UI 的分组接口，但底层 service 应保留可复用于图谱查询的扁平 relation 读取能力。
4. relation record 必须能直接 join 到 notes 表，取 title、path、summary 和 tags。

### 9.3 3C 的最小范围提前固定

Phase 3C 的首版范围提前固定为：

- 只做当前笔记局部图谱。
- 默认一跳，可切换两跳。
- 最大节点数 80。
- 图谱入口为独立视图或弹出面板，不长期占据编辑区。
- 首版过滤只考虑关系类型；标签和目录过滤可以作为后续增强。

这样 3B 的 UI 不需要提前挤进 graph tab，但 3C 也不会因为产品目标摇摆而返工。

## 10. 数据迁移与兼容性

### 10.1 迁移策略

本轮需要新增一次 SQLite migration，内容只包含 `relations` 表和索引创建。

### 10.2 旧库兼容

- 旧知识库升级后，若不存在 `relations` 表，启动时自动迁移。
- 旧笔记无需改写 Markdown 文件。
- 旧链接、summary、revision 数据不需要迁移。

### 10.3 删除和重建索引边界

手动关系属于不可从 Markdown 重建的数据，因此：

- 全量重建索引时不得清空 `relations`。
- 删除单篇笔记并物理清理时，可级联删除其 relations。

这一点需要在实现时与当前 index/rebuild 流程保持明确边界。

## 11. 测试策略

### 11.1 Rust 测试

新增或扩展测试覆盖：

- migration 正确创建 `relations` 表及唯一索引。
- `create_relation` 成功创建关系。
- `create_relation` 拒绝重复关系。
- `create_relation` 拒绝 self relation。
- `list_relations` 正确区分 outgoing 和 incoming。
- 删除笔记后 relations 不再出现在列表中。

### 11.2 前端测试

新增或扩展测试覆盖：

- 右侧栏 `链接` 页签显示手动关系分区。
- 添加关系成功后列表刷新。
- 重复关系时展示错误提示。
- 删除关系成功后列表移除。
- 无当前笔记和空关系时显示正确空态。

### 11.3 集成验证

至少验证以下闭环：

1. 创建两篇笔记。
2. 在 A 中为 B 新建 `related` 关系。
3. A 的 outgoing 显示 B。
4. B 的 incoming 显示 A。
5. 删除关系后两边列表同步消失。

## 12. 验收标准

满足以下条件视为 3B 完成：

1. 用户可从当前笔记创建、查看、删除手动关系。
2. 关系类型固定且可正确展示中文标签。
3. 重复关系和自关联被正确阻止。
4. 右侧栏关系能力与现有链接能力共存，不破坏当前 links/backlinks/unresolved 行为。
5. 数据库迁移、前端测试、Rust 测试和构建验证通过。
6. 文档中为 3C 固定的 GraphData 契约在本轮实现后仍成立。

## 13. 风险与处理

| 风险 | 说明 | 处理 |
| --- | --- | --- |
| 关系 UI 挤压右侧栏空间 | links 页签内容会比现在更长 | 首版采用分区折叠或小标题分组，不新增页签。 |
| 关系选择器范围过大 | 知识库较大时目标笔记查找体验可能一般 | 首版复用现有搜索能力，后续再评估专用 picker 优化。 |
| rebuild 误清 relations | 手动关系不是可重建数据 | 在 spec 和实现中明确 rebuild 只重建派生索引，不触碰 `relations`。 |
| 3C 再次改 DTO | 若本轮 relation 返回模型设计过于 UI 专用，后续图谱会绕行 | 保留 service 层扁平 relation 查询能力，UI command 只是视图适配。 |