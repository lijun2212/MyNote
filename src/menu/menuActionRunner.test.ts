import { describe, expect, it, vi } from "vitest";
import { MENU_ACTION_IDS } from "./menuIds";
import { createMenuActionRunner } from "./menuActionRunner";

function createHandlers() {
  return {
    createNote: vi.fn().mockResolvedValue(undefined),
    createNotebook: vi.fn().mockResolvedValue(undefined),
    importNote: vi.fn().mockResolvedValue(undefined),
    refreshFileTree: vi.fn().mockResolvedValue(undefined),
    openSearch: vi.fn().mockResolvedValue(undefined),
    openAiSettings: vi.fn().mockResolvedValue(undefined),
    testAiConnection: vi.fn().mockResolvedValue(undefined),
    toggleAutoSummaryAgent: vi.fn().mockResolvedValue(undefined),
    openProjection: vi.fn().mockResolvedValue(undefined),
    closeProjection: vi.fn().mockResolvedValue(undefined),
    toggleProjectionFollowScroll: vi.fn().mockResolvedValue(undefined),
    toggleLeftSidebar: vi.fn().mockResolvedValue(undefined),
    toggleRightSidebar: vi.fn().mockResolvedValue(undefined),
    setEditorMode: vi.fn().mockResolvedValue(undefined),
    openCurrentNote: vi.fn().mockResolvedValue(undefined),
    moveCurrentNote: vi.fn().mockResolvedValue(undefined),
    renameCurrentNote: vi.fn().mockResolvedValue(undefined),
    deleteCurrentNote: vi.fn().mockResolvedValue(undefined),
    copyCurrentNoteLink: vi.fn().mockResolvedValue(undefined),
    copyCurrentNoteWikiLink: vi.fn().mockResolvedValue(undefined),
    createNoteInNotebook: vi.fn().mockResolvedValue(undefined),
    renameNotebook: vi.fn().mockResolvedValue(undefined),
    reorderNotebook: vi.fn().mockResolvedValue(undefined),
    deleteNotebook: vi.fn().mockResolvedValue(undefined),
    deleteTag: vi.fn().mockResolvedValue(undefined),
    pasteFromSelection: vi.fn().mockResolvedValue(undefined),
    insertLinkFromSelection: vi.fn().mockResolvedValue(undefined),
    insertImageFromSelection: vi.fn().mockResolvedValue(undefined),
    insertTagFromSelection: vi.fn().mockResolvedValue(undefined),
    createWikiLinkFromSelection: vi.fn().mockResolvedValue(undefined),
    pasteFromBlank: vi.fn().mockResolvedValue(undefined),
    insertLinkFromBlank: vi.fn().mockResolvedValue(undefined),
    insertImageFromBlank: vi.fn().mockResolvedValue(undefined),
    createWikiLinkFromBlank: vi.fn().mockResolvedValue(undefined),
    refreshIndex: vi.fn().mockResolvedValue(undefined),
    showLeftSidebar: vi.fn().mockResolvedValue(undefined),
    refreshTagFilter: vi.fn().mockResolvedValue(undefined),
    clearSelectedTags: vi.fn().mockResolvedValue(undefined),
    openTagContextItemNote: vi.fn().mockResolvedValue(undefined),
    locateTagContextItem: vi.fn().mockResolvedValue(undefined),
    returnToEditor: vi.fn().mockResolvedValue(undefined),
    showPreviewSidebar: vi.fn().mockResolvedValue(undefined),
    openPreviewLink: vi.fn().mockResolvedValue(undefined),
    copyPreviewLink: vi.fn().mockResolvedValue(undefined),
    openPreviewTargetNote: vi.fn().mockResolvedValue(undefined),
    refreshLinks: vi.fn().mockResolvedValue(undefined),
    showLinksSidebar: vi.fn().mockResolvedValue(undefined),
    openLinkItem: vi.fn().mockResolvedValue(undefined),
    openLinkTargetNote: vi.fn().mockResolvedValue(undefined),
    copyLinkItem: vi.fn().mockResolvedValue(undefined),
    createRelation: vi.fn().mockResolvedValue(undefined),
    refreshRelations: vi.fn().mockResolvedValue(undefined),
    showRelationSidebar: vi.fn().mockResolvedValue(undefined),
    openRelationTarget: vi.fn().mockResolvedValue(undefined),
    deleteRelation: vi.fn().mockResolvedValue(undefined),
    openShortcuts: vi.fn().mockResolvedValue(undefined),
    openAbout: vi.fn().mockResolvedValue(undefined),
  };
}

