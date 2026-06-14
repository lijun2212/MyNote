import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShortcutsDialog } from "./ShortcutsDialog";

describe("ShortcutsDialog", () => {
  it("renders the approved sections and shortcut copy", () => {
    render(<ShortcutsDialog open onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "快捷键" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "全局" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "编辑与布局" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "笔记链接与关联" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "搜索" })).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    expect(screen.getByText("⌘V")).toBeInTheDocument();
    expect(screen.getByText("⌘L")).toBeInTheDocument();
    expect(screen.getByText("⌘⇧W")).toBeInTheDocument();
    expect(screen.getByText("复制当前笔记链接")).toBeInTheDocument();
    expect(screen.getByText("复制当前笔记 Wiki 链接")) .toBeInTheDocument();
    expect(screen.getAllByText("Esc").length).toBeGreaterThan(0);
    expect(screen.getAllByText("菜单切换")).toHaveLength(2);
  });

  it("closes via close button, overlay click, and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { rerender } = render(<ShortcutsDialog open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "关闭快捷键弹窗" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.click(screen.getByTestId("shortcuts-dialog-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<ShortcutsDialog open onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when closed", () => {
    render(<ShortcutsDialog open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog", { name: "快捷键" })).not.toBeInTheDocument();
  });
});