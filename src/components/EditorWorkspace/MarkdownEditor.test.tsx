import { render, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";
import { setActiveDraggedTagName, clearActiveDraggedTagName } from "./tagDragState";
import type { TagNavigationTarget } from "../../types";

describe("MarkdownEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearActiveDraggedTagName();
  });

  it("inserts a dragged tag at the drop location", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    const editorRoot = container.querySelector(".cm-editor") as HTMLElement;
    expect(editorRoot).toBeTruthy();

    fireEvent.dragOver(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["application/x-mynote-tag"],
        getData: (type: string) => (type === "application/x-mynote-tag" ? "阶段一" : ""),
      },
    });

    fireEvent.drop(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["application/x-mynote-tag"],
        getData: (type: string) => (type === "application/x-mynote-tag" ? "阶段一" : ""),
      },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#阶段一");
  });

  it("accepts a dragged tag from text/plain when custom drag mime is unavailable", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    const editorRoot = container.firstElementChild as HTMLElement;
    fireEvent.dragOver(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "#法律适用" : ""),
      },
    });

    fireEvent.drop(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "#法律适用" : ""),
      },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#法律适用");
  });

  it("falls back to the shared dragged tag when drag payload data is unavailable", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    setActiveDraggedTagName("阶段一");

    const editorRoot = container.firstElementChild as HTMLElement;
    fireEvent.dragOver(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: [],
        getData: () => "",
      },
    });

    fireEvent.drop(editorRoot, {
      clientX: 18,
      clientY: 24,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: [],
        getData: () => "",
      },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#阶段一");
  });

  it("inserts a tag when the sidebar add button dispatches an insert event", async () => {
    const onChange = vi.fn();
    render(
      <MarkdownEditor
        initialContent={"# Title\n\nBody"}
        onChange={onChange}
      />,
    );

    window.dispatchEvent(new CustomEvent("mynote:insert-tag", {
      detail: { tagName: "项目报告", source: "panel-add" },
    }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange.mock.lastCall?.[0]).toContain("#项目报告");
  });

  it("highlights the navigation target tag when tagNavigationTarget is provided", async () => {
    const onChange = vi.fn();
    const tagNavigationTarget: TagNavigationTarget = {
      note_id: "note-1",
      note_path: "notes/demo.md",
      note_title: "Demo",
      note_updated_at: "2026-06-01T00:00:00Z",
      source: "inline",
      occurrence_order: 1,
      line_start: 3,
      line_end: 3,
      heading_context: null,
      context_snippet: "Body #阶段一",
      tag_name: "阶段一",
      revision: 1,
    };

    const { container } = render(
      <MarkdownEditor
        initialContent={["# Title", "", "Body #阶段一"].join("\n")}
        onChange={onChange}
        tagNavigationTarget={tagNavigationTarget}
      />,
    );

    await waitFor(() => {
      const highlightedTag = container.querySelector(".cm-inline-tag-navigation-target");
      expect(highlightedTag).toHaveTextContent("#阶段一");
    });
  });
});