import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppMenu } from "./useAppMenu";

const menuMocks = vi.hoisted(() => {
  const createdMenus: MenuInstance[] = [];

  class MockMenuItem {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
    }

    static async new(options: Record<string, unknown>) {
      return new MockMenuItem(options);
    }
  }

  class MockCheckMenuItem extends MockMenuItem {
    static async new(options: Record<string, unknown>) {
      return new MockCheckMenuItem(options);
    }
  }

  class MockSubmenu extends MockMenuItem {
    static async new(options: Record<string, unknown>) {
      return new MockSubmenu(options);
    }
  }

  class MockPredefinedMenuItem extends MockMenuItem {
    static async new(options: Record<string, unknown>) {
      return new MockPredefinedMenuItem(options);
    }
  }

  type MenuInstance = {
    options: Record<string, unknown>;
    setAsAppMenu: ReturnType<typeof vi.fn>;
  };

  return {
    createdMenus,
    Menu: {
      new: vi.fn(async (options: Record<string, unknown>) => {
        const instance: MenuInstance = {
          options,
          setAsAppMenu: vi.fn(async () => null),
        };
        createdMenus.push(instance);
        return instance;
      }),
    },
    MenuItem: MockMenuItem,
    CheckMenuItem: MockCheckMenuItem,
    Submenu: MockSubmenu,
    PredefinedMenuItem: MockPredefinedMenuItem,
  };
});

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: menuMocks.Menu,
  MenuItem: menuMocks.MenuItem,
  CheckMenuItem: menuMocks.CheckMenuItem,
  Submenu: menuMocks.Submenu,
  PredefinedMenuItem: menuMocks.PredefinedMenuItem,
}));

