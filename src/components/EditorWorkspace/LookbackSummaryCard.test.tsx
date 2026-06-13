import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LookbackSummaryCard } from "./LookbackSummaryCard";

describe("LookbackSummaryCard", () => {
  it("renders the summary content panel when expanded is controlled externally", () => {
    render(
      <LookbackSummaryCard
        savedSummary="已保存摘要内容"
        candidate="候选摘要内容"
        isGenerating={false}
        isSaving={false}
        error="生成失败"
        onCandidateChange={vi.fn()}
        onGenerate={vi.fn()}
        onSave={vi.fn()}
        onDeleteSummary={vi.fn()}
      />,
    );

    expect(screen.getByText("回看摘要")).toBeInTheDocument();
    expect(screen.getByText("已保存摘要内容")).toBeInTheDocument();
    expect(screen.queryByLabelText("回看摘要候选内容")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除摘要" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑摘要" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存摘要" })).not.toBeInTheDocument();
    expect(screen.getByText("生成失败")).toBeInTheDocument();
  });

  it("enters editing mode and wires candidate edits plus save", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    const onSave = vi.fn();

    function Harness() {
      const [candidate, setCandidate] = useState("已保存摘要内容");

      return (
        <LookbackSummaryCard
          savedSummary="已保存摘要内容"
          candidate={candidate}
          isGenerating={false}
          isSaving={false}
          error={null}
          onCandidateChange={setCandidate}
          onGenerate={onGenerate}
          onSave={onSave}
          onDeleteSummary={vi.fn()}
        />
      );
    }

    render(<Harness />);

    expect(screen.queryByLabelText("回看摘要候选内容")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "编辑摘要" }));

    const textarea = screen.getByLabelText("回看摘要候选内容");

    await user.clear(textarea);
    await user.type(textarea, "新的候选摘要");
    await user.click(screen.getByRole("button", { name: "保存摘要" }));

    expect(textarea).toHaveValue("新的候选摘要");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("does not allow saving empty content for a new note", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    function Harness() {
      const [candidate, setCandidate] = useState("");

      return (
        <LookbackSummaryCard
          savedSummary={null}
          candidate={candidate}
          isGenerating={false}
          isSaving={false}
          error={null}
          onCandidateChange={setCandidate}
          onGenerate={vi.fn()}
          onSave={onSave}
          onDeleteSummary={vi.fn()}
        />
      );
    }

    render(<Harness />);

    const saveButton = screen.getByRole("button", { name: "保存摘要" });
    expect(saveButton).toBeDisabled();

    await user.click(saveButton);

    expect(onSave).not.toHaveBeenCalled();
  });
});