# Mermaid Preview Support Implementation Plan

## 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-15 | v1.0 | 初版，基于已确认规格拆解 Mermaid 预览支持的实现步骤。 |

## 目录

1. 目标
2. 架构
3. 技术栈
4. 文件结构
5. 任务拆解
6. 自检结论

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让标准 ` ```mermaid ` fenced code block 在笔记预览区和投影窗口中渲染为 Mermaid 图，同时保持普通代码块、源码行映射、失败回退和投影复用行为稳定。

**Architecture:** 保持现有 `markdown-it -> DOMPurify -> injected HTML -> preview enhancement` 主链路不变，只在 [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx) 内增加 Mermaid 专用 fence 分流和渲染后增强。`markdown-it` 阶段为 Mermaid block 输出带源码行元数据的占位节点，React effect 在内容注入后调用 Mermaid API 生成 SVG，并在注入前使用扩展白名单再次清洗 SVG；投影窗口继续通过共享的 MarkdownPreview 自动复用该能力。

**Tech Stack:** React 19, TypeScript, markdown-it, DOMPurify, mermaid, Vitest, Testing Library.

---

## 文件结构

本次改动只落在已有实现面，不额外拆出新子系统：

1. [package.json](package.json)
   责任：增加 Mermaid 运行时依赖。
2. [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx)
   责任：增加 Mermaid fenced block 识别、占位节点生成、Mermaid SVG 渲染、失败回退和 SVG sanitize。
3. [src/components/EditorWorkspace/MarkdownPreview.test.tsx](src/components/EditorWorkspace/MarkdownPreview.test.tsx)
   责任：补充 Mermaid 成功渲染、失败回退、普通代码块零回归测试。
4. [src/components/Projection/ProjectionPreviewShell.test.tsx](src/components/Projection/ProjectionPreviewShell.test.tsx)
   责任：验证投影窗口复用 MarkdownPreview 后仍能显示 Mermaid 图。

## 任务拆解

### Task 1: 补 Mermaid 依赖与成功路径测试

**Files:**
- Modify: [package.json](package.json)
- Modify: [src/components/EditorWorkspace/MarkdownPreview.test.tsx](src/components/EditorWorkspace/MarkdownPreview.test.tsx)

- [ ] **Step 1: 增加 Mermaid 运行时依赖**

Run: `corepack pnpm add mermaid`

Expected diff in [package.json](package.json):

```json
{
  "dependencies": {
    "markdown-it": "^14.2.0",
    "mermaid": "^11.12.0",
    "react": "^19.1.0"
  }
}
```

- [ ] **Step 2: 写 Mermaid 成功渲染的失败测试**

Append to [src/components/EditorWorkspace/MarkdownPreview.test.tsx](src/components/EditorWorkspace/MarkdownPreview.test.tsx):

```ts
it("renders mermaid fenced blocks as diagrams while preserving source-line metadata", async () => {
  vi.resetModules();

  const renderMock = vi.fn(async (_id: string, definition: string) => ({
    svg: `<svg data-testid="mermaid-svg"><text>${definition.trim()}</text></svg>`,
    bindFunctions: undefined,
  }));

  vi.doMock("mermaid", () => ({
    default: {
      initialize: vi.fn(),
      render: renderMock,
    },
  }));

  const { MarkdownPreview: MermaidPreview } = await import("./MarkdownPreview");
  const { container } = renderWithContextMenu(
    <MermaidPreview
      content={[
        "# Diagram",
        "",
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
      ].join("\n")}
    />,
  );

  await waitFor(() => {
    expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument();
  });

  expect(renderMock).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), "graph TD\n  A --> B");
  expect(container.querySelector("[data-source-line='3']")).toBeInTheDocument();
  expect(container.querySelector("pre code.language-mermaid")).toBeNull();
});
```

- [ ] **Step 3: 运行定向测试确认当前失败**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/MarkdownPreview.test.tsx -t "renders mermaid fenced blocks as diagrams while preserving source-line metadata"`

Expected: FAIL，原因应为当前实现仍把 `mermaid` 当普通 fenced code block 渲染，没有出现 SVG。

### Task 2: 在 MarkdownPreview 中接入 Mermaid 占位渲染

**Files:**
- Modify: [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx)
- Test: [src/components/EditorWorkspace/MarkdownPreview.test.tsx](src/components/EditorWorkspace/MarkdownPreview.test.tsx)

- [ ] **Step 1: 为 Mermaid fenced block 定制占位节点输出**

Add near the `markdown-it` setup in [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx):

```ts
const defaultFenceRenderer = md.renderer.rules.fence ?? ((tokens, idx, options, env, self) =>
  self.renderToken(tokens, idx, options));

function escapeMermaidSource(source: string): string {
  return source
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info.trim().toLowerCase();
  if (info !== "mermaid") {
    return defaultFenceRenderer(tokens, idx, options, env, self);
  }

  const sourceLine = token.attrGet("data-source-line") ?? "";
  const sourceEndLine = token.attrGet("data-source-end-line") ?? "";
  const escapedSource = escapeMermaidSource(token.content.trimEnd());

  return [
    `<div class="mermaid-block" data-mermaid-block="true" data-source-line="${sourceLine}" data-source-end-line="${sourceEndLine}">`,
    `<div class="mermaid-diagram" data-mermaid-definition="${escapedSource}"></div>`,
    `<pre class="mermaid-source" hidden><code>${escapedSource}</code></pre>`,
    `</div>`,
  ].join("");
};
```

