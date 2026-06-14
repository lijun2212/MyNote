import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { StatusBar } from "./StatusBar";
import { useEditorStore } from "../store/useEditorStore";
import { makeNote } from "../test/testData";
import { tauriMocks } from "../test/setup";

describe("StatusBar", () => {
  beforeEach(() => {
    tauriMocks.listen.mockResolvedValue(() => {});
  });

  it("counts Chinese content by non-whitespace characters", () => {
    useEditorStore.getState().setCurrentNote(makeNote({ path: "notes/current.md" }));
    useEditorStore.getState().setContent("这是第一段中文内容。\n\n这里还有第二段，没有按英文空格分词。\n最后一段继续补充说明。");

    render(<StatusBar />);

    expect(screen.getByText("39 字")).toBeInTheDocument();
  });
});