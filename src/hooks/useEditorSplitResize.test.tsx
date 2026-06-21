import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorSplitResize } from "./useEditorSplitResize";

describe("useEditorSplitResize", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("continues resizing from window-level pointermove events after the separator drag starts", () => {
    const containerRef = {
      current: {
        getBoundingClientRect: () => ({ left: 100, width: 1000 }),
      } as Pick<HTMLElement, "getBoundingClientRect"> as HTMLElement,
    } as React.RefObject<HTMLElement | null>;

    const { result } = renderHook(() => useEditorSplitResize({ containerRef }));

    act(() => {
      result.current.startResize({
        clientX: 400,
        preventDefault: vi.fn(),
        currentTarget: {
          setPointerCapture: vi.fn(),
        },
        pointerId: 1,
      } as unknown as React.PointerEvent<HTMLElement>);
    });

    expect(result.current.editorRatio).toBe(30);

    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 760 }));
    });

    expect(result.current.editorRatio).toBe(66);

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 760 }));
    });

    expect(window.localStorage.getItem("mynote.editorSplitRatio")).toBe("66");
  });
});