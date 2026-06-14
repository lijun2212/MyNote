import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AboutDialog } from "./AboutDialog";

describe("AboutDialog", () => {
  it("renders the approved about content", () => {
    render(<AboutDialog open onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "关于 MyNote" })).toBeInTheDocument();
    expect(screen.getByText("MyNote")).toBeInTheDocument();
    expect(screen.getByText("版本 0.1.0")).toBeInTheDocument();
    expect(screen.getByText("本地优先的个人知识库与笔记应用")).toBeInTheDocument();
    expect(screen.getByText("帮助用户记录、整理并沉淀自己的知识与日常")).toBeInTheDocument();
    expect(screen.getByText("个人开发者 LJ")).toBeInTheDocument();
    expect(screen.getByText("2026 年 6 月")).toBeInTheDocument();
    expect(screen.getByText("Copyright © 2026 LJ. All rights reserved.")).toBeInTheDocument();
  });

  it("closes via close button, overlay click, and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { rerender } = render(<AboutDialog open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "关闭关于弹窗" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.click(screen.getByTestId("about-dialog-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<AboutDialog open onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when closed", () => {
    render(<AboutDialog open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog", { name: "关于 MyNote" })).not.toBeInTheDocument();
  });
});