import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { useProjectionStore } from "../store/useProjectionStore";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";
import { tauriMocks } from "../test/setup";
import type { KnowledgeBase, Note } from "../types";

const openKb: KnowledgeBase = {
  id: "kb-open",
  name: "Archive",
  root_path: "/Users/lijun/Archive",
  created_at: "2026-06-13T00:00:00Z",
  updated_at: "2026-06-13T00:00:00Z",
};

const currentNote: Note = {
  id: "note-1",
  path: "notes/current.md",
  title: "Current",
  summary: null,
  content_hash: "hash-1",
  word_count: 10,
  created_at: "2026-06-13T00:00:00Z",
  updated_at: "2026-06-13T00:00:00Z",
  indexed_at: "2026-06-13T00:00:00Z",
  deleted_at: null,
};

const projectionWindowApiMocks = vi.hoisted(() => ({
  openProjectionWindow: vi.fn(),
  closeProjectionWindow: vi.fn().mockResolvedValue(undefined),
}));

const capturedUseAppMenu = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: clipboardWriteTextMock,
  },
});

vi.mock("../projection/windowApi", () => ({
  openProjectionWindow: projectionWindowApiMocks.openProjectionWindow,
  closeProjectionWindow: projectionWindowApiMocks.closeProjectionWindow,
}));

