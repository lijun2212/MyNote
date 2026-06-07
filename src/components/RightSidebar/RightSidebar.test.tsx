import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { RightSidebar } from "./RightSidebar";
import { useEditorStore } from "../../store/useEditorStore";

describe("RightSidebar", () => {
  beforeEach(() => {
    useEditorStore.setState({ currentNote: null });
  });

  it("shows the outline panel by default", () => {
    render(<RightSidebar />);

    expect(screen.getByText("打开笔记后显示大纲")).toBeInTheDocument();
  });

  it("uses 关联 as the unified knowledge association tab", async () => {
    const user = userEvent.setup();

    render(<RightSidebar />);

    expect(screen.getByText("打开笔记后显示大纲")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关联" }));

    expect(screen.getByText("选择笔记以查看关联")).toBeInTheDocument();
  });

  it("renders the 图谱分析 tab and switches to the graph panel", async () => {
    const user = userEvent.setup();

    render(<RightSidebar />);

    await user.click(screen.getByRole("button", { name: "图谱分析" }));

    expect(screen.getByText("打开笔记后显示图谱分析")).toBeInTheDocument();
  });
});