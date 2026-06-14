import { useEffect } from "react";
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import type { MenuActionId } from "./menuIds";
import type { MenuSchemaItem, MenuSchemaNode } from "./menuSchema";

interface UseAppMenuOptions {
  items: MenuSchemaItem[];
  run: (actionId: MenuActionId) => Promise<boolean> | boolean;
}

const PREDEFINED_EDIT_MENU_ITEMS: Partial<Record<MenuActionId, "Undo" | "Redo">> = {
  "edit.undo": "Undo",
  "edit.redo": "Redo",
};

type BuiltMenuNode =
  | Awaited<ReturnType<typeof CheckMenuItem.new>>
  | Awaited<ReturnType<typeof MenuItem.new>>
  | Awaited<ReturnType<typeof PredefinedMenuItem.new>>
  | Awaited<ReturnType<typeof Submenu.new>>;

function isTauriRuntime() {
  return typeof window !== "undefined"
    && typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "object";
}

async function createLeafItem(
  item: MenuSchemaItem,
  run: (actionId: MenuActionId) => Promise<boolean> | boolean,
): Promise<BuiltMenuNode> {
  const predefinedItem = PREDEFINED_EDIT_MENU_ITEMS[item.id as MenuActionId];
  if (predefinedItem) {
    return PredefinedMenuItem.new({ item: predefinedItem, text: item.label });
  }

  const action = item.enabled === false ? undefined : () => {
    void run(item.id as MenuActionId);
  };

  if (typeof item.checked === "boolean") {
    return CheckMenuItem.new({
      id: item.id,
      text: item.label,
      enabled: item.enabled,
      checked: item.checked,
      action,
    });
  }

  return MenuItem.new({
    id: item.id,
    text: item.label,
    enabled: item.enabled,
    accelerator: item.accelerator,
    action,
  });
}

function isSeparator(item: MenuSchemaNode): item is Extract<MenuSchemaNode, { type: "separator" }> {
  return "type" in item && item.type === "separator";
}

function hasChildren(item: MenuSchemaNode): item is MenuSchemaItem & { children: MenuSchemaNode[] } {
  return "children" in item && Array.isArray(item.children);
}

async function createMenuNode(
  item: MenuSchemaNode,
  run: (actionId: MenuActionId) => Promise<boolean> | boolean,
): Promise<BuiltMenuNode> {
  if (isSeparator(item)) {
    return createSeparator();
  }

  if (hasChildren(item)) {
    return createSubmenu(item, run);
  }

  return createLeafItem(item, run);
}

async function createSubmenu(
  item: MenuSchemaItem,
  run: (actionId: MenuActionId) => Promise<boolean> | boolean,
): Promise<BuiltMenuNode> {
  const children: BuiltMenuNode[] = await Promise.all((item.children ?? []).map((child) => createMenuNode(child, run)));

  return Submenu.new({
    id: item.id,
    text: item.label,
    enabled: item.enabled,
    items: children,
  });
}

async function createSeparator(): Promise<BuiltMenuNode> {
  return PredefinedMenuItem.new({ item: "Separator" });
}

export function useAppMenu({ items, run }: UseAppMenuOptions) {
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const submenus = await Promise.all(items.map((item) => createSubmenu(item, run)));
      if (cancelled) {
        return;
      }

      const menu = await Menu.new({ items: submenus });
      if (cancelled) {
        return;
      }

      await menu.setAsAppMenu();
    })();

    return () => {
      cancelled = true;
    };
  }, [items, run]);
}