describe("useAppMenu", () => {
  beforeEach(() => {
    menuMocks.createdMenus.length = 0;
    menuMocks.Menu.new.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("creates an app menu from the shared schema and sets it as the app menu", async () => {
    const run = vi.fn(async () => true);

    renderHook(() =>
      useAppMenu({
        items: [
          {
            id: "view",
            label: "视图",
            children: [
              { id: "view.search", label: "搜索", enabled: true },
              { id: "view.editorOnly", label: "仅编辑器", enabled: true, checked: true },
            ],
          },
        ],
        run,
      }),
    );

    await vi.waitFor(() => {
      expect(menuMocks.Menu.new).toHaveBeenCalledTimes(1);
      expect(menuMocks.createdMenus[0]?.setAsAppMenu).toHaveBeenCalledTimes(1);
    });

    const [rootMenuArg] = menuMocks.Menu.new.mock.calls[0] ?? [];
    const submenus = (rootMenuArg?.items ?? []) as Array<{ options: { items?: Array<{ options: Record<string, unknown> }> } }>;
    const childItems = submenus[0]?.options.items ?? [];
    const action = childItems[0]?.options.action as ((id: string) => Promise<void> | void) | undefined;

    expect(submenus).toHaveLength(1);
    expect(childItems[0]?.options.id).toBe("view.search");
    expect(childItems[0]?.options.action).toEqual(expect.any(Function));
    expect(childItems[1]?.options.id).toBe("view.editorOnly");
    expect(childItems[1]?.options.checked).toBe(true);

    await act(async () => {
      await action?.("view.search");
    });
    expect(run).toHaveBeenCalledWith("view.search");
  });

  it("rebuilds the app menu when the schema changes", async () => {
    const run = vi.fn(async () => true);

    const { rerender } = renderHook(
      ({ checked }) =>
        useAppMenu({
          items: [
            {
              id: "view",
              label: "视图",
              children: [{ id: "view.split", label: "分栏编辑", enabled: true, checked }],
            },
          ],
          run,
        }),
      { initialProps: { checked: false } },
    );

    await vi.waitFor(() => {
      expect(menuMocks.createdMenus[0]?.setAsAppMenu).toHaveBeenCalledTimes(1);
    });

    rerender({ checked: true });

    await vi.waitFor(() => {
      expect(menuMocks.Menu.new).toHaveBeenCalledTimes(2);
      expect(menuMocks.createdMenus[1]?.setAsAppMenu).toHaveBeenCalledTimes(1);
    });
  });

  it("rebuilds the app menu when the action context callback changes", async () => {
    const items = [
      {
        id: "view" as const,
        label: "视图",
        children: [{ id: "view.search" as const, label: "搜索", enabled: true }],
      },
    ];

    const { rerender } = renderHook(
      ({ run }) =>
        useAppMenu({
          items,
          run,
        }),
      { initialProps: { run: vi.fn(async () => true) } },
    );

    await vi.waitFor(() => {
      expect(menuMocks.Menu.new).toHaveBeenCalledTimes(1);
    });

    rerender({ run: vi.fn(async () => true) });

    await vi.waitFor(() => {
      expect(menuMocks.Menu.new).toHaveBeenCalledTimes(2);
    });
  });

  it("does not bind actions for disabled placeholder items", async () => {
    const run = vi.fn(async () => true);

    renderHook(() =>
      useAppMenu({
        items: [
          {
            id: "view",
            label: "视图",
            children: [{ id: "view.graph", label: "知识图谱", enabled: false }],
          },
        ],
        run,
      }),
    );

    await vi.waitFor(() => {
      expect(menuMocks.createdMenus[menuMocks.createdMenus.length - 1]?.setAsAppMenu).toHaveBeenCalledTimes(1);
    });

    const lastCall = menuMocks.Menu.new.mock.calls[menuMocks.Menu.new.mock.calls.length - 1];
    const [rootMenuArg] = lastCall ?? [];
    const submenus = (rootMenuArg?.items ?? []) as Array<{ options: { items?: Array<{ options: Record<string, unknown> }> } }>;
    const childItems = submenus[0]?.options.items ?? [];

    expect(childItems[0]?.options.enabled).toBe(false);
    expect(childItems[0]?.options.action).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it("passes accelerators through to custom menu items", async () => {
    const run = vi.fn(async () => true);

    renderHook(() =>
      useAppMenu({
        items: [
          {
            id: "edit",
            label: "编辑",
            children: [
              { id: "edit.copyLink", label: "复制链接", enabled: true, accelerator: "Cmd+L" },
              { id: "note.copyWikiLink", label: "复制 Wiki 链接", enabled: true, accelerator: "Cmd+Shift+W" },
            ],
          },
        ],
        run,
      }),
    );

    await vi.waitFor(() => {
      expect(menuMocks.createdMenus[menuMocks.createdMenus.length - 1]?.setAsAppMenu).toHaveBeenCalledTimes(1);
    });

    const lastCall = menuMocks.Menu.new.mock.calls[menuMocks.Menu.new.mock.calls.length - 1];
    const [rootMenuArg] = lastCall ?? [];
    const submenus = (rootMenuArg?.items ?? []) as Array<{ options: { items?: Array<{ options: Record<string, unknown> }> } }>;
    const childItems = submenus[0]?.options.items ?? [];

    expect(childItems[0]?.options.accelerator).toBe("Cmd+L");
    expect(childItems[1]?.options.accelerator).toBe("Cmd+Shift+W");
  });

  it("renders nested submenus and explicit separators from the schema", async () => {
    const run = vi.fn(async () => true);

    renderHook(() =>
      useAppMenu({
        items: [
          {
            id: "mynote",
            label: "MyNote",
            children: [
              { id: "file.newNote", label: "新建笔记", enabled: true },
              { id: "mynote.separator", type: "separator" },
              {
                id: "mynote.ai",
                label: "AI 设置",
                children: [
                  { id: "ai.settings", label: "打开 AI 设置", enabled: true },
                  { id: "ai.toggleAutoSummaryAgent", label: "启用自动摘要", enabled: true, checked: true },
                ],
              },
            ],
          },
        ],
        run,
      }),
    );

    await vi.waitFor(() => {
      expect(menuMocks.createdMenus[menuMocks.createdMenus.length - 1]?.setAsAppMenu).toHaveBeenCalledTimes(1);
    });

    const lastCall = menuMocks.Menu.new.mock.calls[menuMocks.Menu.new.mock.calls.length - 1];
    const [rootMenuArg] = lastCall ?? [];
    const submenus = (rootMenuArg?.items ?? []) as Array<{ options: { items?: Array<{ options: Record<string, unknown> }> } }>;
    const childItems = submenus[0]?.options.items ?? [];

    expect(childItems).toHaveLength(3);
    expect(childItems[0]).toBeInstanceOf(menuMocks.MenuItem);
    expect(childItems[1]).toBeInstanceOf(menuMocks.PredefinedMenuItem);
    expect(childItems[1]?.options.item).toBe("Separator");
    expect(childItems[2]).toBeInstanceOf(menuMocks.Submenu);
    expect(childItems[2]?.options.text).toBe("AI 设置");

    const nestedItems = (childItems[2]?.options.items ?? []) as Array<{ options: Record<string, unknown> }>;
    expect(nestedItems.map((item) => item.options.id)).toEqual([
      "ai.settings",
      "ai.toggleAutoSummaryAgent",
    ]);
    expect(nestedItems[1]).toBeInstanceOf(menuMocks.CheckMenuItem);
    expect(nestedItems[1]?.options.checked).toBe(true);
  });

  it("renders native undo and redo while keeping custom edit actions", async () => {
    const run = vi.fn(async () => true);

    renderHook(() =>
      useAppMenu({
        items: [
          {
            id: "edit",
            label: "编辑",
            children: [
              { id: "edit.rename", label: "重命名", enabled: true },
              { id: "edit.move", label: "移动", enabled: true },
              { id: "edit.copyLink", label: "复制链接", enabled: true },
              { id: "edit.undo", label: "撤销", enabled: true },
              { id: "edit.redo", label: "重做", enabled: true },
            ],
          },
        ],
        run,
      }),
    );

    await vi.waitFor(() => {
      expect(menuMocks.createdMenus[menuMocks.createdMenus.length - 1]?.setAsAppMenu).toHaveBeenCalledTimes(1);
    });

    const lastCall = menuMocks.Menu.new.mock.calls[menuMocks.Menu.new.mock.calls.length - 1];
    const [rootMenuArg] = lastCall ?? [];
    const submenus = (rootMenuArg?.items ?? []) as Array<{ options: { items?: Array<{ options: Record<string, unknown> }> } }>;
    const childItems = submenus[0]?.options.items ?? [];

    expect(childItems).toHaveLength(5);
    expect(childItems[0]).toBeInstanceOf(menuMocks.MenuItem);
    expect(childItems[0]?.options.id).toBe("edit.rename");
    expect(childItems[1]).toBeInstanceOf(menuMocks.MenuItem);
    expect(childItems[1]?.options.id).toBe("edit.move");
    expect(childItems[2]).toBeInstanceOf(menuMocks.MenuItem);
    expect(childItems[2]?.options.id).toBe("edit.copyLink");
    expect(childItems[3]).toBeInstanceOf(menuMocks.PredefinedMenuItem);
    expect(childItems[3]?.options.item).toBe("Undo");
    expect(childItems[4]).toBeInstanceOf(menuMocks.PredefinedMenuItem);
    expect(childItems[4]?.options.item).toBe("Redo");
  });
});