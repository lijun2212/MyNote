import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "./useEditorStore";

describe("useEditorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({ showPreview: true });
  });

  it("derives editor mode from showPreview even after direct state updates", () => {
    useEditorStore.setState({ showPreview: false });
    expect(useEditorStore.getState().getEditorMode()).toBe("editor");

    useEditorStore.setState({ showPreview: true });
    expect(useEditorStore.getState().getEditorMode()).toBe("split");
  });
});