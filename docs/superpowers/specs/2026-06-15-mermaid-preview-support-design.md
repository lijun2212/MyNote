# Mermaid 预览支持设计

## 修订记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 0.1 | 2026-06-15 | 首版设计，定义笔记预览区与投影窗口的 Mermaid 最小支持方案。 |

## 目录

1. [背景](#背景)
2. [目标](#目标)
3. [非目标](#非目标)
4. [现状约束](#现状约束)
5. [方案概览](#方案概览)
6. [渲染链路设计](#渲染链路设计)
7. [失败回退与安全约束](#失败回退与安全约束)
8. [对现有能力的兼容要求](#对现有能力的兼容要求)
9. [测试策略](#测试策略)
10. [实施范围](#实施范围)
11. [风险与后续演进](#风险与后续演进)

## 背景

MyNote 当前的笔记预览与投影窗口都复用同一个 Markdown 预览组件 [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx)。

当前预览链路大致为：

1. 使用 `markdown-it` 将 Markdown 文本转换为 HTML。
2. 使用 `DOMPurify` 对 HTML 做白名单清洗。
3. 将清洗后的 HTML 注入预览 DOM。
4. 在预览 DOM 上继续执行链接、搜索定位、源码行定位、滚动同步等增强逻辑。

投影窗口 [src/components/Projection/ProjectionPreviewShell.tsx](src/components/Projection/ProjectionPreviewShell.tsx) 本身不实现单独的 Markdown 渲染逻辑，而是直接承载同一个预览组件。因此 Mermaid 支持应当落在统一预览链路中，而不是给投影单独增加一条分支。

## 目标

本次设计目标如下：

1. 在笔记预览区支持标准 ` ```mermaid ` fenced code block 渲染为 Mermaid 图。
2. 在投影窗口中通过复用同一套预览组件自动支持 Mermaid 图显示。
3. Mermaid 渲染失败时仅局部降级，不影响整篇笔记预览与投影展示。
4. 不破坏现有的源码行定位、搜索定位、内部链接处理与投影滚动同步。

## 非目标

本次不包含以下内容：

1. 编辑器内实时 Mermaid 预览。
2. Mermaid 图交互能力，例如查看源码切换、弹层放大、导出图片、复制图片。
3. 非标准 Mermaid 围栏语法支持，例如 ` ```{mermaid} ` 或启发式识别。
4. 替换现有 Markdown 渲染技术栈。

## 现状约束

现有实现有以下约束必须保留：

1. [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx) 会在 `markdown-it` token 阶段给部分块级元素打上 `data-source-line` 和 `data-source-end-line`，用于源码行定位与滚动同步。
2. 预览 HTML 会经过 `DOMPurify` 清洗，因此 Mermaid 产出的 SVG 如果不加入白名单会被剥离。
3. 投影窗口不维护单独的预览行为状态，Mermaid 相关异常处理必须内聚在 MarkdownPreview 内。
4. 普通 fenced code block 当前行为稳定，本次不能改变其渲染、滚动、复制或样式语义。

## 方案概览

推荐方案为“fence 定制渲染 + 渲染后增强”：

1. 在 `markdown-it` 的 fence renderer 阶段识别标准 ` ```mermaid ` 代码块。
2. 将 Mermaid 代码块输出为受控占位容器，而不是沿用普通代码块 HTML。
3. 在 React 渲染完成后，由 MarkdownPreview 扫描占位容器并调用 Mermaid API 渲染为 SVG。
4. 渲染失败时在原位置展示错误提示与原始源码文本。

不采用“单纯扫描 `pre > code.language-mermaid` 后直接替换”的原因是：虽然实现更快，但普通代码块与 Mermaid 代码块在解析阶段未分流，后续在错误回退、源码行映射与样式控制上更容易产生隐式耦合。

不采用“整体切换到 `remark/rehype` 栈”的原因是：这会扩大改动面，影响现有预览增强能力，超出本次最小目标。

## 渲染链路设计

### 1. Mermaid 代码块识别规则

仅识别标准 fenced code block：

```markdown
```mermaid
graph TD
  A --> B
```
```

识别规则是硬边界，不做模糊猜测，也不支持其他语法别名。

### 2. Markdown 解析阶段

在 [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx) 使用的 `markdown-it` 实例上，为 fence 渲染增加定制逻辑：

1. 普通 fenced code block 保持现有渲染行为。
2. Mermaid fenced block 输出专用占位节点。
3. 占位节点保留原始 Mermaid 源码文本。
4. 占位节点保留 `data-source-line` / `data-source-end-line` 元信息。

占位节点的目标是给后续 Mermaid 渲染提供稳定挂载点，同时不丢失源码映射能力。

### 3. 预览增强阶段

在 MarkdownPreview 中新增一个与预览 HTML 生命周期绑定的 effect：

1. 当预览内容变化时，扫描 Mermaid 占位节点。
2. 对尚未完成渲染的节点调用 Mermaid API。
3. 将 Mermaid 返回的 SVG 注入该占位节点。
4. 记录该节点已经处理完成，避免重复渲染同一内容。

由于投影窗口通过 [src/components/Projection/ProjectionPreviewShell.tsx](src/components/Projection/ProjectionPreviewShell.tsx) 直接复用 MarkdownPreview，因此无需为投影新增第二套 Mermaid 渲染流程。

### 4. 内容更新策略

Mermaid 渲染应随预览内容更新重新执行，但需要避免无意义的重复初始化：

1. 当内容或预览目标 DOM 变化时重新扫描。
2. 当搜索定位、标签定位、滚动同步等仅影响导航状态时，不应强制重建 Mermaid 图。
3. 对同一批次渲染，渲染 effect 只负责 Mermaid 节点，不应改写普通预览 DOM。

## 失败回退与安全约束

### 1. 局部降级

如果某个 Mermaid 图渲染失败：

1. 只在该图所在位置显示错误提示。
2. 保留原始 Mermaid 源码文本。
3. 不中断整篇笔记的预览渲染。
4. 不影响投影窗口中其他 Mermaid 图或普通 Markdown 内容。

错误提示只做最小表达，例如“Mermaid 渲染失败”，避免引入新的复杂交互。

### 2. DOMPurify 白名单扩展

需要为 Mermaid 输出的 SVG 扩展 `DOMPurify` 白名单，但范围必须受控：

1. 只放行 Mermaid 渲染实际需要的 SVG 标签。
2. 只放行 Mermaid 渲染实际需要的属性。
3. 不因为支持 Mermaid 而开放通用任意 SVG/HTML 白名单。

这一步是功能可用的必要条件，否则 Mermaid 生成的 SVG 会在 sanitize 阶段被删除。

## 对现有能力的兼容要求

### 1. 源码行定位

Mermaid 图块必须继续保留源码行映射能力：

1. 搜索命中落到 Mermaid 代码块附近时，预览依然能定位到对应图块。
2. 源码到预览的滚动对齐逻辑不应因为图被替换成 SVG 而失效。
3. 投影窗口的 follow scroll 不应丢失 Mermaid 图所在块的定位能力。

### 2. 普通代码块零回归

非 Mermaid fenced code block 必须继续保持原样：

1. 代码块样式不变。
2. 普通代码块源码文本可见。
3. 普通代码块相关的预览交互和滚动行为不变。

### 3. 投影一致性

投影窗口中的 Mermaid 行为必须与主预览一致：

1. 同样显示 Mermaid 图。
2. 同样遵守失败回退规则。
3. 不额外维护单独的 Mermaid 状态机。

## 测试策略

本次至少覆盖以下测试：

1. Mermaid fenced block 在 MarkdownPreview 中能够进入 Mermaid 渲染路径。
2. 普通 fenced code block 不受 Mermaid 支持逻辑影响。
3. Mermaid 渲染失败时显示错误提示并保留原始源码。
4. 投影窗口通过 [src/components/Projection/ProjectionPreviewShell.tsx](src/components/Projection/ProjectionPreviewShell.tsx) 复用同一组件后，仍可显示 Mermaid。

建议优先在现有前端测试中扩展：

1. [src/components/EditorWorkspace/MarkdownPreview.test.tsx](src/components/EditorWorkspace/MarkdownPreview.test.tsx)
2. [src/components/Projection/ProjectionPreviewShell.test.tsx](src/components/Projection/ProjectionPreviewShell.test.tsx)

若需要更细粒度地验证 Mermaid 集成，可为预览内部 Mermaid 处理逻辑抽取轻量辅助函数，并为其增加独立测试，但不以拆分大规模重构为目标。

## 实施范围

本次实施应当控制在以下文件与责任内：

1. [package.json](package.json)：增加 Mermaid 运行时依赖。
2. [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx)：增加 Mermaid fence 渲染、占位节点扫描、SVG 渲染与失败回退。
3. [src/components/EditorWorkspace/MarkdownPreview.test.tsx](src/components/EditorWorkspace/MarkdownPreview.test.tsx)：补充 Mermaid 预览测试。
4. [src/components/Projection/ProjectionPreviewShell.test.tsx](src/components/Projection/ProjectionPreviewShell.test.tsx)：验证投影窗口复用预览组件后的 Mermaid 显示能力。

## 风险与后续演进

### 当前风险

1. Mermaid 输出 SVG 的 DOMPurify 白名单需要精确控制，放行不足会导致图无法显示，放行过宽会增加不必要的安全面。
2. Mermaid 渲染是预览后的增强动作，需要注意内容更新时的重复初始化与 DOM 覆盖问题。
3. 如果 Mermaid 图非常复杂，首次渲染可能带来额外预览开销，但本次先不引入缓存和异步分批优化。

### 后续可演进方向

如果最小版稳定，再考虑后续迭代：

1. Mermaid 图查看源码切换。
2. Mermaid 图放大查看。
3. 编辑器内实时 Mermaid 预览。
4. Mermaid 主题与应用主题联动。

当前阶段不提前为这些功能做结构扩张，避免过度设计。