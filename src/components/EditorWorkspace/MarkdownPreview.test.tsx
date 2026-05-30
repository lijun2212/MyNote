import { invoke } from "@tauri-apps/api/core";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { tauriMocks } from "../../test/setup";
import { makeNote, makeNoteDetail } from "../../test/testData";

const invokeMock = vi.mocked(invoke);

describe("MarkdownPreview", () => {
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
});