- [ ] **Step 2: 扩展 Mermaid SVG sanitize 白名单并实现渲染 effect**

Add to [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx):

```ts
import mermaid from "mermaid";

const ALLOWED_MERMAID_TAGS = [
  ...ALLOWED_MARKDOWN_TAGS,
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polygon", "polyline",
  "marker", "defs", "text", "tspan", "foreignObject",
];

const ALLOWED_MERMAID_ATTR = [
  ...ALLOWED_MARKDOWN_ATTR,
  "id", "viewBox", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "d", "transform", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy",
  "r", "rx", "ry", "points", "xmlns", "xmlns:xlink", "marker-start", "marker-mid",
  "marker-end", "refX", "refY", "orient", "preserveAspectRatio", "style", "class",
];

function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    ALLOWED_TAGS: ALLOWED_MERMAID_TAGS,
    ALLOWED_ATTR: ALLOWED_MERMAID_ATTR,
  });
}

mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

useEffect(() => {
  const container = previewRef.current;
  if (!container) return;

  const mermaidBlocks = Array.from(container.querySelectorAll<HTMLElement>("[data-mermaid-block='true']"));
  void Promise.all(mermaidBlocks.map(async (block, index) => {
    const diagramHost = block.querySelector<HTMLElement>("[data-mermaid-definition]");
    const sourceHost = block.querySelector<HTMLElement>(".mermaid-source");
    const definition = diagramHost?.dataset.mermaidDefinition ?? "";
    if (!diagramHost || !definition) return;

    try {
      const { svg, bindFunctions } = await mermaid.render(`mermaid-${index}`, definition);
      diagramHost.innerHTML = sanitizeMermaidSvg(svg);
      sourceHost?.setAttribute("hidden", "");
      bindFunctions?.(diagramHost);
    } catch {
      diagramHost.innerHTML = '<div class="mermaid-error">Mermaid 渲染失败</div>';
      sourceHost?.removeAttribute("hidden");
    }
  }));
}, [renderedHtml]);
```

- [ ] **Step 3: 运行成功路径测试确认通过**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/MarkdownPreview.test.tsx -t "renders mermaid fenced blocks as diagrams while preserving source-line metadata"`

Expected: PASS，且 `renderMock` 被调用一次，预览中出现 SVG 节点。

### Task 3: 补失败回退与普通代码块零回归测试

**Files:**
- Modify: [src/components/EditorWorkspace/MarkdownPreview.test.tsx](src/components/EditorWorkspace/MarkdownPreview.test.tsx)
- Modify: [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx)

- [ ] **Step 1: 写 Mermaid 失败回退测试**

Append to [src/components/EditorWorkspace/MarkdownPreview.test.tsx](src/components/EditorWorkspace/MarkdownPreview.test.tsx):

```ts
it("falls back to an error message plus raw mermaid source when diagram rendering fails", async () => {
  vi.resetModules();

  vi.doMock("mermaid", () => ({
    default: {
      initialize: vi.fn(),
      render: vi.fn(async () => {
        throw new Error("broken mermaid");
      }),
    },
  }));

  const { MarkdownPreview: MermaidPreview } = await import("./MarkdownPreview");
  const { container } = renderWithContextMenu(
    <MermaidPreview
      content={[
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
      ].join("\n")}
    />,
  );

  await waitFor(() => {
    expect(screen.getByText("Mermaid 渲染失败")).toBeInTheDocument();
  });

  expect(container.querySelector(".mermaid-source:not([hidden]) code")).toHaveTextContent("graph TD\n  A --> B");
});
```

- [ ] **Step 2: 写普通 fenced code block 零回归测试**

Append to [src/components/EditorWorkspace/MarkdownPreview.test.tsx](src/components/EditorWorkspace/MarkdownPreview.test.tsx):

```ts
it("keeps non-mermaid fenced blocks on the existing code rendering path", async () => {
  vi.resetModules();

  const renderMock = vi.fn();
  vi.doMock("mermaid", () => ({
    default: {
      initialize: vi.fn(),
      render: renderMock,
    },
  }));

  const { MarkdownPreview: MermaidPreview } = await import("./MarkdownPreview");
  const { container } = renderWithContextMenu(
    <MermaidPreview
      content={[
        "```json",
        '{"ok":true}',
        "```",
      ].join("\n")}
    />,
  );

  await waitFor(() => {
    expect(container.querySelector("pre code.language-json")).toBeInTheDocument();
  });

  expect(renderMock).not.toHaveBeenCalled();
  expect(container.querySelector("[data-mermaid-block='true']")).toBeNull();
});
```

- [ ] **Step 3: 若测试失败，最小修正回退与普通代码块分流**

Keep the fallback branch in [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx) constrained to Mermaid blocks only:

```ts
if (info !== "mermaid") {
  return defaultFenceRenderer(tokens, idx, options, env, self);
}

