import { invoke } from "@tauri-apps/api/core";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { tauriMocks } from "../../test/setup";
import { makeNote, makeNoteDetail } from "../../test/testData";
import type { TagNavigationTarget } from "../../types";

const invokeMock = vi.mocked(invoke);

describe("MarkdownPreview", () => {
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

  it("uses a Typora-like reading font stack for Chinese, English, and numbers", () => {
    const { container } = render(<MarkdownPreview content="# 标题 Title 123\n\n正文 Body 456" />);

    const previewContent = container.querySelector("[data-testid='markdown-preview-content']");
    expect(previewContent).toHaveStyle({ fontFamily: "var(--font-reading)" });
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
    expect(container.querySelector("img")).not.toBeInTheDocument();
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
});