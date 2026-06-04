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
  };
});

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: menuMocks.Menu,
  MenuItem: menuMocks.MenuItem,
  CheckMenuItem: menuMocks.CheckMenuItem,
  Submenu: menuMocks.Submenu,
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
});