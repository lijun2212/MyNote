import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchSessionBar } from "./SearchSessionBar";

describe("SearchSessionBar", () => {
  it("renders the session query, count, and triggers button callbacks", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onExit = vi.fn();

    render(
      <SearchSessionBar
        query="alpha"
        currentIndex={1}
        total={17}
        onPrevious={onPrevious}
        onNext={onNext}
        onExit={onExit}
      />,
    );

    expect(screen.getByText("搜索会话：alpha")).toBeInTheDocument();
    expect(screen.getByText("2 / 17")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "上一个命中" }));
    fireEvent.click(screen.getByRole("button", { name: "下一个命中" }));
    fireEvent.click(screen.getByRole("button", { name: "退出搜索会话" }));

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});