vi.mock("./AppHeader", () => ({ AppHeader: () => <div data-testid="app-header" /> }));
vi.mock("./StatusBar", () => ({ StatusBar: () => <div data-testid="status-bar" /> }));
vi.mock("./LeftSidebar/LeftSidebar", () => ({ LeftSidebar: () => <div data-testid="left-sidebar" /> }));
vi.mock("./EditorWorkspace/EditorWorkspace", () => ({ EditorWorkspace: () => <div data-testid="editor-workspace" /> }));
vi.mock("./RightSidebar/RightSidebar", () => ({ RightSidebar: () => <div data-testid="right-sidebar" /> }));
vi.mock("./ContextMenu/ContextMenuHost", () => ({ ContextMenuHost: () => <div data-testid="context-menu-host" /> }));
vi.mock("./ContextMenu/useContextMenu", () => ({ ContextMenuProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./Settings/AiSettingsDialog", () => ({ AiSettingsDialog: () => null }));
vi.mock("../hooks/useProjectionLifecycle", () => ({ useProjectionLifecycle: () => undefined }));
vi.mock("../hooks/useRefreshNoteTree", () => ({ useRefreshNoteTree: () => vi.fn().mockResolvedValue(undefined) }));
vi.mock("../hooks/useSidebarResize", () => ({
  useSidebarResize: ({ defaultWidth, defaultVisible }: { defaultWidth: number; defaultVisible: boolean }) => ({
    width: defaultWidth,
    isVisible: defaultVisible,
    handleMouseDown: vi.fn(),
    toggleVisible: vi.fn(),
  }),
}));
vi.mock("../menu/useAppMenu", () => ({
  useAppMenu: (options: unknown) => capturedUseAppMenu(options),
}));

describe("AppShell", () => {
  beforeEach(() => {
    useAppStore.setState({
      kb: openKb,
      tree: [{ id: "n1", name: "Current", path: "notes/current.md", is_dir: false, children: [] }],
      selectedNodePath: "notes/current.md",
      activeTagContext: { tag_id: "tag-1", tag_name: "项目", total_notes: 1, visible_count: 1, has_more: false, items: [] },
      selectedTagIds: ["tag-1"],
      error: null,
    });
    useEditorStore.setState({
      currentNote,
      content: "hello",
      isDirty: true,
      isSaving: true,
      saveError: "save failed",
      saveStatus: "error",
      searchNavigationTarget: {
        note_id: "note-1",
        note_path: "notes/current.md",
        note_title: "Current",
        line_start: 1,
        line_end: 1,
        occurrence_order: 0,
        match_text: "Current",
        source: "body",
        context_snippet: "hello",
        revision: 1,
      },
      tagNavigationTarget: {
        note_id: "note-1",
        note_path: "notes/current.md",
        note_title: "Current",
        note_updated_at: "2026-06-13T00:00:00Z",
        source: "inline",
        occurrence_order: 0,
        line_start: 1,
        line_end: 1,
        heading_context: null,
        context_snippet: "test",
        tag_name: "项目",
        revision: 1,
      },
      openingNotePath: "notes/current.md",
      isOpeningNote: true,
      statusNotice: "working",
    });
    useProjectionStore.getState().resetForTest();
    projectionWindowApiMocks.openProjectionWindow.mockReset();
    projectionWindowApiMocks.closeProjectionWindow.mockReset();
    projectionWindowApiMocks.closeProjectionWindow.mockResolvedValue(undefined);
    capturedUseAppMenu.mockReset();
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    tauriMocks.openDialog.mockReset();
    tauriMocks.invoke.mockReset();
  });

  it("rolls back projection session state when opening projection from the app menu fails", async () => {
    projectionWindowApiMocks.openProjectionWindow.mockRejectedValue(new Error("窗口创建失败"));

    render(<AppShell />);

    const useAppMenuCall = capturedUseAppMenu.mock.calls[capturedUseAppMenu.mock.calls.length - 1]?.[0] as { run: (actionId: string) => boolean | Promise<boolean> };
    await useAppMenuCall.run("view.openProjection");

    expect(projectionWindowApiMocks.openProjectionWindow).toHaveBeenCalledTimes(1);
    expect(useProjectionStore.getState()).toMatchObject({
      projectionSessionRequested: false,
      projectionEnabled: false,
      projectionWindowReady: false,
      projectionLastError: "窗口创建失败",
    });
  });

  it("opens projection preview with the current note title as the window title", async () => {
    render(<AppShell />);

    const useAppMenuCall = capturedUseAppMenu.mock.calls[capturedUseAppMenu.mock.calls.length - 1]?.[0] as { run: (actionId: string) => boolean | Promise<boolean> };
    await act(async () => {
      await useAppMenuCall.run("view.openProjection");
    });

    expect(projectionWindowApiMocks.openProjectionWindow).toHaveBeenCalledWith("Current");
  });

  it("opens a knowledge base from the MyNote menu action", async () => {
    tauriMocks.openDialog.mockResolvedValue("/Users/lijun/Archive");
    tauriMocks.invoke.mockResolvedValue(openKb);

    render(<AppShell />);

    const useAppMenuCall = capturedUseAppMenu.mock.calls[capturedUseAppMenu.mock.calls.length - 1]?.[0] as { run: (actionId: string) => boolean | Promise<boolean> };
    await act(async () => {
      await useAppMenuCall.run("kb.open");
    });

    await waitFor(() => {
      expect(tauriMocks.openDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
      expect(tauriMocks.invoke).toHaveBeenCalledWith("open_knowledge_base", { rootPath: "/Users/lijun/Archive" });
      expect(useAppStore.getState().kb).toEqual(openKb);
    });
  });

  it("closes the current knowledge base and clears note-scoped state", async () => {
    render(<AppShell />);

    const useAppMenuCall = capturedUseAppMenu.mock.calls[capturedUseAppMenu.mock.calls.length - 1]?.[0] as { run: (actionId: string) => boolean | Promise<boolean> };
    await act(async () => {
      await useAppMenuCall.run("kb.close");
    });

    expect(useAppStore.getState()).toMatchObject({
      kb: null,
      tree: [],
      selectedNodePath: null,
      activeTagContext: null,
      selectedTagIds: [],
    });
    expect(useEditorStore.getState()).toMatchObject({
      currentNote: null,
      content: "",
      isDirty: false,
      isSaving: false,
      saveError: null,
      saveStatus: "saved",
      searchNavigationTarget: null,
      tagNavigationTarget: null,
      openingNotePath: null,
      isOpeningNote: false,
      statusNotice: null,
    });
  });

  it("opens the shortcuts dialog from the Help menu action", async () => {
    render(<AppShell />);

    const useAppMenuCall = capturedUseAppMenu.mock.calls[capturedUseAppMenu.mock.calls.length - 1]?.[0] as { run: (actionId: string) => boolean | Promise<boolean> };
    await act(async () => {
      await useAppMenuCall.run("help.shortcuts");
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "快捷键" })).toBeInTheDocument();
    });
  });

  it("opens the 使用帮助 dialog from the Help menu action and allows closing it", async () => {
    render(<AppShell />);

    const useAppMenuCall = capturedUseAppMenu.mock.calls[capturedUseAppMenu.mock.calls.length - 1]?.[0] as { run: (actionId: string) => boolean | Promise<boolean> };
    await act(async () => {
      await useAppMenuCall.run("help.manual");
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "使用帮助" })).toBeInTheDocument();
    });

    await act(async () => {
      screen.getByRole("button", { name: "关闭使用帮助弹窗" }).click();
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "使用帮助" })).not.toBeInTheDocument();
    });
  });

  it("opens the about dialog from the Help menu action", async () => {
    render(<AppShell />);

    const useAppMenuCall = capturedUseAppMenu.mock.calls[capturedUseAppMenu.mock.calls.length - 1]?.[0] as { run: (actionId: string) => boolean | Promise<boolean> };
    await act(async () => {
      await useAppMenuCall.run("help.about");
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "关于 MyNote" })).toBeInTheDocument();
    });
  });

  it("shows a status notice after copying the current note path from the Edit menu", async () => {
    vi.doUnmock("./StatusBar");
    render(<AppShell />);

    const useAppMenuCall = capturedUseAppMenu.mock.calls[capturedUseAppMenu.mock.calls.length - 1]?.[0] as { run: (actionId: string) => boolean | Promise<boolean> };
    await act(async () => {
      await useAppMenuCall.run("edit.copyLink");
    });

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("notes/current.md");
    expect(useEditorStore.getState().statusNotice).toBe("已复制笔记链接");
  });

  it("shows a status notice after copying the current note wiki link from the Edit menu", async () => {
    vi.doUnmock("./StatusBar");
    render(<AppShell />);

    const useAppMenuCall = capturedUseAppMenu.mock.calls[capturedUseAppMenu.mock.calls.length - 1]?.[0] as { run: (actionId: string) => boolean | Promise<boolean> };
    await act(async () => {
      await useAppMenuCall.run("note.copyWikiLink");
    });

    expect(clipboardWriteTextMock).toHaveBeenCalledWith("[[Current]]");
    expect(useEditorStore.getState().statusNotice).toBe("已复制 Wiki 链接");
  });

  it("auto clears the copy notice after copying the current note wiki link", async () => {
    vi.useFakeTimers();
    vi.doUnmock("./StatusBar");
    render(<AppShell />);

    const useAppMenuCall = capturedUseAppMenu.mock.calls[capturedUseAppMenu.mock.calls.length - 1]?.[0] as { run: (actionId: string) => boolean | Promise<boolean> };
    await act(async () => {
      await useAppMenuCall.run("note.copyWikiLink");
    });

    expect(useEditorStore.getState().statusNotice).toBe("已复制 Wiki 链接");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(useEditorStore.getState().statusNotice).toBeNull();
  });
});