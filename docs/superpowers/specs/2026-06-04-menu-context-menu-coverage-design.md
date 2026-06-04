# MyNote 右键菜单覆盖扩展设计

> 实现状态：标签区、预览区、右侧链接区、右侧关系区的右键菜单覆盖已落地；右侧大纲和预览区选区菜单仍不在本轮范围内。

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-04 | v1.0 | 定义菜单第二阶段扩展范围，补齐标签区、预览区、右侧链接区、右侧关系区的对象化右键菜单。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标](#2-目标)
- [3. 非目标](#3-非目标)
- [4. 设计结论](#4-设计结论)
- [5. 对象范围](#5-对象范围)
- [6. 菜单动作矩阵](#6-菜单动作矩阵)
- [7. 实现结构](#7-实现结构)
- [8. 组件改动边界](#8-组件改动边界)
- [9. Payload 设计原则](#9-payload-设计原则)
- [10. 测试策略](#10-测试策略)
- [11. 风险与约束](#11-风险与约束)

## 1. 背景

MyNote 第一阶段菜单工作已经完成以下内容：

- 顶部原生系统菜单骨架已落地。
- 文件树中的笔记本、笔记、空白区右键菜单已落地。
- 标签项右键菜单已落地。
- 编辑器选区与编辑器空白区右键菜单已落地。
- 系统菜单与右键菜单已统一接入共享的 `menuIds`、`menuSchema`、`menuActionRunner`、`ContextMenuHost` 体系。

当前剩余问题不再是“有没有菜单机制”，而是“右键菜单覆盖面不完整”。尤其是以下对象仍然缺失：

- 标签面板空白区。
- 标签上下文结果项。
- Markdown 预览区空白区。
- Markdown 预览区链接对象。
- 右侧链接面板空白区。
- 右侧链接项。
- 右侧关系区空白区。
- 右侧关系项。

如果继续按面板零散补右键菜单，会直接破坏第一阶段刚建立的共享菜单边界，重新回到“每个组件各写一套菜单规则”的状态。因此第二阶段必须继续沿用统一菜单模型，只扩对象，不扩机制。

## 2. 目标

本轮设计目标如下：

- 补齐当前已有真实对象和真实数据来源区域的右键菜单覆盖。
- 继续复用统一菜单基础设施，不新增第二套右键菜单实现。
- 区分空白区菜单与对象项菜单，避免语义混杂。
- 对外链、内链、Wiki 链接使用条件菜单规则，而不是强行复用完全一致的动作集。
- 只接入本轮能形成真实闭环的动作，未接上的能力保持灰态或不显示。

## 3. 非目标

本轮不做以下内容：

- 右侧大纲的真实对象右键菜单。
- 预览区文本选区菜单。
- 新增系统菜单主菜单组。
- Rust 后端改动。
- 为了菜单覆盖率而反向补做尚未成熟的业务能力。

说明：右侧大纲当前仍是占位态，不属于“已有真实对象”的范围。若将其纳入，会把“大纲对象定义”和“右键菜单补全”两个议题绑在一起，超出本轮范围。

## 4. 设计结论

本轮确认采用以下结论：

- 扩展现有右键菜单体系，新增 8 类对象菜单类型。
- 空白区菜单与对象菜单严格分离。
- 预览区本轮只覆盖空白区和链接对象，不覆盖文本选区。
- 右侧“链接”与“关系”继续视为两个不同语义空间，不混用对象菜单。
- 本轮只将可执行动作接入 `menuActionRunner`，未闭环动作保持 disabled 或不显示。

这是一个“对象矩阵扩展方案”，而不是“面板局部补丁方案”。

## 5. 对象范围

本轮新增对象范围固定为 8 类：

### 5.1 tagBlank

标签面板空白区，代表“标签空间”而不是某个标签对象。

### 5.2 tagContextItem

标签上下文结果项，即某个标签展开后下面出现的笔记上下文条目。

### 5.3 previewBlank

Markdown 预览区空白区域，代表当前笔记的阅读空间。

### 5.4 previewLink

Markdown 预览区中的可点击链接对象，包含：

- 普通外链。
- 内部笔记链接。
- Wiki 链接。

### 5.5 linksBlank

右侧“链接”面板空白区，代表链接管理空间。

### 5.6 linkItem

右侧“传出链接 / 反向链接”中的单个链接项。

### 5.7 relationBlank

右侧“关系”区域空白区，代表关系管理空间。

### 5.8 relationItem

右侧“手动关系”中的单个关系对象项。

## 6. 菜单动作矩阵

### 6.1 tagBlank

建议菜单项：

1. 新建标签
2. 刷新标签
3. 清空标签筛选

本轮可点击：

- 刷新标签
- 清空标签筛选，仅在存在选中标签时启用

本轮策略：

- 若标签面板现有内联创建入口可稳定复用，则“新建标签”可接入。
- 若其当前实现仅适合局部 UI，不适合作为通用对象动作，则暂时保持灰态。

### 6.2 tagContextItem

建议菜单项：

1. 打开笔记
2. 复制笔记路径
3. 复制 Wiki 链接
4. 定位到标签位置
5. 显示反向链接

本轮可点击：

- 打开笔记
- 定位到标签位置

本轮灰态或条件保留：

- 复制笔记路径
- 复制 Wiki 链接
- 显示反向链接

原因：当前标签上下文条目最稳定的闭环是“打开并定位”，其他动作需要更完整的 note payload 才适合接入。

### 6.3 previewBlank

建议菜单项：

1. 返回编辑
2. 刷新预览
3. 显示侧栏
4. 复制当前笔记链接

本轮可点击：

- 返回编辑
- 显示侧栏

本轮条件接入：

- 刷新预览，仅在当前预览渲染可显式刷新时启用
- 复制当前笔记链接，仅在 current note payload 已可稳定提供时启用

### 6.4 previewLink

建议菜单项：

1. 打开链接
2. 在编辑器中定位来源
3. 复制链接地址
4. 复制 Wiki 链接
5. 打开目标笔记

本轮可点击：

- 打开链接
- 复制链接地址
- 打开目标笔记，仅对内部链接启用

本轮灰态或条件保留：

- 在编辑器中定位来源
- 复制 Wiki 链接，仅对 Wiki/internal note link 启用

要求：

- 外链、内链、Wiki 链接不能强行共用同一组启用状态。
- 菜单标签可复用，但显示和 enabled 必须根据 link type 条件控制。

### 6.5 linksBlank

建议菜单项：

1. 刷新链接
2. 显示侧栏

本轮可点击：

- 刷新链接
- 显示侧栏

设计约束：linksBlank 只表示“链接区操作”，不要把它做成关系总控菜单。

### 6.6 linkItem

建议菜单项：

1. 打开链接
2. 打开目标笔记
3. 复制链接地址
4. 在编辑器中定位

本轮可点击：

- 打开链接
- 打开目标笔记
- 复制链接地址

本轮灰态或延后：

- 在编辑器中定位

约束：

- 自动链接对象菜单中不混入“删除关系”等手动关系动作。

### 6.7 relationBlank

建议菜单项：

1. 添加关系
2. 刷新关系
3. 显示侧栏

本轮可点击：

- 添加关系
- 刷新关系
- 显示侧栏

原因：`ManualRelationsPanel` 已具备真实关系创建流程，这些动作可直接形成闭环。

### 6.8 relationItem

建议菜单项：

1. 查看目标笔记
2. 复制关系目标链接
3. 删除关系

本轮可点击：

- 删除关系
- 查看目标笔记，仅在目标 note identity 可用时启用

本轮条件可点击：

- 复制关系目标链接，仅在目标 note path 或 note title 可稳定推导时启用

## 7. 实现结构

本轮继续复用第一阶段已建立的统一菜单四层：

### 7.1 contextMenuTypes

新增本轮 8 类对象 payload 类型。

要求：

- 每类 payload 只带菜单所需的最小上下文。
- 不把整个组件局部状态或整个业务对象直接塞进 payload。

### 7.2 menuIds

新增对应 action id 与 placeholder id。

要求：

- 可执行动作 id 与未来占位 id 继续分离。
- 不把“未来想做但本轮无 handler”的项直接声明成可执行动作。

### 7.3 menuSchema

负责新增对象的菜单矩阵生成：

- 决定哪些项显示。
- 决定哪些项 enabled。
- 决定哪些项保持灰态。
- 处理外链 / 内链 / Wiki 链接的条件菜单分支。

### 7.4 menuActionRunner

只接本轮能形成闭环的动作，不制造假 handler。

本轮建议纳入 runner 的动作为：

- openLink
- openTargetNote
- copyLink
- refreshLinks
- refreshTags
- clearTagFilter
- deleteRelation
- returnToEditor
- showSidebar

其他动作若当前没有稳定消费者，不进入本轮可执行映射。

## 8. 组件改动边界

本轮只修改拥有真实对象入口的前端组件：

- `src/components/LeftSidebar/TagPanel.tsx`
  - 新增标签空白区右键菜单
  - 新增标签上下文结果项右键菜单

- `src/components/EditorWorkspace/MarkdownPreview.tsx`
  - 新增预览区空白区右键菜单
  - 新增预览区链接对象右键菜单

- `src/components/RightSidebar/BacklinksPanel.tsx`
  - 新增链接面板空白区右键菜单
  - 新增链接项右键菜单

- `src/components/RightSidebar/ManualRelationsPanel.tsx`
  - 新增关系区空白区右键菜单
  - 新增关系项右键菜单

- `src/components/RightSidebar/RightSidebar.tsx`
  - 仅做必要的上下文透传，不堆积右键菜单判断逻辑

本轮不修改 Rust，不顺手补大纲实现，不新增第二套右键菜单框架。

## 9. Payload 设计原则

每类对象 payload 均遵守以下规则：

- 对象身份字段
- 条件判断字段
- 已接线 handler

避免把整包业务对象直接塞进菜单系统。

### 9.1 previewLink

最小建议字段：

- `linkType`
- `linkText` 或 `url`
- `notePath` 或 `noteId`，仅内部目标时存在
- `handlers.openLink`
- `handlers.openTargetNote`
- `handlers.copyLink`

### 9.2 relationItem

最小建议字段：

- `relationId`
- `relationType`
- `targetNotePath` 或 `targetNoteId`
- `handlers.openTarget`
- `handlers.deleteRelation`

目标：

- schema 不依赖组件内部实现细节
- runner 类型边界清晰
- 测试可以用轻量 payload 完成

## 10. 测试策略

### 10.1 共享层测试

在 `src/menu/menuSchema.test.ts` 中新增：

- 新对象菜单矩阵测试
- enabled/disabled 条件测试
- 外链 / 内链 / Wiki link 条件差异测试

在 `src/menu/menuActionRunner.test.ts` 中新增：

- openLink
- openTargetNote
- copyLink
- refreshLinks
- refreshTags
- clearTagFilter
- deleteRelation
- returnToEditor
- showSidebar

### 10.2 组件测试

补充以下组件测试：

- `src/components/LeftSidebar/TagPanel.test.tsx`
- `src/components/EditorWorkspace/MarkdownPreview.test.tsx`
- `src/components/RightSidebar/BacklinksPanel.test.tsx`
- `src/components/RightSidebar/ManualRelationsPanel.test.tsx`

### 10.3 重点危险分支

优先覆盖：

- 空白区右键菜单只出现区域级动作
- 链接对象根据 link type 展示不同菜单项和不同 enabled 状态
- 关系项删除经过共享 host / runner，而不是组件内私有菜单分支
- 预览区链接右键不会破坏正常左键打开行为

## 11. 风险与约束

### 11.1 风险：为了覆盖率接入死菜单

控制方式：

- 没有真实消费者的动作保持灰态或不显示
- 不写“名字存在但行为是假实现”的 handler

### 11.2 风险：不同面板对同类动作命名不一致

控制方式：

- 对 link-like 对象统一使用“打开链接 / 打开目标笔记 / 复制链接地址”等稳定命名

### 11.3 风险：对象菜单与空白区菜单混杂

控制方式：

- 空白区菜单不暴露删除对象等破坏性动作
- 对象项菜单不承载区域级维护动作

### 11.4 风险：预览区被做成第二个编辑器

控制方式：

- 本轮明确不做预览区文本选区菜单
- 预览区只覆盖空白区和链接对象

### 11.5 约束：右侧大纲继续排除在本轮之外

原因：

- 当前不是完整对象列表
- 纳入会让“对象定义”与“菜单补齐”耦合，破坏本轮可控范围
