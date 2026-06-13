import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { useProjectionStore } from "../store/useProjectionStore";

const projectionWindowApiMocks = vi.hoisted(() => ({
  openProjectionWindow: vi.fn(),
  closeProjectionWindow: vi.fn().mockResolvedValue(undefined),
}));

const capturedUseAppMenu = vi.hoisted(() => vi.fn());

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
    useProjectionStore.getState().resetForTest();
    projectionWindowApiMocks.openProjectionWindow.mockReset();
    projectionWindowApiMocks.closeProjectionWindow.mockReset();
    projectionWindowApiMocks.closeProjectionWindow.mockResolvedValue(undefined);
    capturedUseAppMenu.mockReset();
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
});