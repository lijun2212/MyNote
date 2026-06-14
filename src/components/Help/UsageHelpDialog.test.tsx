import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UsageHelpDialog } from "./UsageHelpDialog";

describe("UsageHelpDialog", () => {
  it("renders the usage help title, revision history, and table of contents links", () => {
    render(<UsageHelpDialog open onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "使用帮助" });

    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "使用帮助" })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "修订记录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "目录" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "开始使用" })).toHaveAttribute("href", "#getting-started");
    expect(screen.getByRole("link", { name: "界面布局" })).toHaveAttribute("href", "#interface-layout");
    expect(screen.getByText("首次使用建议按下面顺序操作：")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("顶部栏");
    expect(dialog).toHaveTextContent("左侧栏");
    expect(dialog).toHaveTextContent("右侧栏");
    expect(dialog).toHaveTextContent("状态栏");
    expect(dialog).toHaveTextContent("复制链接：先打开或选中要被引用的那篇笔记");
    expect(dialog).toHaveTextContent("复制 Wiki 链接：先打开或选中要被引用的那篇笔记");
    expect(dialog).toHaveTextContent("复制到剪贴板的是双链文本");
    expect(dialog).toHaveTextContent("右侧隐藏侧栏中的“关联”区域查看相关关系");
  });

  it("closes via close button, overlay click, and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { rerender } = render(<UsageHelpDialog open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "关闭使用帮助弹窗" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.click(screen.getByTestId("usage-help-dialog-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<UsageHelpDialog open onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when closed", () => {
    render(<UsageHelpDialog open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog", { name: "使用帮助" })).not.toBeInTheDocument();
  });
});