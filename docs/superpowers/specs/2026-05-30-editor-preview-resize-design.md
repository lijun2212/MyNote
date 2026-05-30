# Editor Preview Resize Design

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-05-30 | v1.0 | 定义编辑区与预览区分隔线可拖动的交互与状态设计。 |

## 目录

- [1. 背景](#1-背景)
- [2. 目标](#2-目标)
- [3. 非目标](#3-非目标)
- [4. 设计原则](#4-设计原则)
- [5. 方案选择](#5-方案选择)
- [6. 详细设计](#6-详细设计)
- [7. 交互状态](#7-交互状态)
- [8. 边界与错误处理](#8-边界与错误处理)
- [9. 测试与验证策略](#9-测试与验证策略)
- [10. 后续扩展](#10-后续扩展)

## 1. 背景

MyNote 当前编辑工作区由 Markdown 编辑器和 Markdown 预览区组成。预览开启时两侧使用固定 flex 平分宽度，中间只有预览区左边框，用户无法拖动调整编辑区与预览区比例。

这会影响长文编辑体验：有时用户需要更宽编辑区来处理表格或代码块，有时需要更宽预览区检查排版。目前只能隐藏预览或接受 50/50 固定布局，交互不够灵活。

本轮 P1 修复聚焦于编辑区 / 预览区之间的分隔线拖动能力，不改变 Markdown 编辑、预览渲染、自动保存或笔记数据结构。

## 2. 目标

本次修复目标：

- 编辑区与预览区之间出现可拖动分隔条。
- 用户拖动分隔条时实时调整左右区域宽度。
- 分隔比例全局持久化，所有笔记共享同一比例。
- 默认比例为编辑区 50%、预览区 50%。
- 预览隐藏时编辑器占满全部宽度；再次显示预览时恢复上次比例。
- 左右两侧都有最小宽度限制，避免任一区域被拖到不可用。
- 保持当前编辑器、预览区、自动保存、Wiki link 点击逻辑不变。

## 3. 非目标

本轮不做以下内容：

- 按笔记保存不同编辑/预览比例。
- 将布局偏好同步到后端或写入知识库数据库。
- 新增复杂布局模式，例如三栏预览、全屏预览、Zen mode。
- 重构 CodeMirror 编辑器封装。
- 引入第三方 split-pane 组件库。
- 新增完整前端测试框架。
- 修复 Front Matter 预览隐藏问题。

## 4. 设计原则

- 优先使用轻量前端状态和原生 pointer 事件，避免为单一布局能力引入新依赖。
- 可拖动区域要足够容易命中，但视觉上保持克制，不破坏当前工作台风格。
- 分隔比例应以百分比保存，而不是像素值，以适配不同窗口大小。
- 拖动过程必须限制边界，确保编辑器和预览区始终可用。
- 预览隐藏是独立显示状态，不应清空或重置用户保存的 split ratio。

## 5. 方案选择

### 方案 A：在 EditorWorkspace 内实现轻量 split layout（推荐）

在 `EditorWorkspace` 中维护一个编辑区比例，并通过自定义 hook 管理 localStorage、pointer drag、边界 clamp。布局由 flex 平分改为显式百分比宽度：

- 编辑区宽度：`splitRatio%`
- 分隔条：固定宽度，例如 6px
- 预览区宽度：剩余空间

优点：改动集中，不引入依赖，符合当前组件规模。缺点：需要自行处理 pointer capture、窗口宽度变化和边界计算。

### 方案 B：引入 split-pane 类第三方组件

使用现成库处理拖动、持久化和无障碍状态。

优点：能力完整。缺点：为一个 P1 小交互引入依赖，可能带来样式和 Tauri 打包维护成本。

### 方案 C：只提供几个固定比例按钮

例如 30/70、50/50、70/30。

优点：实现简单。缺点：不满足 baseline 中“分隔线不可拖动”的交互缺口，也不够自然。

本轮采用方案 A。

## 6. 详细设计

### 6.1 状态模型

新增一个轻量 hook，例如 `src/hooks/useEditorSplitResize.ts`，负责：

- 读取 localStorage 中保存的比例。
- 在无有效保存值时使用默认比例 50。
- 暴露当前 `editorRatio`。
- 暴露拖动开始处理器 `startResize`。
- 拖动过程中根据容器宽度和 pointer x 计算新比例。
- 将比例 clamp 到允许范围内。
- 拖动结束后保存到 localStorage。

建议常量：

- `DEFAULT_EDITOR_RATIO = 50`
- `MIN_EDITOR_RATIO = 30`
- `MAX_EDITOR_RATIO = 75`
- `STORAGE_KEY = "mynote.editorSplitRatio"`

比例范围先用百分比，而不是像素最小值。30% 到 75% 可以避免编辑区过窄，也允许预览区保持至少 25%。如果实现时需要更稳健，可同时结合容器像素宽度做最小宽度保护。

### 6.2 布局结构

调整 `EditorWorkspace` 的内容区域：

- 外层内容容器增加 `ref`，用于计算可用宽度。
- `MarkdownEditor` 包裹在编辑 pane 中，由 pane 控制宽度。
- 分隔条只在 `showPreview === true` 时渲染。
- `MarkdownPreview` 包裹在预览 pane 中，由 pane 控制剩余宽度。
- `showPreview === false` 时不渲染分隔条和预览 pane，编辑 pane 占满 100%。

示意结构：

```tsx
<div ref={workspaceRef} className="editor-split-layout">
  <div className="editor-pane" style={{ width: showPreview ? `${editorRatio}%` : "100%" }}>
    <MarkdownEditor ... />
  </div>
  {showPreview && <div role="separator" onPointerDown={startResize} />}
  {showPreview && <div className="preview-pane" style={{ flex: 1 }}>
    <MarkdownPreview ... />
  </div>}
</div>
```

当前 `MarkdownEditor` 与 `MarkdownPreview` 自身都有 `flex: 1` 样式。实现时需要避免内部组件继续与外层 pane 抢布局。推荐做法：让外层 pane 控制宽度，内部组件保持 `width: 100%`、`height: 100%`。

### 6.3 分隔条交互

分隔条视觉与行为：

- 默认宽度 6px，cursor 为 `col-resize`。
- 中间显示非常轻的竖向线或 hover 高亮。
- hover 和 dragging 时使用 accent 色或更深边框提示可拖动。
- 拖动过程中禁用文本选择，避免拖动编辑器内容时出现选择文本。
- 使用 pointer events，兼容鼠标和触控板。

无障碍属性：

- `role="separator"`
- `aria-orientation="vertical"`
- `aria-valuemin={MIN_EDITOR_RATIO}`
- `aria-valuemax={MAX_EDITOR_RATIO}`
- `aria-valuenow={Math.round(editorRatio)}`
- `tabIndex={0}`

本轮可先支持鼠标 / pointer 拖动。键盘左右键调整可以作为后续扩展，不作为本 P1 必须项。

### 6.4 持久化策略

采用 localStorage：

- 初始化时读取 `mynote.editorSplitRatio`。
- 如果值不存在、不是数字或超出范围，回退到默认 50。
- 拖动结束时保存最终比例。
- 如果用户拖动过程中刷新页面，允许丢失最后一段拖动中间态；持久化最终意图即可。

不把比例写入 Zustand store 的原因：

- 该设置是纯 UI 偏好，不参与编辑器保存状态。
- 当前 store 主要承载 note/content/save/preview 状态，加入持久化 UI layout 会扩大职责。
- hook + localStorage 更独立，也便于后续抽到统一偏好系统。

## 7. 交互状态

### 7.1 默认打开

1. 当前 note 存在且 `showPreview = true`。
2. 编辑区和预览区按 localStorage 比例显示。
3. 无保存值时使用 50/50。

### 7.2 拖动分隔线

1. 用户 pointer down 分隔条。
2. 记录拖动状态并捕获 pointer。
3. pointer move 根据容器宽度实时更新编辑区比例。
4. 比例始终 clamp 在允许范围内。
5. pointer up / cancel 后停止拖动并写入 localStorage。

### 7.3 隐藏再显示预览

1. 用户点击“隐藏预览”。
2. 编辑区占满内容区域。
3. 分隔条和预览区不渲染。
4. 用户再次点击“显示预览”。
5. 恢复上次保存的编辑区比例。

## 8. 边界与错误处理

- localStorage 不可用或读取失败时，静默使用默认比例。
- localStorage 写入失败时，当前会话仍保留拖动后的比例，但不阻断 UI。
- 容器宽度为 0 或 ref 不存在时，不更新比例。
- 拖动时如果 pointer 离开窗口，pointer capture 或 window listener 应确保可以结束拖动。
- 如果窗口缩小导致某侧过窄，百分比 clamp 仍保证基本可用；必要时实现像素最小宽度作为补充。
- 预览关闭时不重置比例。

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

3. 手动交互验证，使用开发模式：

```bash
cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && pnpm tauri dev
```

手动验证用例：

- 打开任意笔记，预览开启时可拖动中间分隔条。
- 拖动到左右边界时无法继续压缩到不可用宽度。
- 隐藏预览后编辑器占满宽度。
- 再次显示预览后恢复上次比例。
- 切换笔记后比例保持一致。
- 刷新或重启应用后比例仍然保持。
- 拖动分隔条不触发内容修改或自动保存。

## 10. 后续扩展

后续可考虑：

- 为 separator 增加键盘左右键调整能力。
- 在统一偏好设置系统出现后，将 localStorage key 迁移到偏好模块。
- 支持编辑器 / 预览区双击分隔条恢复 50/50。
- 支持按知识库保存布局偏好。
