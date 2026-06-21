import type { ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import mermaid from "mermaid";
import { describe, expect, it, vi } from "vitest";
import { ContextMenuHost } from "../ContextMenu/ContextMenuHost";
import { StatusBar } from "../StatusBar";
import { ContextMenuProvider } from "../ContextMenu/useContextMenu";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { tauriMocks } from "../../test/setup";
import { deferred, makeNote, makeNoteDetail } from "../../test/testData";
import type { SearchNavigationTarget, TagNavigationTarget } from "../../types";

const invokeMock = vi.mocked(invoke);

function renderWithContextMenu(ui: ReactElement) {
  return render(
    <ContextMenuProvider>
      {ui}
      <ContextMenuHost />
    </ContextMenuProvider>,
  );
}

describe("MarkdownPreview", () => {
  it("does not render unchanged shifted lines as remove/add pairs in beautify diff mode", () => {
    const { container } = render(
      <MarkdownPreview
        content={"Line A\nLine B\nLine C"}
        beautifyReview={{
          originalContent: "Line A\nLine B\nLine C",
          beautifiedContent: "Line A\nLine X\nLine B\nLine C",
          diagnostics: [],
          summary: { errorCount: 0, warningCount: 0, autoFixableCount: 0 },
          diffMode: true,
          appliedAi: false,
          aiStatus: "not_requested",
          aiStatusDetail: null,
        }}
      />,
    );

    const removedRows = Array.from(container.querySelectorAll(".beautify-diff-row--removed"));
    const addedRows = Array.from(container.querySelectorAll(".beautify-diff-row--added"));
    const removedTexts = removedRows.map((row) => row.textContent ?? "");
    const addedTexts = addedRows.map((row) => row.textContent ?? "");

    expect(addedTexts.some((text) => text.includes("+ Line X"))).toBe(true);
    expect(removedTexts.some((text) => text.includes("- Line B"))).toBe(false);
    expect(removedTexts.some((text) => text.includes("- Line C"))).toBe(false);
  });

  it("collapses long unchanged prefixes in beautify diff mode so later edits are immediately visible", () => {
    const originalLines = Array.from({ length: 8 }, (_, index) => `Same ${index + 1}`)
      .concat(["Formula", "解析：", "1.  \\$close: 当天的收盘价。"])
      .join("\n");
    const beautifiedLines = Array.from({ length: 8 }, (_, index) => `Same ${index + 1}`)
      .concat(["```text", "Formula", "```", "## 解析", "1.  `$close`: 当天的收盘价。"])
      .join("\n");

    const { container } = render(
      <MarkdownPreview
        content={originalLines}
        beautifyReview={{
          originalContent: originalLines,
          beautifiedContent: beautifiedLines,
          diagnostics: [],
          summary: { errorCount: 0, warningCount: 0, autoFixableCount: 0 },
          diffMode: true,
          appliedAi: false,
          aiStatus: "not_requested",
          aiStatusDetail: null,
        }}
      />,
    );

    expect(container.textContent).toContain("@@ 省略前文 6 行未改内容 @@");
    expect(container.textContent).toContain("+ ```text");
    expect(container.textContent).toContain("+ ## 解析");
    expect(container.textContent).not.toContain("Same 1");
    expect(container.textContent).not.toContain("Same 2");
  });

  it("keeps rendered content constrained to the preview pane", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "| Problem | Existing pain | Solution |",
          "| --- | --- | --- |",
          "| Very long content | Long table content should stay within the preview pane | Wrapped content |",
        ].join("\n")}
      />,
    );

    const previewContent = container.querySelector("[data-testid='markdown-preview-content']");
    expect(previewContent).toHaveStyle({ width: "100%", maxWidth: "none" });
    expect(container.querySelector("td")).toHaveStyle({ overflowWrap: "anywhere" });
  });

  it("marks preview blocks with their source line for content-based scroll sync", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "# Title",
          "",
          "Paragraph text",
          "",
          "## Section",
        ].join("\n")}
      />,
    );

    expect(container.querySelector("h1")).toHaveAttribute("data-source-line", "1");
    expect(container.querySelector("p")).toHaveAttribute("data-source-line", "3");
    expect(container.querySelector("h2")).toHaveAttribute("data-source-line", "5");
  });

  it("renders inline tags as preview tag chips", () => {
    const { container } = render(<MarkdownPreview content={["#项目报告", "", "普通正文 #阶段一"].join("\n")} />);

    const chips = container.querySelectorAll(".inline-tag-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("项目报告");
    expect(chips[1]).toHaveTextContent("阶段一");
  });

  it("renders inline LaTeX formulas in markdown content", () => {
    const { container } = render(<MarkdownPreview content="质能方程 $E = mc^2$ 很重要。" />);

    expect(container.querySelector(".katex")).toBeInTheDocument();
    expect(container.querySelector(".katex-display")).toBeNull();
  });

  it("renders emoji shortcodes in markdown content", () => {
    const { container } = render(<MarkdownPreview content="今天状态不错 :joy:" />);

    expect(container.textContent).toContain("😂");
    expect(container.textContent).not.toContain(":joy:");
  });

  it("renders markdown footnotes with references and footnote content", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "这里有一个脚注引用。[^1]",
          "",
          "[^1]: 这是脚注内容。",
        ].join("\n")}
      />,
    );

    const footnoteRef = container.querySelector("sup.footnote-ref a");
    expect(footnoteRef).toBeInTheDocument();
    expect(footnoteRef).toHaveAttribute("href", "#fn1");

    const footnoteSection = container.querySelector("section.footnotes");
    expect(footnoteSection).toBeInTheDocument();
    expect(footnoteSection).toHaveTextContent("这是脚注内容。");
  });

  it("renders block LaTeX formulas in markdown content", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "积分公式：",
          "",
          "$$",
          "\\int_0^1 x^2 \\, dx",
          "$$",
        ].join("\n")}
      />,
    );

    expect(container.querySelector(".katex-display")).toBeInTheDocument();
  });

  it("left-aligns block LaTeX formulas inside the preview pane", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "矩阵：",
          "",
          "$$",
          "\\begin{pmatrix}",
          "a & b \\\\ ",
          "c & d",
          "\\end{pmatrix}",
          "$$",
        ].join("\n")}
      />,
    );

    expect(container.querySelector(".katex-display")).toHaveStyle({ textAlign: "left" });
  });

  it("adds table column resize handles and adjusts adjacent column widths", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "| Method | Path | Description |",
          "| --- | --- | --- |",
          "| POST | /llm/chat/completions | OpenAI compatible chat API |",
        ].join("\n")}
      />,
    );

    const table = container.querySelector("table") as HTMLTableElement;
    table.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 120,
      width: 600,
      height: 120,
      toJSON: () => ({}),
    });

    const handles = container.querySelectorAll(".markdown-table-resize-handle");
    expect(handles).toHaveLength(2);

    fireEvent.pointerDown(handles[0], { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 160 });
    fireEvent.pointerUp(window);

    const columns = container.querySelectorAll("col");
    expect(columns[0]).toHaveStyle({ width: "43.33%" });
    expect(columns[1]).toHaveStyle({ width: "23.33%" });
    expect(columns[2]).toHaveStyle({ width: "33.33%" });
  });

  it("highlights the matched term inside inline-code table cells without highlighting the whole table", async () => {
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 3,
      line_end: 3,
      occurrence_order: 1,
      match_text: "ocr",
      source: "body",
      context_snippet: "| `ocr/` | OCR 辅助实现 |",
      revision: 7,
    };

    const { container } = render(
      <MarkdownPreview
        content={[
          "| 路径 | 说明 |",
          "| --- | --- |",
          "| `ocr/` | OCR 辅助实现 |",
        ].join("\n")}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("table.search-navigation-target")).toBeNull();
      expect(container.querySelector("mark.search-navigation-target")).toHaveTextContent("ocr");
    });
  });

  it("keeps list markers inside the padded preview content area", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "Intro paragraph",
          "",
          "- First item",
          "- Second item",
          "",
          "1. Ordered item",
        ].join("\n")}
      />,
    );

    const previewContent = container.querySelector("[data-testid='markdown-preview-content']");
    expect(previewContent).toHaveStyle({ padding: "22px 36px" });
    expect(container.querySelector("ul")).toHaveStyle({ paddingLeft: "2em" });
    expect(container.querySelector("ol")).toHaveStyle({ paddingLeft: "2em" });
    expect(container.querySelector("li")).toHaveStyle({ marginBlock: "0.35em" });
  });

  it("renders markdown task list items as disabled checkboxes in preview", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "- [ ] Pending task",
          "- [x] Finished task",
          "- [X] Confirmed task",
        ].join("\n")}
      />,
    );

    const checkboxes = container.querySelectorAll("input[type='checkbox']");
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).toBeChecked();
    expect(checkboxes[0]).toBeDisabled();
    expect(checkboxes[0]).toHaveStyle({
      width: "1.5em",
      height: "1.5em",
      verticalAlign: "middle",
      borderRadius: "0.28em",
    });

    const styleTagText = container.querySelector("style")?.textContent ?? "";
    expect(styleTagText).toContain(".markdown-preview-content .markdown-task-list-checkbox::after");
    expect(styleTagText).toContain("width: 0.5em");
    expect(styleTagText).toContain("height: 0.8em");

    const items = Array.from(container.querySelectorAll("li")).map((item) => item.textContent ?? "");
    expect(items[0]).toContain("Pending task");
    expect(items[1]).toContain("Finished task");
    expect(items[2]).toContain("Confirmed task");
    expect(items.some((text) => text.includes("[ ]") || text.includes("[x]") || text.includes("[X]"))).toBe(false);
  });

  it("uses larger Typora-like spacing between preview sections", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "# Main Title",
          "",
          "Opening paragraph.",
          "",
          "## Section Title",
          "",
          "Section paragraph.",
          "",
          "### Subsection Title",
        ].join("\n")}
      />,
    );

    expect(container.querySelector("h1")).toHaveStyle({ marginTop: "0.35em", marginBottom: "0.85em" });
    expect(container.querySelector("h2")).toHaveStyle({ marginTop: "1.45em", marginBottom: "0.65em" });
    expect(container.querySelector("h3")).toHaveStyle({ marginTop: "1.2em", marginBottom: "0.55em" });
    expect(container.querySelector("p")).toHaveStyle({ marginBlock: "0.85em" });
  });

  it("renders quote syntax as a styled blockquote", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "# 标题",
          "",
          "> 摘要：这是可见摘要",
        ].join("\n")}
      />,
    );

    const quote = container.querySelector("blockquote");
    expect(quote).toBeInTheDocument();
    expect(quote).toHaveTextContent("摘要：这是可见摘要");
    expect(quote).toHaveStyle({ borderLeft: "4px solid #f59e0b", background: "#fffbeb" });
  });

  it("uses a Typora-like reading font stack for Chinese, English, and numbers", () => {
    const { container } = render(<MarkdownPreview content="# 标题 Title 123\n\n正文 Body 456" />);

    const previewContent = container.querySelector("[data-testid='markdown-preview-content']");
    expect(previewContent).toHaveStyle({ fontFamily: "var(--font-reading)" });
  });

  it("keeps preview images inside the content pane with natural sizing", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "# 图片示例",
          "",
          "![图片](../assets/diagram.png)",
        ].join("\n")}
      />,
    );

    const previewContent = container.querySelector("[data-testid='markdown-preview-content']");
    const image = container.querySelector("img");

    expect(previewContent).toHaveStyle({ width: "100%", maxWidth: "none" });
    expect(image).toHaveAttribute("src", "../assets/diagram.png");
    expect(image).toHaveStyle({
      display: "block",
      maxWidth: "100%",
      width: "auto",
      height: "auto",
      objectFit: "contain",
      margin: "0.85em auto",
    });
  });

  it("rewrites local markdown image paths to tauri asset urls when knowledge base is open", () => {
    useAppStore.setState({
      kb: {
        id: "kb-1",
        name: "Demo KB",
        root_path: "/Users/lijun/KnowledgeBase",
        created_at: "2026-06-10T00:00:00Z",
        updated_at: "2026-06-10T00:00:00Z",
      },
    });
    useEditorStore.setState({
      currentNote: makeNote({ path: "notes/project/demo.md" }),
    });

    const { container } = render(
      <MarkdownPreview
        content="![图片](../../assets/20260610-092845-01ktrd.png)"
      />,
    );

    const image = container.querySelector("img") as HTMLImageElement | null;
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("asset:///Users/lijun/KnowledgeBase/assets/20260610-092845-01ktrd.png");
  });

  it("rewrites local markdown image paths from explicit preview context even without editor store state", () => {
    const { container } = render(
      <MarkdownPreview
        content="![图片](../../assets/20260610-092845-01ktrd.png)"
        notePath="notes/project/demo.md"
        kbRootPath="/Users/lijun/KnowledgeBase"
      />,
    );

    const image = container.querySelector("img") as HTMLImageElement | null;
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("asset:///Users/lijun/KnowledgeBase/assets/20260610-092845-01ktrd.png");
  });

  it("rewrites remote markdown image urls to data urls for preview rendering", async () => {
    const remoteUrl = "https://cdn.example.com/diagram.svg";
    const blob = new Blob(["<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"], { type: "image/svg+xml" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(blob),
    });
    const originalFetch = globalThis.fetch;
    const expectedPrefix = "data:image/svg+xml;base64,";

    vi.stubGlobal("fetch", fetchMock);

    try {
      const { container } = render(
        <MarkdownPreview
          content={`![远程图片](${remoteUrl})`}
        />,
      );

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(remoteUrl);
        const src = container.querySelector("img")?.getAttribute("src") ?? "";
        expect(src.startsWith(expectedPrefix)).toBe(true);
      });
    } finally {
      vi.unstubAllGlobals();
      if (originalFetch) {
        vi.stubGlobal("fetch", originalFetch);
      }
    }
  });

  it("renders fenced code blocks with distinct Typora-like formatting", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "```text",
          "PROJECT_NAME=\"common-agent\"",
          "MAX_CONCURRENT_COMMANDS=100",
          "```",
        ].join("\n")}
      />,
    );

    const pre = container.querySelector("pre");
    const code = container.querySelector("pre code");

    expect(pre).toHaveStyle({ background: "#f6f8fa", padding: "14px 16px", borderRadius: "6px" });
    expect(code).toHaveStyle({ fontFamily: "var(--font-mono)", whiteSpace: "pre" });
  });

  it("renders syntax-highlighted tokens for fenced code blocks with an explicit language", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "```typescript",
          "const answer: number = 42;",
          "```",
        ].join("\n")}
      />,
    );

    const code = container.querySelector("pre code.language-typescript");

    expect(code).toBeInTheDocument();
    expect(code).toHaveTextContent("const answer: number = 42;");
    expect(code?.querySelector("span.hljs-keyword")).not.toBeNull();
  });

  it("shows a code-block toolbar with language label and copies the raw code content", async () => {
    vi.useFakeTimers();
    tauriMocks.listen.mockResolvedValue(() => {});
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));

    const { container } = render(
      <>
        <MarkdownPreview
          content={[
            "```typescript",
            "const answer: number = 42;",
            "```",
          ].join("\n")}
        />
        <StatusBar />
      </>,
    );

    expect(container.querySelector(".markdown-code-block-language"))?.toHaveTextContent("typescript");

    const copyButton = screen.getByRole("button", { name: "复制代码" });
    await act(async () => {
      fireEvent.click(copyButton);
      await Promise.resolve();
    });

    expect(writeTextMock).toHaveBeenCalledWith("const answer: number = 42;\n");

    expect(screen.getByText("● 已拷贝")).toBeInTheDocument();
    expect(screen.getByText("● 已拷贝")).toHaveStyle({ color: "#0969da" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(screen.queryByText("● 已拷贝")).not.toBeInTheDocument();
  });

  it("shows line numbers for fenced code blocks", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "```typescript",
          "const answer: number = 42;",
          "console.log(answer);",
          "```",
        ].join("\n")}
      />,
    );

    const lineNumbers = Array.from(container.querySelectorAll(".markdown-code-block-line-number"));
    expect(lineNumbers).toHaveLength(2);
    expect(lineNumbers[0]).toHaveTextContent("1");
    expect(lineNumbers[1]).toHaveTextContent("2");
  });

  it("renders mermaid fenced blocks as diagrams while preserving source-line metadata", async () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "```mermaid",
          "flowchart TD",
          "  Start[Start] --> Stop[Stop]",
          "```",
        ].join("\n")}
      />,
    );

    const diagramBlock = container.querySelector('[data-source-line="1"][data-source-end-line="4"]');

    expect(diagramBlock).toBeInTheDocument();

    await waitFor(() => {
      expect(diagramBlock?.querySelector("svg")).not.toBeNull();
    });
  });

  it("shows an error fallback and preserves raw mermaid source when diagram rendering fails", async () => {
    const renderSpy = vi.spyOn(mermaid, "render").mockRejectedValueOnce(new Error("render failed"));

    try {
      const { container } = render(
        <MarkdownPreview
          content={[
            "```mermaid",
            "flowchart TD",
            "  Start[Start] --> Stop[Stop]",
            "```",
          ].join("\n")}
        />,
      );

      const diagramBlock = container.querySelector('[data-source-line="1"][data-source-end-line="4"]');

      await waitFor(() => {
        expect(diagramBlock).toHaveTextContent("Mermaid 渲染失败");
        expect(diagramBlock?.querySelector("svg")).toBeNull();
        expect(diagramBlock?.querySelector("code.language-mermaid")?.textContent).toContain("flowchart TD");
        expect(diagramBlock?.querySelector("code.language-mermaid")?.textContent).toContain("Start[Start] --> Stop[Stop]");
      });
    } finally {
      renderSpy.mockRestore();
    }
  });

  it("sanitizes rendered mermaid svg before injecting it into the preview", async () => {
    const renderSpy = vi.spyOn(mermaid, "render").mockResolvedValueOnce({
      svg: '<svg><g data-source-line="99"></g><script>alert("x")</script></svg>',
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    try {
      const { container } = render(
        <MarkdownPreview
          content={[
            "```mermaid",
            "flowchart TD",
            "  A --> B",
            "```",
          ].join("\n")}
        />,
      );

      const diagramBlock = container.querySelector('[data-source-line="1"][data-source-end-line="4"]');

      await waitFor(() => {
        expect(diagramBlock?.querySelector("svg")).not.toBeNull();
      });

      expect(diagramBlock?.querySelector("script")).toBeNull();
    } finally {
      renderSpy.mockRestore();
    }
  });

  it("preserves mermaid svg style rules needed for diagram theming", async () => {
    const renderSpy = vi.spyOn(mermaid, "render").mockResolvedValueOnce({
      svg: '<svg><style>.node rect { fill: rgb(255, 244, 206); }</style><g class="node"><rect width="120" height="40"></rect></g></svg>',
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    try {
      const { container } = render(
        <MarkdownPreview
          content={[
            "```mermaid",
            "flowchart TD",
            "  A --> B",
            "```",
          ].join("\n")}
        />,
      );

      const diagramBlock = container.querySelector('[data-source-line="1"][data-source-end-line="4"]');

      await waitFor(() => {
        expect(diagramBlock?.querySelector("svg")).not.toBeNull();
      });

      expect(diagramBlock?.querySelector("style")).not.toBeNull();
    } finally {
      renderSpy.mockRestore();
    }
  });

  it("preserves mermaid foreignObject labels and marker geometry needed for visible flowcharts", async () => {
    const renderSpy = vi.spyOn(mermaid, "render").mockResolvedValueOnce({
      svg: [
        '<svg viewBox="0 0 240 120">',
        '<style>.label{color:#111827}.edgePath path{stroke:#6b7280;stroke-width:2px;fill:none}</style>',
        '<defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M0,0 L12,6 L0,12 z"></path></marker></defs>',
        '<path class="edgePath" d="M20,20 L180,20" marker-end="url(#arrow)"></path>',
        '<foreignObject x="40" y="40" width="120" height="32"><div xmlns="http://www.w3.org/1999/xhtml"><span class="label">Step 1 数据源选择</span></div></foreignObject>',
        '</svg>',
      ].join(""),
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    try {
      const { container } = render(
        <MarkdownPreview
          content={[
            "```mermaid",
            "flowchart TD",
            "  A --> B",
            "```",
          ].join("\n")}
        />,
      );

      const diagramBlock = container.querySelector('[data-source-line="1"][data-source-end-line="4"]');

      await waitFor(() => {
        expect(diagramBlock?.querySelector("svg")).not.toBeNull();
      });

      expect(diagramBlock?.querySelector("foreignObject div span"))?.toHaveTextContent("Step 1 数据源选择");
      expect(diagramBlock?.querySelector("marker")?.getAttribute("markerWidth")).toBe("12");
      expect(diagramBlock?.querySelector("marker")?.getAttribute("markerHeight")).toBe("12");
    } finally {
      renderSpy.mockRestore();
    }
  });

  it("renders mermaid foreignObject HTML labels without surfacing XML parser errors", async () => {
    const renderSpy = vi.spyOn(mermaid, "render").mockResolvedValueOnce({
      svg: [
        '<svg viewBox="0 0 320 160">',
        '<foreignObject x="20" y="20" width="220" height="80">',
        '<div xmlns="http://www.w3.org/1999/xhtml">',
        '<span class="nodeLabel"><p>需求澄清<br>输出字段候选</p></span>',
        '</div>',
        '</foreignObject>',
        '</svg>',
      ].join(""),
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    try {
      const { container } = render(
        <MarkdownPreview
          content={[
            "```mermaid",
            "flowchart TD",
            "  A --> B",
            "```",
          ].join("\n")}
        />,
      );

      const diagramBlock = container.querySelector('[data-source-line="1"][data-source-end-line="4"]');

      await waitFor(() => {
        expect(diagramBlock?.querySelector("svg")).not.toBeNull();
      });

      expect(diagramBlock).toHaveTextContent("需求澄清");
      expect(diagramBlock).toHaveTextContent("输出字段候选");
      expect(diagramBlock).not.toHaveTextContent("This page contains the following errors");
    } finally {
      renderSpy.mockRestore();
    }
  });

  it("passes mermaid definitions through without wiki-link rewriting inside fenced blocks", async () => {
    const renderSpy = vi.spyOn(mermaid, "render").mockResolvedValueOnce({
      svg: "<svg></svg>",
      bindFunctions: undefined,
      diagramType: "flowchart",
    });

    try {
      render(
        <MarkdownPreview
          content={[
            "```mermaid",
            "flowchart LR",
            "  A[[Subroutine]] --> B",
            "```",
          ].join("\n")}
        />,
      );

      await waitFor(() => {
        expect(renderSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^markdown-preview-mermaid-/),
          "flowchart LR\n  A[[Subroutine]] --> B",
        );
      });
    } finally {
      renderSpy.mockRestore();
    }
  });

  it("renders representative mermaid note samples for common diagram syntaxes", async () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "## 流程图",
          "",
          "```mermaid",
          "flowchart TD",
          "  Start --> Review --> Publish",
          "```",
          "",
          "## 时序图",
          "",
          "```mermaid",
          "sequenceDiagram",
          "  participant User",
          "  participant App",
          "  User->>App: Open note",
          "  App-->>User: Render preview",
          "```",
          "",
          "## 类图",
          "",
          "```mermaid",
          "classDiagram",
          "  class Note {",
          "    +string title",
          "    +string content",
          "  }",
          "  class PreviewPane",
          "  Note --> PreviewPane : renders in",
          "```",
        ].join("\n")}
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("pre.mermaid-diagram svg")).toHaveLength(3);
    });
  });

  it("renders the real rule-builder business flowchart sample with visible Chinese labels", async () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "## 5. 业务流程图",
          "",
          "```mermaid",
          "flowchart TD",
          "  A[用户输入规则需求] --> B[Step 1 数据源选择]",
          "  B --> B1[获取可见筛查源]",
          "  B1 --> B2[LLM 推荐数据源和候选表]",
          "  B2 --> B3[用户确认或切换数据源]",
          "",
          "  B3 --> C[Step 2 需求澄清]",
          "  C --> C1[基于真实表结构/字段别名/样本数据提取意图]",
          "  C1 --> C2[生成澄清问题和输出字段候选]",
          "  C2 --> C3[用户确认答案/补充说明/选择输出字段]",
          "",
          "  C3 --> D[Step 3 规则构建]",
          "  D --> D1[JOIN 推断与字段校验]",
          "  D1 --> D2[生成结构化 query_logic]",
          "  D2 --> D3[程序化校验与 SQL 组装]",
          "  D3 --> D4[可视化查询构建器展示]",
          "  D4 --> D5{用户是否调整?}",
          "  D5 -- 是 --> D6[自然语言指令增量修改/版本快照]",
          "  D6 --> D4",
          "  D5 -- 否 --> E[Step 4a Demo 数据确认]",
          "",
          "  E --> E1[生成正例/反例/边界测试数据]",
          "  E1 --> E2[修正跨表 JOIN 键和 tag 一致性]",
          "  E2 --> E3[用户确认 Demo 数据]",
          "",
          "  E3 --> F[Step 4b 验证]",
          "  F --> F1[创建 Demo 表并插入数据]",
          "  F1 --> F2[执行分层验证 L1/L2/L3/L4]",
          "  F2 --> F3{验证通过?}",
          "```",
        ].join("\n")}
      />,
    );

    const diagramBlock = container.querySelector('[data-source-line="3"]');
    expect(diagramBlock).toBeInTheDocument();

    await waitFor(() => {
      expect(diagramBlock?.querySelector("svg")).not.toBeNull();
    });

    expect(diagramBlock).toHaveTextContent("用户输入规则需求");
    expect(diagramBlock).toHaveTextContent("Step 1 数据源选择");
    expect(diagramBlock).toHaveTextContent("用户是否调整?");
    expect(diagramBlock).toHaveTextContent("执行分层验证 L1/L2/L3/L4");
  });

  it("uses a diagram-oriented surface for mermaid previews instead of plain code-block chrome", async () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "```mermaid",
          "flowchart TD",
          "  Idea --> Draft --> Review",
          "```",
        ].join("\n")}
      />,
    );

    const diagramBlock = container.querySelector("pre.mermaid-diagram");

    await waitFor(() => {
      expect(diagramBlock?.querySelector("svg")).not.toBeNull();
    });

    expect(diagramBlock).toHaveStyle({
      background: "#ffffff",
      padding: "18px 20px",
      borderRadius: "8px",
    });
  });

  it("keeps non-mermaid fenced blocks on the normal rendering path without invoking mermaid", () => {
    const renderSpy = vi.spyOn(mermaid, "render");

    try {
      const { container } = render(
        <MarkdownPreview
          content={[
            "```text",
            "plain fenced block",
            "```",
          ].join("\n")}
        />,
      );

      expect(container.querySelector("pre.mermaid-diagram")).toBeNull();
      expect(container.querySelector("pre code.language-text")).toHaveTextContent("plain fenced block");
      expect(renderSpy).not.toHaveBeenCalled();
    } finally {
      renderSpy.mockRestore();
    }
  });

  it("highlights the matched term inside fenced code blocks without highlighting the whole block", async () => {
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 2,
      line_end: 2,
      occurrence_order: 1,
      match_text: "nacos",
      source: "body",
      context_snippet: 'private.pro.config=<Nacos地址>:<Nacos端口>',
      revision: 8,
    };

    const { container } = render(
      <MarkdownPreview
        content={[
          "```properties",
          "private.pro.config=<Nacos地址>:<Nacos端口>",
          "```",
        ].join("\n")}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("pre.search-navigation-target")).toBeNull();
      expect(container.querySelector("mark.search-navigation-target")).toHaveTextContent("Nacos");
    });
  });

  it("hides a valid closed opening front matter block while rendering visible Markdown content", () => {
    render(
      <MarkdownPreview
        content={[
          "---",
          "title: Hidden Title",
          "tags:",
          "  - private",
          "---",
          "",
          "# Visible Title",
          "",
          "Visible body text",
        ].join("\n")}
      />,
    );

    expect(screen.queryByText("Hidden Title")).not.toBeInTheDocument();
    expect(screen.queryByText("private")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Visible Title" })).toBeInTheDocument();
    expect(screen.getByText("Visible body text")).toBeInTheDocument();
  });

  it("does not strip an unclosed opening front matter block incorrectly", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "---",
          "title: Draft Without Closing Fence",
          "# Still Part Of The Draft",
        ].join("\n")}
      />,
    );

    expect(container.querySelector("hr")).toBeInTheDocument();
    expect(screen.getByText("title: Draft Without Closing Fence")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Still Part Of The Draft" })).toBeInTheDocument();
  });

  it("renders the limited raw HTML tags allowed inside markdown content", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "水是 H<sub>2</sub>O，能量是 mc<sup>2</sup>。",
          "",
          "按 <kbd>Cmd</kbd> + <kbd>K</kbd>，这是 <mark>重点</mark>。",
          "",
          "<p>HTML 段落<span title=\"note\">内联说明</span><br>下一行</p>",
          "",
          "<details open>",
          "<summary>展开说明</summary>",
          "更多内容",
          "</details>",
          "",
          "<img src=\"notes/assets/demo.png\" alt=\"示例图\" title=\"Demo\">",
        ].join("\n")}
      />,
    );

    expect(container.querySelector("sub")).toHaveTextContent("2");
    expect(container.querySelector("sup")).toHaveTextContent("2");
    expect(container.querySelector("sub")).toHaveStyle({ color: "#16a34a" });
    expect(container.querySelector("sup")).toHaveStyle({ color: "#2563eb" });
    expect(container.querySelector("sub")).not.toHaveStyle({ fontWeight: "600" });
    expect(container.querySelector("sup")).not.toHaveStyle({ fontWeight: "600" });
    expect(container.querySelector("kbd")).toHaveTextContent("Cmd");
    expect(container.querySelector("kbd")).toHaveStyle({
      padding: "0.16em 0.48em",
      borderRadius: "0.45em",
      background: "linear-gradient(180deg, #ffffff 0%, #e7ecf3 100%)",
      border: "1px solid #bcc7d6",
      color: "#475569",
    });
    expect(container.querySelector("mark")).toHaveTextContent("重点");
    expect(container.querySelector("p span[title='note']")).toHaveTextContent("内联说明");
    expect(container.querySelector("p br")).toBeInTheDocument();
    expect(container.querySelector("details[open] summary")).toHaveTextContent("展开说明");
    expect(container.querySelector("img[alt='示例图']")).toHaveAttribute("src", "notes/assets/demo.png");
  });

  it("supports ..: as a paragraph-level marker for Chinese first-line indentation", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "..: 这是一个需要首行缩进的段落，支持 **Markdown** 内联格式。",
          "同一个段落的第二行仍然属于这个缩进段落。",
          "",
          "这是一个普通段落。",
          "",
          "..: 第二个缩进段落。",
        ].join("\n")}
      />,
    );

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toHaveClass("markdown-cn-indent-paragraph");
    expect(paragraphs[0]).toHaveStyle({ textIndent: "2em" });
    expect(paragraphs[0]).toHaveTextContent("这是一个需要首行缩进的段落，支持 Markdown 内联格式。 同一个段落的第二行仍然属于这个缩进段落。");
    expect(paragraphs[0].textContent).not.toContain("..:");
    expect(paragraphs[1]).not.toHaveClass("markdown-cn-indent-paragraph");
    expect(paragraphs[1]).toHaveTextContent("这是一个普通段落。");
    expect(paragraphs[2]).toHaveClass("markdown-cn-indent-paragraph");
    expect(paragraphs[2]).toHaveTextContent("第二个缩进段落。");
  });

  it("does not treat ..: inside list items as a Chinese indentation paragraph marker", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "- ..: 这是列表项，不应该触发中文段首缩进语法。",
          "",
          "..: 这是普通段落，应该继续触发缩进。",
        ].join("\n")}
      />,
    );

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toHaveClass("markdown-cn-indent-paragraph");
    expect(container.querySelector("li .markdown-cn-indent-paragraph")).toBeNull();
    expect(container.querySelector("li")).toHaveTextContent("这是列表项，不应该触发中文段首缩进语法。");
  });

  it("renders ..(password).. as an inline embedded password-like field with a fixed six-star mask", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "登录密码：..(P@ssw0rd-2026)..，请勿外传。",
          "代码示例：`..(demo-code)..` 不应被转换。",
        ].join("\n\n")}
      />,
    );

    const passwordField = container.querySelector("input[type='text']") as HTMLInputElement | null;
    expect(passwordField).not.toBeNull();
    expect(passwordField).toHaveClass("markdown-password-field");
    expect(passwordField).toHaveAttribute("value", "******");
    expect(passwordField).toHaveAttribute("size", "6");
    expect(passwordField).toHaveAttribute("readonly");
    expect(passwordField).toHaveAttribute("tabindex", "-1");
    expect(passwordField).toHaveStyle({ width: "8.2ch" });
    expect(passwordField).toHaveStyle({
      background: "#f8fafc",
      border: "1px solid #d8e1ec",
      borderRadius: "6px",
      boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.96)",
    });
    expect(container.querySelector("code")).toHaveTextContent("..(demo-code)..");
    expect(container.querySelector("code input[type='text']")).toBeNull();
  });

  it("removes raw HTML tags outside the whitelist without disabling markdown-generated elements", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "| A | B |",
          "| --- | --- |",
          "| 1 | 2 |",
          "",
          "<table><tr><td>Raw table</td></tr></table>",
          "<iframe src=\"https://example.com\"></iframe>",
          "<script>window.__previewXss = true</script>",
          "<video src=\"demo.mp4\"></video>",
          "<span style=\"color:red\" onclick=\"alert(1)\">Safe text</span>",
        ].join("\n")}
      />,
    );

    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelector("td")).toHaveTextContent("1");
    expect(container).not.toHaveTextContent("Raw table");
    expect(container.querySelector("iframe")).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(container.querySelector("span")).toHaveTextContent("Safe text");
    expect(container.querySelector("span")).not.toHaveAttribute("style");
    expect(container.querySelector("span")).not.toHaveAttribute("onclick");
  });

  it("does not render dangerous HTML or non-http links as executable elements or links", () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "<script>window.__previewXss = true</script>",
          "",
          "<img src=x onerror=\"window.__previewXss = true\">",
          "",
          "[Bad JavaScript](javascript:alert(1))",
          "",
          "[Bad Mail](mailto:test@example.com)",
        ].join("\n")}
      />,
    );

    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toHaveAttribute("src");
    expect(container.querySelector("img")).not.toHaveAttribute("onerror");
    expect(container.querySelector('a[href^="javascript:"]')).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="mailto:"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bad JavaScript" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bad Mail" })).not.toBeInTheDocument();
  });

  it("opens HTTP and HTTPS links through Tauri openUrl", async () => {
    render(
      <MarkdownPreview
        content={[
          "[HTTP Site](http://example.com)",
          "",
          "[HTTPS Site](https://example.com/docs)",
        ].join("\n")}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "HTTP Site" }));
    fireEvent.click(screen.getByRole("link", { name: "HTTPS Site" }));

    await waitFor(() => {
      expect(tauriMocks.openUrl).toHaveBeenCalledWith("http://example.com");
      expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://example.com/docs");
    });
  });

  it("synchronously prevents default for managed preview links before async handling", () => {
    const internalNote = makeNote({
      id: "prevent-default-note",
      path: "notes/产品/需求.md",
      title: "需求",
      content_hash: "prevent-default-hash",
    });

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_note_by_path") {
        expect(args).toEqual({ path: internalNote.path });
        return makeNoteDetail({ note: internalNote, content: "# 需求" });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    render(
      <MarkdownPreview
        content={[
          "[Internal](notes/%E4%BA%A7%E5%93%81/%E9%9C%80%E6%B1%82.md)",
          "",
          "[External](https://example.com/docs)",
        ].join("\n")}
      />,
    );

    const internalEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link", { name: "Internal" }).dispatchEvent(internalEvent);
    expect(internalEvent.defaultPrevented).toBe(true);

    const externalEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link", { name: "External" }).dispatchEvent(externalEvent);
    expect(externalEvent.defaultPrevented).toBe(true);
  });

  it("opens a resolved wiki link and updates app and editor stores", async () => {
    const resolvedNote = makeNote({
      id: "wiki-note",
      path: "notes/wiki-title.md",
      title: "Wiki Title",
      content_hash: "wiki-hash",
    });
    const resolvedDetail = makeNoteDetail({
      note: resolvedNote,
      content: "# Wiki Title\n\nResolved content",
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_note_by_title") {
        expect(args).toEqual({ title: "Wiki Title" });
        return resolvedNote;
      }
      if (command === "get_note_by_path") {
        expect(args).toEqual({ path: "notes/wiki-title.md" });
        return resolvedDetail;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    render(<MarkdownPreview content="Open [[Wiki Title]] from preview" />);

    fireEvent.click(screen.getByText("Wiki Title"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_note_by_title", { title: "Wiki Title" });
      expect(invokeMock).toHaveBeenCalledWith("get_note_by_path", { path: "notes/wiki-title.md" });
      expect(useAppStore.getState().selectedNodePath).toBe("notes/wiki-title.md");
      expect(useEditorStore.getState().currentNote).toEqual(resolvedNote);
      expect(useEditorStore.getState().content).toBe("# Wiki Title\n\nResolved content");
    });
  });

  it("highlights the navigation target inline tag using the original file line number", async () => {
    const tagNavigationTarget: TagNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      note_updated_at: "2026-06-01T00:00:00Z",
      source: "inline",
      occurrence_order: 1,
      line_start: 7,
      line_end: 7,
      heading_context: null,
      context_snippet: "Body #阶段一",
      tag_name: "阶段一",
      revision: 1,
    };

    const { container } = render(
      <MarkdownPreview
        content={[
          "---",
          "title: Demo",
          "tags:",
          "  - private",
          "---",
          "",
          "Body #阶段一",
        ].join("\n")}
        tagNavigationTarget={tagNavigationTarget}
      />,
    );

    await waitFor(() => {
      const highlightedTag = container.querySelector(".inline-tag-navigation-target");
      expect(highlightedTag).toHaveTextContent("阶段一");
    });
  });

  it("shows preview feedback for a front matter navigation target", async () => {
    const tagNavigationTarget: TagNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      note_updated_at: "2026-06-01T00:00:00Z",
      source: "front_matter",
      occurrence_order: 0,
      line_start: 2,
      line_end: 2,
      heading_context: null,
      context_snippet: "Front Matter 标签",
      tag_name: "阶段一",
      revision: 2,
    };

    const { container } = render(
      <MarkdownPreview
        content={[
          "---",
          "title: Demo",
          "tags:",
          "  - 阶段一",
          "---",
          "",
          "Body text",
        ].join("\n")}
        tagNavigationTarget={tagNavigationTarget}
      />,
    );

    await waitFor(() => {
      const previewContent = container.querySelector(".markdown-preview-content");
      expect(previewContent).toHaveClass("markdown-preview-front-matter-navigation-target");
    });
  });

  it("scrolls to the translated preview source line when searchNavigationTarget is provided", async () => {
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 9,
      line_end: 9,
      occurrence_order: 1,
      match_text: "alpha",
      source: "body",
      context_snippet: "Body alpha target",
      revision: 1,
    };

    const { container, rerender } = render(
      <MarkdownPreview
        content={[
          "---",
          "title: Demo",
          "tags:",
          "  - private",
          "---",
          "",
          "# Heading",
          "",
          "Body alpha target",
        ].join("\n")}
      />,
    );

    const scrollContainer = container.firstElementChild as HTMLDivElement;
    scrollContainer.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => ({}),
    });

    const heading = container.querySelector("h1") as HTMLElement;
    const paragraph = container.querySelector("p") as HTMLElement;
    heading.getBoundingClientRect = () => ({
      x: 0,
      y: 40,
      left: 0,
      top: 40,
      right: 600,
      bottom: 80,
      width: 600,
      height: 40,
      toJSON: () => ({}),
    });
    paragraph.getBoundingClientRect = () => ({
      x: 0,
      y: 180,
      left: 0,
      top: 180,
      right: 600,
      bottom: 220,
      width: 600,
      height: 40,
      toJSON: () => ({}),
    });

    rerender(
      <MarkdownPreview
        content={[
          "---",
          "title: Demo",
          "tags:",
          "  - private",
          "---",
          "",
          "# Heading",
          "",
          "Body alpha target",
        ].join("\n")}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBe(180);
    });
  });

  it("does not scroll preview search navigation when the hit is fully inside stripped front matter", async () => {
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 2,
      line_end: 2,
      occurrence_order: 1,
      match_text: "Demo",
      source: "title",
      context_snippet: "title: Demo",
      revision: 2,
    };

    const { container, rerender } = render(
      <MarkdownPreview
        content={[
          "---",
          "title: Demo",
          "tags:",
          "  - private",
          "---",
          "",
          "Body text",
        ].join("\n")}
      />,
    );

    const scrollContainer = container.firstElementChild as HTMLDivElement;
    scrollContainer.scrollTop = 0;

    rerender(
      <MarkdownPreview
        content={[
          "---",
          "title: Demo",
          "tags:",
          "  - private",
          "---",
          "",
          "Body text",
        ].join("\n")}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      expect(scrollContainer.scrollTop).toBe(0);
    });
  });

  it("highlights the active search navigation target in preview content", async () => {
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 3,
      line_end: 3,
      occurrence_order: 1,
      match_text: "alpha",
      source: "body",
      context_snippet: "Body alpha target",
      revision: 3,
    };

    const { container } = render(
      <MarkdownPreview
        content={["# Heading", "", "Body alpha target"].join("\n")}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      const highlightedSearchHit = container.querySelector(".search-navigation-target");
      expect(highlightedSearchHit).toHaveTextContent("alpha");
    });
  });

  it("highlights the occurrence selected by occurrence_order in preview content", async () => {
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 3,
      line_end: 3,
      occurrence_order: 2,
      match_text: "alpha",
      source: "body",
      context_snippet: "alpha middle alpha end",
      revision: 4,
    };

    const { container } = render(
      <MarkdownPreview
        content={["# Heading", "", "alpha middle alpha end"].join("\n")}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      const highlightedSearchHit = container.querySelector(".search-navigation-target");
      expect(highlightedSearchHit).toHaveTextContent("alpha");
      expect(highlightedSearchHit?.previousSibling?.textContent).toContain("alpha middle ");
    });
  });

  it("matches translated preview highlights case-insensitively for repeated hits after front matter", async () => {
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 7,
      line_end: 7,
      occurrence_order: 2,
      match_text: "alpha",
      source: "body",
      context_snippet: "Alpha middle alpha end",
      revision: 5,
    };

    const { container } = render(
      <MarkdownPreview
        content={[
          "---",
          "title: Demo",
          "tags:",
          "  - private",
          "---",
          "",
          "Alpha middle alpha end",
        ].join("\n")}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      const highlightedSearchHit = container.querySelector(".search-navigation-target");
      expect(highlightedSearchHit).toHaveTextContent("alpha");
      expect(highlightedSearchHit?.previousSibling?.textContent).toContain("Alpha middle ");
    });
  });

  it("recomputes preview search highlighting when content changes under the same target", async () => {
    const searchNavigationTarget: SearchNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      line_start: 3,
      line_end: 3,
      occurrence_order: 1,
      match_text: "alpha",
      source: "body",
      context_snippet: "Body alpha target",
      revision: 6,
    };

    const { container, rerender } = render(
      <MarkdownPreview
        content={["# Heading", "", "Body alpha target"].join("\n")}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".search-navigation-target")).toHaveTextContent("alpha");
    });

    rerender(
      <MarkdownPreview
        content={[
          "---",
          "title: Demo",
          "tags:",
          "  - alpha",
          "---",
          "",
          "# Heading",
          "",
          "Body alpha target",
        ].join("\n")}
        searchNavigationTarget={searchNavigationTarget}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".search-navigation-target")).toBeNull();
    });
  });

  it("opens the preview blank context menu with return-to-editor and show-sidebar actions", async () => {
    useEditorStore.getState().setEditorMode("split");
    useAppStore.getState().setRightSidebarVisible(false);

    const { container } = renderWithContextMenu(<MarkdownPreview content="Preview body" />);

    fireEvent.contextMenu(container.querySelector("[data-testid='markdown-preview-content']") as HTMLElement, {
      clientX: 60,
      clientY: 80,
    });

    expect(await screen.findByRole("menuitem", { name: "返回编辑" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "显示侧栏" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "返回编辑" }));
    expect(useEditorStore.getState().getEditorMode()).toBe("editor");

    fireEvent.contextMenu(container.querySelector("[data-testid='markdown-preview-content']") as HTMLElement, {
      clientX: 60,
      clientY: 80,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "显示侧栏" }));
    expect(useAppStore.getState().rightSidebarVisible).toBe(true);
  });

  it("enables open target note for internal and wiki links in the preview context menu", async () => {
    const resolvedWikiNote = makeNote({
      id: "wiki-note",
      path: "notes/wiki-target.md",
      title: "Wiki Target",
      content_hash: "wiki-hash",
    });

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_note_by_title") {
        expect(args).toEqual({ title: "Wiki Target" });
        return resolvedWikiNote;
      }
      if (command === "get_note_by_path") {
        expect(args).toEqual({ path: resolvedWikiNote.path });
        return makeNoteDetail({ note: resolvedWikiNote, content: "# Wiki Target" });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderWithContextMenu(
      <MarkdownPreview
        content={[
          "[Internal](notes/internal-target.md)",
          "",
          "Open [[Wiki Target]]",
        ].join("\n")}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("link", { name: "Internal" }), { clientX: 32, clientY: 40 });
    expect(await screen.findByRole("menuitem", { name: "打开目标笔记" })).toHaveAttribute("aria-disabled", "false");

    fireEvent.contextMenu(screen.getByText("Wiki Target"), { clientX: 32, clientY: 40 });
    expect(await screen.findByRole("menuitem", { name: "打开目标笔记" })).toHaveAttribute("aria-disabled", "false");
  });

  it("disables open target note for external links in the preview context menu", async () => {
    renderWithContextMenu(<MarkdownPreview content="[External](https://example.com/docs)" />);

    fireEvent.contextMenu(screen.getByRole("link", { name: "External" }), { clientX: 42, clientY: 48 });

    expect(await screen.findByRole("menuitem", { name: "打开目标笔记" })).toHaveAttribute("aria-disabled", "true");
  });

  it("ignores stale async preview link context menu resolutions", async () => {
    const wikiLookup = deferred<ReturnType<typeof makeNote>>();

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_note_by_title") {
        expect(args).toEqual({ title: "Wiki Target" });
        return wikiLookup.promise;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { container } = renderWithContextMenu(
      <MarkdownPreview content={[["Open [[Wiki Target]]", "", "Preview body"].join("\n")][0]} />,
    );

    fireEvent.contextMenu(screen.getByText("Wiki Target"), { clientX: 32, clientY: 40 });
    fireEvent.contextMenu(container.querySelector("[data-testid='markdown-preview-content']") as HTMLElement, {
      clientX: 60,
      clientY: 80,
    });

    expect(await screen.findByRole("menuitem", { name: "返回编辑" })).toBeInTheDocument();

    wikiLookup.resolve(makeNote({
      id: "wiki-note",
      path: "notes/wiki-target.md",
      title: "Wiki Target",
      content_hash: "wiki-hash",
    }));

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "返回编辑" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "打开链接" })).not.toBeInTheDocument();
    });
  });

  it("keeps normal left-click semantics after opening preview link context menus", async () => {
    const internalNote = makeNote({
      id: "internal-note",
      path: "notes/internal-target.md",
      title: "Internal Target",
      content_hash: "internal-hash",
    });

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_note_by_path") {
        expect(args).toEqual({ path: internalNote.path });
        return makeNoteDetail({ note: internalNote, content: "# Internal Target" });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderWithContextMenu(<MarkdownPreview content="[Internal](notes/internal-target.md)" />);

    const link = screen.getByRole("link", { name: "Internal" });
    fireEvent.contextMenu(link, { clientX: 20, clientY: 24 });
    expect(await screen.findByRole("menuitem", { name: "打开链接" })).toBeInTheDocument();

    fireEvent.click(link);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_note_by_path", { path: "notes/internal-target.md" });
      expect(useEditorStore.getState().currentNote).toEqual(internalNote);
      expect(useAppStore.getState().selectedNodePath).toBe("notes/internal-target.md");
    });
  });

  it("normalizes encoded note hrefs for preview context menu and open behavior", async () => {
    const encodedNote = makeNote({
      id: "encoded-note",
      path: "notes/产品/需求.md",
      title: "需求",
      content_hash: "encoded-hash",
    });

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_note_by_path") {
        expect(args).toEqual({ path: encodedNote.path });
        return makeNoteDetail({ note: encodedNote, content: "# 需求" });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    renderWithContextMenu(
      <MarkdownPreview content="[Encoded](notes/%E4%BA%A7%E5%93%81/%E9%9C%80%E6%B1%82.md?view=preview#%E6%A0%87%E9%A2%98)" />,
    );

    const link = screen.getByRole("link", { name: "Encoded" });

    fireEvent.contextMenu(link, { clientX: 28, clientY: 36 });
    const openTargetNoteItem = await screen.findByRole("menuitem", { name: "打开目标笔记" });
    expect(openTargetNoteItem).toHaveAttribute("aria-disabled", "false");

    fireEvent.click(openTargetNoteItem);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_note_by_path", { path: encodedNote.path });
      expect(useEditorStore.getState().currentNote).toEqual(encodedNote);
      expect(useAppStore.getState().selectedNodePath).toBe(encodedNote.path);
    });

    invokeMock.mockClear();

    fireEvent.click(link);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_note_by_path", { path: encodedNote.path });
      expect(useEditorStore.getState().currentNote).toEqual(encodedNote);
      expect(useAppStore.getState().selectedNodePath).toBe(encodedNote.path);
    });
  });

  it("navigates preview clicks to the anchored heading in another note", async () => {
    const anchoredNote = makeNote({
      id: "anchored-note",
      path: "notes/target.md",
      title: "Target",
      content_hash: "target-hash",
    });

    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_note_by_path") {
        expect(args).toEqual({ path: anchoredNote.path });
        return makeNoteDetail({
          note: anchoredNote,
          content: ["# 目标文档", "", "## 执行摘要", "内容"].join("\n"),
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    render(<MarkdownPreview content="[Open target](notes/target.md#执行摘要)" />);

    fireEvent.click(screen.getByRole("link", { name: "Open target" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_note_by_path", { path: anchoredNote.path });
      expect(useEditorStore.getState().currentNote).toEqual(anchoredNote);
      expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
        note_path: anchoredNote.path,
        line_start: 3,
        line_end: 3,
        match_text: "执行摘要",
        source: "body",
      });
    });
  });

  it("navigates preview clicks to anchored headings in the current note", async () => {
    useAppStore.setState({ selectedNodePath: "notes/current.md" });
    useEditorStore.setState({
      currentNote: makeNote({
        id: "current-note",
        path: "notes/current.md",
        title: "Current",
        content_hash: "current-hash",
      }),
      content: ["# 当前文档", "", "## 结论", "正文"].join("\n"),
    });

    render(<MarkdownPreview content="[Jump local](#结论)" />);

    fireEvent.click(screen.getByRole("link", { name: "Jump local" }));

    await waitFor(() => {
      expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
        note_path: "notes/current.md",
        line_start: 3,
        line_end: 3,
        match_text: "结论",
        source: "body",
      });
    });
  });

  it("navigates preview clicks to numbered headings when the hash omits the numeric prefix", async () => {
    useAppStore.setState({ selectedNodePath: "notes/usage-help.md" });
    useEditorStore.setState({
      currentNote: makeNote({
        id: "usage-help-note",
        path: "notes/usage-help.md",
        title: "Usage Help",
        content_hash: "usage-help-hash",
      }),
      content: [
        "## 目录",
        "",
        "1. [开始使用](#开始使用)",
        "",
        "## 1. 开始使用",
        "",
        "正文",
      ].join("\n"),
    });

    render(<MarkdownPreview content={useEditorStore.getState().content} />);

    fireEvent.click(screen.getByRole("link", { name: "开始使用" }));

    await waitFor(() => {
      expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
        note_path: "notes/usage-help.md",
        line_start: 5,
        line_end: 5,
        match_text: "开始使用",
        source: "body",
      });
    });
  });

  it("navigates preview clicks to headings that define an explicit markdown anchor id", async () => {
    useAppStore.setState({ selectedNodePath: "notes/usage-help.md" });
    useEditorStore.setState({
      currentNote: makeNote({
        id: "usage-help-note-explicit-anchor",
        path: "notes/usage-help.md",
        title: "Usage Help",
        content_hash: "usage-help-anchor-hash",
      }),
      content: [
        "## 目录",
        "",
        "2. [术语说明](#glossary)",
        "",
        "## 2. 术语说明 {#glossary}",
        "",
        "正文",
      ].join("\n"),
    });

    render(<MarkdownPreview content={useEditorStore.getState().content} />);

    fireEvent.click(screen.getByRole("link", { name: "术语说明" }));

    await waitFor(() => {
      expect(useEditorStore.getState().searchNavigationTarget).toMatchObject({
        note_path: "notes/usage-help.md",
        line_start: 5,
        line_end: 5,
        match_text: "glossary",
        source: "body",
      });
    });
  });
});
