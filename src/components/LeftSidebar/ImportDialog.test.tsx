import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportDialog } from "./ImportDialog";

const apiMocks = vi.hoisted(() => ({
  importMarkdownSources: vi.fn(),
}));

vi.mock("../../api/commands", () => ({
  api: apiMocks,
}));

function setViewportHeight(height: number) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

function buildWarnings(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    sourcePath: `/tmp/source-${index}.md`,
    message: `Skipped external asset ${index}`,
  }));
}

describe("ImportDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiMocks.importMarkdownSources.mockReset();
    setViewportHeight(800);
  });

  it("limits dialog height to the current viewport and updates on resize", async () => {
    const user = userEvent.setup();

    apiMocks.importMarkdownSources.mockResolvedValue({
      imported: [],
      warnings: buildWarnings(40),
      failures: [],
    });

    render(
      <ImportDialog
        sources={[{ kind: "file", path: "/tmp/example.md" }]}
        existingDirs={["notes"]}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    const overlay = screen.getByTestId("import-dialog-overlay");
    const panel = screen.getByTestId("import-dialog-panel");
    const body = screen.getByTestId("import-dialog-body");

    expect(overlay).toHaveStyle({
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });
    expect(panel).toHaveStyle({ maxHeight: "704px" });
    expect(body).toHaveStyle({ overflowY: "auto" });

    await user.click(screen.getByRole("button", { name: "确认导入" }));
    expect(await screen.findByText("Skipped external asset 0")).toBeInTheDocument();

    await act(async () => {
      setViewportHeight(620);
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => expect(panel).toHaveStyle({ maxHeight: "524px" }));
  });
});