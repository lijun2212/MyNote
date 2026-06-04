import { describe, expect, it, vi } from "vitest";
import { MENU_ACTION_IDS } from "./menuIds";
import { createMenuActionRunner } from "./menuActionRunner";

function createHandlers() {
  return {
    createNote: vi.fn().mockResolvedValue(undefined),
    createNotebook: vi.fn().mockResolvedValue(undefined),
    importNote: vi.fn().mockResolvedValue(undefined),
    openSearch: vi.fn().mockResolvedValue(undefined),
    toggleLeftSidebar: vi.fn().mockResolvedValue(undefined),
    toggleRightSidebar: vi.fn().mockResolvedValue(undefined),
    setEditorMode: vi.fn().mockResolvedValue(undefined),
    openCurrentNote: vi.fn().mockResolvedValue(undefined),
    moveCurrentNote: vi.fn().mockResolvedValue(undefined),
    renameCurrentNote: vi.fn().mockResolvedValue(undefined),
    copyCurrentNoteLink: vi.fn().mockResolvedValue(undefined),
    copyCurrentNoteWikiLink: vi.fn().mockResolvedValue(undefined),
    createNoteInNotebook: vi.fn().mockResolvedValue(undefined),
    renameNotebook: vi.fn().mockResolvedValue(undefined),
    reorderNotebook: vi.fn().mockResolvedValue(undefined),
    deleteNotebook: vi.fn().mockResolvedValue(undefined),
    deleteTag: vi.fn().mockResolvedValue(undefined),
    insertLinkFromSelection: vi.fn().mockResolvedValue(undefined),
    insertTagFromSelection: vi.fn().mockResolvedValue(undefined),
    createWikiLinkFromSelection: vi.fn().mockResolvedValue(undefined),
    refreshIndex: vi.fn().mockResolvedValue(undefined),
    showLeftSidebar: vi.fn().mockResolvedValue(undefined),
    openShortcuts: vi.fn().mockResolvedValue(undefined),
    openAbout: vi.fn().mockResolvedValue(undefined),
  };
}

describe("menuActionRunner", () => {
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

  it("runs every declared action id", async () => {
    const runner = createMenuActionRunner(createHandlers());
    const notePayload = { type: "note" as const, noteId: "n1", path: "notes/a.md" };
    const notebookPayload = { type: "notebook" as const, path: "notes/a", notebookName: "a", handlers: {} };
    const tagPayload = { type: "tag" as const, tagId: "tag-1", tagName: "项目", handlers: {} };
    const selectionPayload = { type: "editorSelection" as const, selectedText: "项目", handlers: {} };
    const blankPayload = { type: "editorBlank" as const, handlers: {} };
    const noteActions = new Set(["edit.rename", "edit.move", "edit.copyLink", "note.rename", "note.move", "note.copyLink", "note.copyWikiLink", "note.open"]);
    const notebookActions = new Set(["notebook.createNote", "notebook.rename", "notebook.reorder", "notebook.delete"]);
    const tagActions = new Set(["tag.delete"]);
    const selectionActions = new Set(["selection.insertLink", "selection.insertTag", "selection.createWikiLink"]);
    const blankActions = new Set(["blank.refreshIndex", "blank.showSidebar"]);

    for (const actionId of MENU_ACTION_IDS) {
      const payload = noteActions.has(actionId)
        ? notePayload
        : notebookActions.has(actionId)
          ? notebookPayload
          : tagActions.has(actionId)
            ? tagPayload
            : selectionActions.has(actionId)
              ? selectionPayload
              : blankActions.has(actionId)
                ? blankPayload
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

  it("routes view.editorOnly to the editor mode handler", async () => {
    const handlers = createHandlers();
    const runner = createMenuActionRunner(handlers);

    await expect(runner.run("view.editorOnly")).resolves.toBe(true);
    expect(handlers.setEditorMode).toHaveBeenCalledWith("editor");
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
});