describe("menuActionRunner", () => {
  it("allows callers to provide only the handlers needed for the exercised action", async () => {
    const moveCurrentNote = vi.fn().mockResolvedValue(undefined);
    const runner = createMenuActionRunner({ moveCurrentNote });

    await expect(runner.run("note.move", { type: "note", noteId: "n1", path: "notes/a.md" })).resolves.toBe(true);
    expect(moveCurrentNote).toHaveBeenCalledOnce();
  });

  it("routes note.move to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await runner.run("note.move", { type: "note", noteId: "n1", path: "notes/a.md" });
    expect(handlers.moveCurrentNote).toHaveBeenCalledOnce();
  });

  it("routes note.copyLink to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(
      runner.run("note.copyLink", { type: "note", noteId: "n1", path: "notes/a.md" }),
    ).resolves.toBe(true);
    expect(handlers.copyCurrentNoteLink).toHaveBeenCalledOnce();
    expect(handlers.copyCurrentNoteLink).toHaveBeenCalledWith({
      type: "note",
      noteId: "n1",
      path: "notes/a.md",
    });
  });

  it("routes note.delete to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(
      runner.run("note.delete", { type: "note", noteId: "n1", path: "notes/a.md" }),
    ).resolves.toBe(true);
    expect(handlers.deleteCurrentNote).toHaveBeenCalledOnce();
  });

  it("runs every declared action id", async () => {
    const runner = createMenuActionRunner(createHandlers());
    const notePayload = { type: "note" as const, noteId: "n1", path: "notes/a.md" };
    const notebookPayload = { type: "notebook" as const, path: "notes/a", notebookName: "a", handlers: {} };
    const tagPayload = { type: "tag" as const, tagId: "tag-1", tagName: "项目", handlers: {} };
    const selectionPayload = { type: "editorSelection" as const, selectedText: "项目", handlers: {} };
    const blankPayload = { type: "editorBlank" as const, handlers: {} };
    const tagBlankPayload = { type: "tagBlank" as const, selectedTagIds: ["tag-1"], handlers: {} };
    const tagContextItemPayload = {
      type: "tagContextItem" as const,
      notePath: "notes/tag-context.md",
      noteTitle: "标签上下文",
      lineStart: 3,
      lineEnd: 3,
      occurrenceOrder: 0,
      handlers: {},
    };
    const previewBlankPayload = { type: "previewBlank" as const, handlers: {} };
    const previewLinkPayload = {
      type: "previewLink" as const,
      linkType: "internal" as const,
      href: "notes/a.md",
      notePath: "notes/a.md",
      handlers: {},
    };
    const linksBlankPayload = { type: "linksBlank" as const, handlers: {} };
    const linkItemPayload = {
      type: "linkItem" as const,
      linkId: "link-1",
      linkType: "internal" as const,
      href: "notes/a.md",
      notePath: "notes/a.md",
      handlers: {},
    };
    const relationBlankPayload = { type: "relationBlank" as const, handlers: {} };
    const relationItemPayload = {
      type: "relationItem" as const,
      relationId: "rel-1",
      notePath: "notes/a.md",
      handlers: {},
    };
    const noteActions = new Set(["edit.rename", "edit.move", "edit.copyLink", "note.rename", "note.move", "note.copyLink", "note.copyWikiLink", "note.delete", "note.open"]);
    const notebookActions = new Set(["notebook.createNote", "notebook.rename", "notebook.reorder", "notebook.delete"]);
    const tagActions = new Set(["tag.delete"]);
    const selectionActions = new Set(["selection.paste", "selection.insertLink", "selection.insertImage", "selection.insertTag", "selection.createWikiLink"]);
    const fileActions = new Set(["file.newNote", "file.newNotebook", "file.importNote", "file.refreshTree"]);
    const blankActions = new Set(["blank.paste", "blank.insertLink", "blank.insertImage", "blank.createWikiLink", "blank.refreshIndex", "blank.showSidebar"]);
    const tagBlankActions = new Set(["tagBlank.refresh", "tagBlank.clearFilter"]);
    const tagContextItemActions = new Set(["tagContextItem.openNote", "tagContextItem.locate"]);
    const previewBlankActions = new Set(["previewBlank.returnToEditor", "previewBlank.showSidebar"]);
    const previewLinkActions = new Set(["previewLink.open", "previewLink.copy", "previewLink.openTargetNote"]);
    const linksBlankActions = new Set(["linksBlank.refresh", "linksBlank.showSidebar"]);
    const linkItemActions = new Set(["linkItem.open", "linkItem.openTargetNote", "linkItem.copy"]);
    const relationBlankActions = new Set(["relationBlank.create", "relationBlank.refresh", "relationBlank.showSidebar"]);
    const relationItemActions = new Set(["relationItem.openTarget", "relationItem.delete"]);

    for (const actionId of MENU_ACTION_IDS) {
      const payload = noteActions.has(actionId)
        ? notePayload
        : notebookActions.has(actionId)
          ? notebookPayload
          : tagActions.has(actionId)
            ? tagPayload
            : fileActions.has(actionId)
              ? undefined
            : selectionActions.has(actionId)
              ? selectionPayload
              : blankActions.has(actionId)
                ? blankPayload
                : tagBlankActions.has(actionId)
                  ? tagBlankPayload
                  : tagContextItemActions.has(actionId)
                    ? tagContextItemPayload
                  : previewBlankActions.has(actionId)
                    ? previewBlankPayload
                    : previewLinkActions.has(actionId)
                      ? previewLinkPayload
                      : linksBlankActions.has(actionId)
                        ? linksBlankPayload
                        : linkItemActions.has(actionId)
                          ? linkItemPayload
                        : relationBlankActions.has(actionId)
                          ? relationBlankPayload
                          : relationItemActions.has(actionId)
                            ? relationItemPayload
            : undefined;

      await expect(runner.run(actionId, payload)).resolves.toBe(true);
    }
  });

  it("routes view.split to the editor mode handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(runner.run("view.split")).resolves.toBe(true);
    expect(handlers.setEditorMode).toHaveBeenCalledWith("split");
  });

  it("routes projection view actions to the provided handlers", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(runner.run("view.openProjection")).resolves.toBe(true);
    await expect(runner.run("view.closeProjection")).resolves.toBe(true);
    await expect(runner.run("view.projectionFollowScroll")).resolves.toBe(true);

    expect(handlers.openProjection).toHaveBeenCalledOnce();
    expect(handlers.closeProjection).toHaveBeenCalledOnce();
    expect(handlers.toggleProjectionFollowScroll).toHaveBeenCalledOnce();
  });

  it("routes view.editorOnly to the editor mode handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(runner.run("view.editorOnly")).resolves.toBe(true);
    expect(handlers.setEditorMode).toHaveBeenCalledWith("editor");
  });

  it("routes file.refreshTree to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(runner.run("file.refreshTree")).resolves.toBe(true);
    expect(handlers.refreshFileTree).toHaveBeenCalledOnce();
  });

  it("routes AI app-menu actions to the provided handlers", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(runner.run("ai.settings")).resolves.toBe(true);
    await expect(runner.run("ai.testConnection")).resolves.toBe(true);
    await expect(runner.run("ai.toggleAutoSummaryAgent")).resolves.toBe(true);

    expect(handlers.openAiSettings).toHaveBeenCalledOnce();
    expect(handlers.testAiConnection).toHaveBeenCalledOnce();
    expect(handlers.toggleAutoSummaryAgent).toHaveBeenCalledOnce();
  });

  it("throws when a note-only action receives a non-note payload", async () => {
    const runner = createMenuActionRunner(createHandlers());

    await expect(runner.run("note.rename", { type: "notebook", path: "notes/a" })).rejects.toThrow(
      "This menu action requires a note context payload.",
    );
  });

  it("throws when a notebook-only action receives a note payload", async () => {
    const runner = createMenuActionRunner(createHandlers());

    await expect(
      runner.run("notebook.rename", { type: "note", noteId: "n1", path: "notes/a.md" }),
    ).rejects.toThrow("This menu action requires a notebook context payload.");
  });

  it("routes tag.delete to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(runner.run("tag.delete", { type: "tag", tagId: "tag-1", tagName: "项目", handlers: {} })).resolves.toBe(true);
    expect(handlers.deleteTag).toHaveBeenCalledOnce();
  });

  it("routes selection.insertTag to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(
      runner.run("selection.insertTag", { type: "editorSelection", selectedText: "项目", handlers: {} }),
    ).resolves.toBe(true);
    expect(handlers.insertTagFromSelection).toHaveBeenCalledOnce();
  });

  it("routes selection.insertImage to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(
      runner.run("selection.insertImage", { type: "editorSelection", selectedText: "项目", handlers: {} }),
    ).resolves.toBe(true);
    expect(handlers.insertImageFromSelection).toHaveBeenCalledOnce();
  });

  it("routes selection.paste to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(
      runner.run("selection.paste", { type: "editorSelection", selectedText: "项目", handlers: {} }),
    ).resolves.toBe(true);
    expect(handlers.pasteFromSelection).toHaveBeenCalledOnce();
  });

  it("routes blank.insertImage to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(
      runner.run("blank.insertImage", { type: "editorBlank", handlers: {} }),
    ).resolves.toBe(true);
    expect(handlers.insertImageFromBlank).toHaveBeenCalledOnce();
  });

  it("routes blank.paste to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(
      runner.run("blank.paste", { type: "editorBlank", handlers: {} }),
    ).resolves.toBe(true);
    expect(handlers.pasteFromBlank).toHaveBeenCalledOnce();
  });

  it("routes previewLink actions to the provided handlers", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);
    const payload = {
      type: "previewLink" as const,
      linkType: "internal" as const,
      href: "notes/a.md",
      notePath: "notes/a.md",
      handlers: {},
    };

    await expect(runner.run("previewLink.open", payload)).resolves.toBe(true);
    await expect(runner.run("previewLink.copy", payload)).resolves.toBe(true);
    await expect(runner.run("previewLink.openTargetNote", payload)).resolves.toBe(true);

    expect(handlers.openPreviewLink).toHaveBeenCalledWith(payload);
    expect(handlers.copyPreviewLink).toHaveBeenCalledWith(payload);
    expect(handlers.openPreviewTargetNote).toHaveBeenCalledWith(payload);
  });

  it("routes linkItem actions to the provided handlers", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);
    const payload = {
      type: "linkItem" as const,
      linkId: "link-1",
      linkType: "internal" as const,
      href: "notes/a.md",
      notePath: "notes/a.md",
      handlers: {},
    };

    await expect(runner.run("linkItem.open", payload)).resolves.toBe(true);
    await expect(runner.run("linkItem.copy", payload)).resolves.toBe(true);
    await expect(runner.run("linkItem.openTargetNote", payload)).resolves.toBe(true);

    expect(handlers.openLinkItem).toHaveBeenCalledWith(payload);
    expect(handlers.copyLinkItem).toHaveBeenCalledWith(payload);
    expect(handlers.openLinkTargetNote).toHaveBeenCalledWith(payload);
  });

  it("routes relationItem.delete to the provided handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);
    const payload = {
      type: "relationItem" as const,
      relationId: "rel-1",
      notePath: "notes/target.md",
      handlers: {},
    };

    await expect(runner.run("relationItem.delete", payload)).resolves.toBe(true);
    expect(handlers.deleteRelation).toHaveBeenCalledWith(payload);
  });

  it("rejects previewLink.openTargetNote when the payload has no target note", async () => {
    const runner = createMenuActionRunner({ openPreviewTargetNote: vi.fn().mockResolvedValue(undefined) });

    await expect(
      runner.run("previewLink.openTargetNote", {
        type: "previewLink",
        linkType: "external",
        href: "https://example.com",
        handlers: {},
      }),
    ).rejects.toThrow("This menu action requires a preview link payload with a target note path.");
  });

  it("rejects relationItem.openTarget when the payload has no target note", async () => {
    const runner = createMenuActionRunner({ openRelationTarget: vi.fn().mockResolvedValue(undefined) });

    await expect(
      runner.run("relationItem.openTarget", {
        type: "relationItem",
        relationId: "rel-1",
        handlers: {},
      }),
    ).rejects.toThrow("This menu action requires a relation item payload with a target note path.");
  });

  it("rejects linkItem.openTargetNote when the payload has no target note", async () => {
    const runner = createMenuActionRunner({ openLinkTargetNote: vi.fn().mockResolvedValue(undefined) });

    await expect(
      runner.run("linkItem.openTargetNote", {
        type: "linkItem",
        linkId: "link-1",
        linkType: "external",
        href: "https://example.com",
        handlers: {},
      }),
    ).rejects.toThrow("This menu action requires a link item payload with a target note path.");
  });

  it("throws when a previewLink-only action receives a non-previewLink payload", async () => {
    const runner = createMenuActionRunner(createHandlers());

    await expect(
      runner.run("previewLink.openTargetNote", { type: "note", noteId: "n1", path: "notes/a.md" }),
    ).rejects.toThrow("This menu action requires a preview link context payload.");
  });
});