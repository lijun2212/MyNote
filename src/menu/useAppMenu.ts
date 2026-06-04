import { useEffect } from "react";
import { CheckMenuItem, Menu, MenuItem, Submenu } from "@tauri-apps/api/menu";
import type { MenuActionId } from "./menuIds";
import type { MenuSchemaItem } from "./menuSchema";

interface UseAppMenuOptions {
  items: MenuSchemaItem[];
  run: (actionId: MenuActionId) => Promise<boolean> | boolean;
}

function isTauriRuntime() {
  return typeof window !== "undefined"
    && typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "object";
}

async function createLeafItem(
  item: MenuSchemaItem,
  run: (actionId: MenuActionId) => Promise<boolean> | boolean,
) {
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
    action,
  });
}

async function createSubmenu(
  item: MenuSchemaItem,
  run: (actionId: MenuActionId) => Promise<boolean> | boolean,
) {
  const children = await Promise.all((item.children ?? []).map((child) => createLeafItem(child, run)));

  return Submenu.new({
    id: item.id,
    text: item.label,
    enabled: item.enabled,
    items: children,
  });
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