import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "./useEditorStore";

describe("useEditorStore", () => {
  beforeEach(() => {
    useEditorStore.getState().resetSession();
  });

  it("keeps showPreview derived from viewMode after direct state updates", () => {
    useEditorStore.setState({ viewMode: "preview", showPreview: false });
    expect(useEditorStore.getState().showPreview).toBe(true);
    expect(useEditorStore.getState().getEditorMode()).toBe("split");

    useEditorStore.setState({ viewMode: "editor", showPreview: true });
    expect(useEditorStore.getState().showPreview).toBe(false);
    expect(useEditorStore.getState().getEditorMode()).toBe("editor");
  });

  it("maps preview view mode to split editor mode while preserving compatibility", () => {
    useEditorStore.getState().setViewMode("preview");

    expect(useEditorStore.getState().viewMode).toBe("preview");
    expect(useEditorStore.getState().showPreview).toBe(true);
    expect(useEditorStore.getState().getEditorMode()).toBe("split");
  });

  it("sets editor view mode without preview compatibility", () => {
    useEditorStore.getState().setViewMode("editor");

    expect(useEditorStore.getState().viewMode).toBe("editor");
    expect(useEditorStore.getState().showPreview).toBe(false);
    expect(useEditorStore.getState().getEditorMode()).toBe("editor");
  });

  it("sets split view mode with preview compatibility", () => {
    useEditorStore.getState().setViewMode("split");

    expect(useEditorStore.getState().viewMode).toBe("split");
    expect(useEditorStore.getState().showPreview).toBe(true);
    expect(useEditorStore.getState().getEditorMode()).toBe("split");
  });

  it("keeps setEditorMode compatibility mapping", () => {
    useEditorStore.getState().setEditorMode("split");

    expect(useEditorStore.getState().viewMode).toBe("split");
    expect(useEditorStore.getState().showPreview).toBe(true);
    expect(useEditorStore.getState().getEditorMode()).toBe("split");

    useEditorStore.getState().setEditorMode("editor");

    expect(useEditorStore.getState().viewMode).toBe("editor");
    expect(useEditorStore.getState().showPreview).toBe(false);
    expect(useEditorStore.getState().getEditorMode()).toBe("editor");
  });

  it("keeps togglePreview legacy compatibility semantics", () => {
    useEditorStore.getState().togglePreview();
    expect(useEditorStore.getState().viewMode).toBe("editor");
    expect(useEditorStore.getState().showPreview).toBe(false);

    useEditorStore.getState().togglePreview();
    expect(useEditorStore.getState().viewMode).toBe("split");
    expect(useEditorStore.getState().showPreview).toBe(true);

    useEditorStore.getState().setViewMode("preview");
    useEditorStore.getState().togglePreview();
    expect(useEditorStore.getState().viewMode).toBe("editor");
    expect(useEditorStore.getState().showPreview).toBe(false);
  });

  it("restores split view mode on session reset", () => {
    useEditorStore.getState().setViewMode("editor");
    useEditorStore.getState().resetSession();

    expect(useEditorStore.getState().viewMode).toBe("split");
    expect(useEditorStore.getState().showPreview).toBe(true);
    expect(useEditorStore.getState().getEditorMode()).toBe("split");
  });

  it("stores beautify review mode separately from normal preview mode", () => {
    useEditorStore.getState().setViewMode("editor");

    useEditorStore.getState().setBeautifyReview({
      originalContent: "# Old",
      beautifiedContent: "# New",
      diagnostics: [],
      summary: { errorCount: 0, warningCount: 0, autoFixableCount: 0 },
      diffMode: false,
      appliedAi: false,
      aiStatus: "not_requested",
      aiStatusDetail: null,
    });

    expect(useEditorStore.getState().beautifyReview?.beautifiedContent).toBe("# New");
    expect(useEditorStore.getState().viewMode).toBe("editor");
    expect(useEditorStore.getState().showPreview).toBe(false);
  });

  it("toggles beautify diff mode without changing normal preview state", () => {
    useEditorStore.getState().setViewMode("preview");
    useEditorStore.getState().setBeautifyReview({
      originalContent: "# Old",
      beautifiedContent: "# New",
      diagnostics: [],
      summary: { errorCount: 0, warningCount: 0, autoFixableCount: 0 },
      diffMode: false,
      appliedAi: false,
      aiStatus: "not_requested",
      aiStatusDetail: null,
    });

    useEditorStore.getState().setBeautifyDiffMode(true);

    expect(useEditorStore.getState().beautifyReview?.diffMode).toBe(true);
    expect(useEditorStore.getState().viewMode).toBe("preview");
    expect(useEditorStore.getState().showPreview).toBe(true);
  });

  it("applies beautified content, marks dirty, and clears beautify review", () => {
    useEditorStore.setState({ content: "# Old", isDirty: false, saveStatus: "saved" });
    useEditorStore.getState().setBeautifyReview({
      originalContent: "# Old",
      beautifiedContent: "# New",
      diagnostics: [],
      summary: { errorCount: 0, warningCount: 0, autoFixableCount: 0 },
      diffMode: true,
      appliedAi: false,
      aiStatus: "not_requested",
      aiStatusDetail: null,
    });

    useEditorStore.getState().applyBeautifyContent();

    expect(useEditorStore.getState().content).toBe("# New");
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().saveStatus).toBe("unsaved");
    expect(useEditorStore.getState().beautifyReview).toBeNull();
  });
});