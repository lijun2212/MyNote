import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("MarkdownPreview lazy loading", () => {
  it("does not load the mermaid runtime for notes without mermaid fenced blocks", async () => {
    vi.resetModules();

    const mermaidModuleFactory = vi.fn(() => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(),
      },
    }));

    vi.doMock("mermaid", mermaidModuleFactory);

    const { MarkdownPreview } = await import("./MarkdownPreview");

    render(
      <MarkdownPreview
        content={[
          "# Plain note",
          "",
          "```text",
          "plain fenced block",
          "```",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("plain fenced block")).toBeInTheDocument();
    expect(mermaidModuleFactory).not.toHaveBeenCalled();
  });
});