import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearActiveDraggedTagName,
  getActiveDraggedTagName,
  scheduleClearActiveDraggedTagName,
  setActiveDraggedTagName,
} from "./tagDragState";

describe("tagDragState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearActiveDraggedTagName();
  });

  it("keeps the dragged tag available until the next tick after drag end", () => {
    setActiveDraggedTagName("测试");

    scheduleClearActiveDraggedTagName();
    expect(getActiveDraggedTagName()).toBe("测试");

    vi.runAllTimers();
    expect(getActiveDraggedTagName()).toBeNull();
  });
});