// ... mermaid-only branch ...

} catch {
  diagramHost.innerHTML = '<div class="mermaid-error">Mermaid 渲染失败</div>';
  sourceHost?.removeAttribute("hidden");
}
```

- [ ] **Step 4: 运行 MarkdownPreview 定向测试**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/MarkdownPreview.test.tsx -t "mermaid|fenced blocks"`

Expected: PASS，至少覆盖 Mermaid 成功渲染、失败回退和普通代码块零回归。

### Task 4: 验证投影窗口复用 Mermaid 能力

**Files:**
- Modify: [src/components/Projection/ProjectionPreviewShell.test.tsx](src/components/Projection/ProjectionPreviewShell.test.tsx)
- Test: [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx)

- [ ] **Step 1: 写投影窗口 Mermaid 集成测试**

Append to [src/components/Projection/ProjectionPreviewShell.test.tsx](src/components/Projection/ProjectionPreviewShell.test.tsx):

```ts
it("renders mermaid diagrams in the projection window through the shared MarkdownPreview", async () => {
  vi.resetModules();
  vi.doUnmock("../EditorWorkspace/MarkdownPreview");
  vi.doMock("mermaid", () => ({
    default: {
      initialize: vi.fn(),
      render: vi.fn(async () => ({
        svg: '<svg data-testid="projection-mermaid-svg"></svg>',
        bindFunctions: undefined,
      })),
    },
  }));

  const { ProjectionPreviewShell } = await import("./ProjectionPreviewShell");
  let syncHandler: ProjectionStateSyncHandler | undefined;

  tauriMocks.listen.mockImplementation(async (eventName: string, handler: unknown) => {
    if (eventName === PROJECTION_STATE_SYNC_EVENT) {
      syncHandler = handler as ProjectionStateSyncHandler;
    }
    return () => undefined;
  });

  render(
    <ContextMenuProvider>
      <ProjectionPreviewShell />
      <ContextMenuHost />
    </ContextMenuProvider>,
  );

  await act(async () => {
    syncHandler?.({
      payload: {
        sessionId: 11,
        revision: 1,
        notePath: "notes/diagram.md",
        noteTitle: "Diagram",
        content: ["```mermaid", "graph TD", "  A --> B", "```"].join("\n"),
        searchNavigationTarget: null,
        tagNavigationTarget: null,
      },
    });
  });

  await waitFor(() => {
    expect(screen.getByTestId("projection-mermaid-svg")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行投影窗口定向测试**

Run: `corepack pnpm vitest run src/components/Projection/ProjectionPreviewShell.test.tsx -t "renders mermaid diagrams in the projection window through the shared MarkdownPreview"`

Expected: PASS，证明无需给投影窗口新增第二套 Mermaid 渲染逻辑。

### Task 5: 全量验证与收尾

**Files:**
- Modify: [package.json](package.json)
- Modify: [src/components/EditorWorkspace/MarkdownPreview.tsx](src/components/EditorWorkspace/MarkdownPreview.tsx)
- Modify: [src/components/EditorWorkspace/MarkdownPreview.test.tsx](src/components/EditorWorkspace/MarkdownPreview.test.tsx)
- Modify: [src/components/Projection/ProjectionPreviewShell.test.tsx](src/components/Projection/ProjectionPreviewShell.test.tsx)

- [ ] **Step 1: 运行 MarkdownPreview 全文件测试**

Run: `corepack pnpm vitest run src/components/EditorWorkspace/MarkdownPreview.test.tsx`

Expected: PASS，无现有预览测试回归。

- [ ] **Step 2: 运行 ProjectionPreviewShell 全文件测试**

Run: `corepack pnpm vitest run src/components/Projection/ProjectionPreviewShell.test.tsx`

Expected: PASS，无投影窗口生命周期、滚动或只读行为回归。

- [ ] **Step 3: 运行前端构建验证**

Run: `corepack pnpm build`

Expected: PASS，TypeScript 与 Vite 构建通过，新增 Mermaid 依赖未引入编译错误。

## 自检结论

1. 规格覆盖已对齐：
   - 仅预览区与投影窗口支持 Mermaid：Task 2、Task 4。
   - 不扩展到编辑区实时预览：未纳入任何任务。
   - 失败回退为“错误提示 + 原始源码”：Task 3。
   - 不做主题跟随：未纳入任何任务。
   - 普通代码块零回归与源码行定位保留：Task 2、Task 3。
2. 占位词检查已完成：文档中未使用 TBD、TODO、后续补充等空占位描述。
3. 实现边界保持收敛：不切换 Markdown 栈，不为投影新增专用 Mermaid 状态机，不额外引入编辑区功能。

Plan complete and saved to `docs/superpowers/plans/2026-06-15-mermaid-preview-support-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?