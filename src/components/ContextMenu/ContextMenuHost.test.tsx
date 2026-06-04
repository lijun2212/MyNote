import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextMenuHost } from "./ContextMenuHost";
import { ContextMenuProvider, useContextMenu } from "./useContextMenu";

describe("ContextMenuHost", () => {
  it("invokes enabled item handlers through the shared action runner", async () => {
    const user = userEvent.setup();
    const openSpy = vi.fn();

    function Harness() {
      const { openContextMenu } = useContextMenu();

      return (
        <>
          <button
            type="button"
            onClick={() => {
              openContextMenu({
                position: { x: 32, y: 48 },
                payload: {
                  type: "note",
                  noteId: "note-1",
                  noteTitle: "案例",
                  path: "notes/案例.md",
                  handlers: {
                    open: openSpy,
                  },
                },
              });
            }}
          >
            打开菜单
          </button>
          <ContextMenuHost />
        </>
      );
    }

    render(
      <ContextMenuProvider>
        <Harness />
      </ContextMenuProvider>,
    );

    await user.click(screen.getByRole("button", { name: "打开菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "打开笔记" }));

    expect(openSpy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("marks disabled items with aria-disabled", async () => {
    const user = userEvent.setup();

    function Harness() {
      const { openContextMenu } = useContextMenu();

      return (
        <>
          <button
            type="button"
            onClick={() => {
              openContextMenu({
                position: { x: 32, y: 48 },
                payload: {
                  type: "note",
                  noteId: "note-1",
                  noteTitle: "案例",
                  path: "notes/案例.md",
                  handlers: {
                    open: vi.fn(),
                    copyLink: vi.fn(),
                  },
                },
              });
            }}
          >
            打开菜单
          </button>
          <ContextMenuHost />
        </>
      );
    }

    render(
      <ContextMenuProvider>
        <Harness />
      </ContextMenuProvider>,
    );

    await user.click(screen.getByRole("button", { name: "打开菜单" }));

    expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "复制链接" })).toHaveAttribute("aria-disabled", "false");
  });

  it("closes the menu when Escape is pressed", async () => {
    const user = userEvent.setup();

    function Harness() {
      const { openContextMenu } = useContextMenu();

      return (
        <>
          <button
            type="button"
            onClick={() => {
              openContextMenu({
                position: { x: 32, y: 48 },
                payload: {
                  type: "note",
                  noteId: "note-1",
                  noteTitle: "案例",
                  path: "notes/案例.md",
                  handlers: {
                    open: vi.fn(),
                  },
                },
              });
            }}
          >
            打开菜单
          </button>
          <ContextMenuHost />
        </>
      );
    }

    render(
      <ContextMenuProvider>
        <Harness />
      </ContextMenuProvider>,
    );

    await user.click(screen.getByRole("button", { name: "打开菜单" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the menu when clicking outside of it", async () => {
    const user = userEvent.setup();

    function Harness() {
      const { openContextMenu } = useContextMenu();

      return (
        <>
          <button
            type="button"
            onClick={() => {
              openContextMenu({
                position: { x: 32, y: 48 },
                payload: {
                  type: "note",
                  noteId: "note-1",
                  noteTitle: "案例",
                  path: "notes/案例.md",
                  handlers: {
                    open: vi.fn(),
                  },
                },
              });
            }}
          >
            打开菜单
          </button>
          <button type="button">外部区域</button>
          <ContextMenuHost />
        </>
      );
    }

    render(
      <ContextMenuProvider>
        <Harness />
      </ContextMenuProvider>,
    );

    await user.click(screen.getByRole("button", { name: "打开菜单" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "外部区域" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("repositions the menu inside the viewport using its measured size", async () => {
    const user = userEvent.setup();
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.classList?.contains("context-menu")) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 220,
          bottom: 120,
          width: 220,
          height: 120,
          toJSON: () => ({}),
        } as DOMRect;
      }

      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });

    function Harness() {
      const { openContextMenu } = useContextMenu();

      return (
        <>
          <button
            type="button"
            onClick={() => {
              openContextMenu({
                position: { x: 290, y: 190 },
                payload: {
                  type: "note",
                  noteId: "note-1",
                  noteTitle: "案例",
                  path: "notes/案例.md",
                  handlers: {
                    open: vi.fn(),
                  },
                },
              });
            }}
          >
            打开菜单
          </button>
          <ContextMenuHost />
        </>
      );
    }

    render(
      <ContextMenuProvider>
        <Harness />
      </ContextMenuProvider>,
    );

    await user.click(screen.getByRole("button", { name: "打开菜单" }));

    const menu = await screen.findByRole("menu");

    await vi.waitFor(() => {
      expect(menu).toHaveStyle({ left: "68px", top: "68px" });
    });

    rectSpy.mockRestore();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
  });
});