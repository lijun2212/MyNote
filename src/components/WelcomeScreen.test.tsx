import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeScreen } from "./WelcomeScreen";
import { tauriMocks } from "../test/setup";
import { useAppStore } from "../store/useAppStore";
import type { KnowledgeBase } from "../types";

const createKb: KnowledgeBase = {
  id: "kb-create",
  name: "Workspace",
  root_path: "C:\\Users\\lijun\\Workspace",
  created_at: "2026-06-04T00:00:00Z",
  updated_at: "2026-06-04T00:00:00Z",
};

const openKb: KnowledgeBase = {
  id: "kb-open",
  name: "Archive",
  root_path: "/Users/lijun/Archive",
  created_at: "2026-06-04T00:00:00Z",
  updated_at: "2026-06-04T00:00:00Z",
};

describe("WelcomeScreen", () => {
  beforeEach(() => {
    useAppStore.setState({
      kb: null,
      error: "existing error",
      refreshTree: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("renders the approved welcome copy and CTAs", () => {
    render(<WelcomeScreen />);

    expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
    expect(screen.getByLabelText("欢迎页场景区")).toBeInTheDocument();
    expect(screen.getByText("写给自己的笔记本")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "把日子、想法和成长，慢慢记下来" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("就像学生时代整理课本和笔记那样，熟悉、自然，不需要重新学习怎么开始。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("想到什么，就先写下来；过些时候再回来看，它们会一点点连成你的日常、你的知识，也连成你自己。"),
    ).toBeInTheDocument();
    expect(screen.getByText("随手写下此刻的生活与念头")).toBeInTheDocument();
    expect(screen.getByText("随时找回那些重要的片段")).toBeInTheDocument();
    expect(screen.getByText("让零散记录慢慢沉淀成自己的脉络")).toBeInTheDocument();
    expect(screen.getByText("MyNote 不只是帮你保存内容。")).toBeInTheDocument();
    expect(
      screen.getByText("它也陪你把每天的记录、一路的学习和长久的积累，慢慢整理成更清楚的理解，内化成真正属于你的能力。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建知识库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开知识库" })).toBeInTheDocument();
  });

  it("renders the approved welcome scene elements", () => {
    render(<WelcomeScreen />);

    expect(screen.getByTestId("welcome-note-sheet")).toBeInTheDocument();
    expect(screen.getByText("日常片段")).toBeInTheDocument();
    expect(screen.getByText("知识摘记")).toBeInTheDocument();
    expect(screen.getByText("记下")).toBeInTheDocument();
    expect(screen.getByText("整理")).toBeInTheDocument();
    expect(screen.getByText("脉络")).toBeInTheDocument();
  });

  it("creates a knowledge base, refreshes tree, stores kb, and clears stale error", async () => {
    const user = userEvent.setup();
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ refreshTree, error: "existing error" });
    tauriMocks.openDialog.mockResolvedValue("C:\\Users\\lijun\\Workspace\\");
    tauriMocks.invoke.mockResolvedValue(createKb);

    render(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: "新建知识库" }));

    await waitFor(() => {
      expect(tauriMocks.openDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
      expect(tauriMocks.invoke).toHaveBeenCalledWith("create_knowledge_base", {
        rootPath: "C:\\Users\\lijun\\Workspace\\",
        name: "Workspace",
      });
      expect(refreshTree).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().kb).toEqual(createKb);
      expect(useAppStore.getState().error).toBeNull();
    });
  });

  it("preserves refreshTree error after create succeeds", async () => {
    const user = userEvent.setup();
    const refreshTree = vi.fn().mockImplementation(async () => {
      useAppStore.getState().setError("refresh failed");
    });
    useAppStore.setState({ refreshTree, error: "existing error" });
    tauriMocks.openDialog.mockResolvedValue("C:\\Users\\lijun\\Workspace\\");
    tauriMocks.invoke.mockResolvedValue(createKb);

    render(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: "新建知识库" }));

    await waitFor(() => {
      expect(refreshTree).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().error).toBe("refresh failed");
    });
  });

  it("does not invoke api when create dialog is cancelled", async () => {
    const user = userEvent.setup();
    tauriMocks.openDialog.mockResolvedValue(null);

    render(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: "新建知识库" }));

    await waitFor(() => {
      expect(tauriMocks.openDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
      expect(tauriMocks.invoke).not.toHaveBeenCalled();
    });
  });

  it("stores error when create dialog throws", async () => {
    const user = userEvent.setup();
    tauriMocks.openDialog.mockRejectedValue(new Error("dialog failed"));

    render(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: "新建知识库" }));

    await waitFor(() => {
      expect(useAppStore.getState().error).toBe("Error: dialog failed");
      expect(tauriMocks.invoke).not.toHaveBeenCalled();
    });
  });

  it("opens a knowledge base, refreshes tree, stores kb, and clears stale error", async () => {
    const user = userEvent.setup();
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ refreshTree, error: "existing error" });
    tauriMocks.openDialog.mockResolvedValue("/Users/lijun/Archive");
    tauriMocks.invoke.mockResolvedValue(openKb);

    render(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: "打开知识库" }));

    await waitFor(() => {
      expect(tauriMocks.openDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
      expect(tauriMocks.invoke).toHaveBeenCalledWith("open_knowledge_base", {
        rootPath: "/Users/lijun/Archive",
      });
      expect(refreshTree).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().kb).toEqual(openKb);
      expect(useAppStore.getState().error).toBeNull();
    });
  });
});