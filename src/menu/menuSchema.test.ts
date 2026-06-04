import { describe, expect, it } from "vitest";
import { MENU_ACTION_IDS } from "./menuIds";
import { buildAppMenuSchema, buildContextMenuSchema } from "./menuSchema";

const notebookPayload = {
  type: "notebook" as const,
  path: "notes/产品",
  notebookName: "产品",
  handlers: {
    createNote: () => undefined,
    rename: () => undefined,
    delete: () => undefined,
  },
};

const notePayload = {
  type: "note" as const,
  path: "notes/产品/需求.md",
  noteId: "n1",
  noteTitle: "需求",
  handlers: {
    open: () => undefined,
    copyLink: () => undefined,
    copyWikiLink: () => undefined,
  },
};

const tagPayload = {
  type: "tag" as const,
  tagId: "tag-1",
  tagName: "项目报告",
  handlers: {
    delete: () => undefined,
  },
};

const editorSelectionPayload = {
  type: "editorSelection" as const,
  selectedText: "项目周报",
  handlers: {
    insertLink: () => undefined,
    insertTag: () => undefined,
    createWikiLink: () => undefined,
  },
};

const tagBlankPayload = {
  type: "tagBlank" as const,
  selectedTagIds: ["tag-1"],
  handlers: {
    refresh: () => undefined,
    clearFilter: () => undefined,
  },
};

const previewBlankPayload = {
  type: "previewBlank" as const,
  handlers: {
    returnToEditor: () => undefined,
    showSidebar: () => undefined,
  },
};

const previewLinkPayload = {
  type: "previewLink" as const,
  linkType: "internal",
  href: "notes/产品/需求.md",
  notePath: "notes/产品/需求.md",
  handlers: {
    open: () => undefined,
    copy: () => undefined,
    openTargetNote: () => undefined,
  },
};

const linksBlankPayload = {
  type: "linksBlank" as const,
  handlers: {
    refresh: () => undefined,
  },
};

const relationBlankPayload = {
  type: "relationBlank" as const,
  handlers: {
    create: () => undefined,
    refresh: () => undefined,
  },
};

const relationItemPayload = {
  type: "relationItem" as const,
  relationId: "rel-1",
  notePath: "notes/产品/需求.md",
  handlers: {
    openTarget: () => undefined,
    delete: () => undefined,
  },
};

function collectEnabledActionIds() {
  const appMenuActions = buildAppMenuSchema({
    hasKnowledgeBase: true,
    hasCurrentNote: true,
    leftSidebarVisible: true,
    rightSidebarVisible: true,
    editorMode: "split",
  }).flatMap((item) => item.children ?? []).filter((item) => item.enabled !== false).map((item) => item.id);

  const notebookActions = buildContextMenuSchema(notebookPayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  const noteActions = buildContextMenuSchema(notePayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  const tagActions = buildContextMenuSchema(tagPayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  const tagBlankActions = buildContextMenuSchema(tagBlankPayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  const previewBlankActions = buildContextMenuSchema(previewBlankPayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  const previewLinkActions = buildContextMenuSchema(previewLinkPayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  const linksBlankActions = buildContextMenuSchema(linksBlankPayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  const relationBlankActions = buildContextMenuSchema(relationBlankPayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  const relationItemActions = buildContextMenuSchema(relationItemPayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  return [
    ...appMenuActions,
    ...notebookActions,
    ...noteActions,
    ...tagActions,
    ...tagBlankActions,
    ...previewBlankActions,
    ...previewLinkActions,
    ...linksBlankActions,
    ...relationBlankActions,
    ...relationItemActions,
  ];
}

describe("menuSchema", () => {
  it("builds the approved app menu top-level structure", () => {
    const schema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
    });

    expect(schema.map((item) => item.id)).toEqual([
      "file",
      "edit",
      "view",
      "note",
      "help",
    ]);
  });

  it("keeps graph and revision entries disabled as planned placeholders", () => {
    const schema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: true,
      editorMode: "editor",
    });

    const viewMenu = schema.find((item) => item.id === "view");
    expect(viewMenu?.children?.find((item) => item.id === "view.graph")?.enabled).toBe(false);
    expect(viewMenu?.children?.find((item) => item.id === "view.revisions")?.enabled).toBe(false);
  });

  it("marks editor layout entries as checked from the derived editor mode", () => {
    const editorSchema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "editor",
    });
    const splitSchema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
    });

    const editorViewMenu = editorSchema.find((item) => item.id === "view");
    const splitViewMenu = splitSchema.find((item) => item.id === "view");

    expect(editorViewMenu?.children?.find((item) => item.id === "view.editorOnly")?.checked).toBe(true);
    expect(editorViewMenu?.children?.find((item) => item.id === "view.split")?.checked).toBe(false);
    expect(splitViewMenu?.children?.find((item) => item.id === "view.editorOnly")?.checked).toBe(false);
    expect(splitViewMenu?.children?.find((item) => item.id === "view.split")?.checked).toBe(true);
  });

  it("builds notebook and note context menus as different object menus", () => {
    const notebookMenu = buildContextMenuSchema(notebookPayload);
    const noteMenu = buildContextMenuSchema(notePayload);
    const tagMenu = buildContextMenuSchema(tagPayload);
    const selectionMenu = buildContextMenuSchema(editorSelectionPayload);
    const tagBlankMenu = buildContextMenuSchema(tagBlankPayload);
    const previewBlankMenu = buildContextMenuSchema(previewBlankPayload);
    const previewLinkMenu = buildContextMenuSchema(previewLinkPayload);
    const linksBlankMenu = buildContextMenuSchema(linksBlankPayload);
    const relationBlankMenu = buildContextMenuSchema(relationBlankPayload);
    const relationItemMenu = buildContextMenuSchema(relationItemPayload);

    expect(notebookMenu.map((item) => item.id)).toContain("notebook.createNote");
    expect(noteMenu.map((item) => item.id)).toContain("note.copyWikiLink");
    expect(noteMenu.map((item) => item.id)).not.toContain("notebook.reorder");
    expect(tagMenu.map((item) => item.id)).toContain("tag.delete");
    expect(selectionMenu.map((item) => item.id)).toContain("selection.insertLink");
    expect(tagBlankMenu.map((item) => item.id)).toContain("tagBlank.clearFilter");
    expect(previewBlankMenu.map((item) => item.id)).toContain("previewBlank.returnToEditor");
    expect(previewLinkMenu.map((item) => item.id)).toContain("previewLink.openTargetNote");
    expect(linksBlankMenu.map((item) => item.id)).toContain("linksBlank.refresh");
    expect(relationBlankMenu.map((item) => item.id)).toContain("relationBlank.create");
    expect(relationItemMenu.map((item) => item.id)).toContain("relationItem.delete");
  });

  it("only enables tagBlank.clearFilter when tags are selected and a handler exists", () => {
    const enabledMenu = buildContextMenuSchema(tagBlankPayload);
    const noSelectionMenu = buildContextMenuSchema({
      type: "tagBlank",
      selectedTagIds: [],
      handlers: {
        clearFilter: () => undefined,
      },
    });
    const noHandlerMenu = buildContextMenuSchema({
      type: "tagBlank",
      selectedTagIds: ["tag-1"],
      handlers: {},
    });

    expect(enabledMenu.find((item) => item.id === "tagBlank.clearFilter")?.enabled).toBe(true);
    expect(noSelectionMenu.find((item) => item.id === "tagBlank.clearFilter")?.enabled).toBe(false);
    expect(noHandlerMenu.find((item) => item.id === "tagBlank.clearFilter")?.enabled).toBe(false);
  });

  it("only enables previewLink.openTargetNote when an internal target note path exists and a handler is present", () => {
    const internalMenu = buildContextMenuSchema(previewLinkPayload);
    const externalMenu = buildContextMenuSchema({
      type: "previewLink",
      linkType: "external",
      href: "https://example.com",
      handlers: {
        open: () => undefined,
        copy: () => undefined,
        openTargetNote: () => undefined,
      },
    });
    const unresolvedWikiMenu = buildContextMenuSchema({
      type: "previewLink",
      linkType: "wiki",
      href: "[[未解析]]",
      handlers: {
        open: () => undefined,
        copy: () => undefined,
        openTargetNote: () => undefined,
      },
    });
    const resolvedWikiMenu = buildContextMenuSchema({
      type: "previewLink",
      linkType: "wiki",
      href: "[[需求]]",
      notePath: "notes/产品/需求.md",
      handlers: {
        open: () => undefined,
        copy: () => undefined,
        openTargetNote: () => undefined,
      },
    });

    expect(internalMenu.find((item) => item.id === "previewLink.openTargetNote")?.enabled).toBe(true);
    expect(externalMenu.find((item) => item.id === "previewLink.openTargetNote")?.enabled).toBe(false);
    expect(unresolvedWikiMenu.find((item) => item.id === "previewLink.openTargetNote")?.enabled).toBe(false);
    expect(resolvedWikiMenu.find((item) => item.id === "previewLink.openTargetNote")?.enabled).toBe(true);
  });

  it("reflects enabled differences between external, internal, and wiki preview links", () => {
    const externalMenu = buildContextMenuSchema({
      type: "previewLink",
      linkType: "external",
      href: "https://example.com",
      handlers: {
        open: () => undefined,
        copy: () => undefined,
      },
    });
    const internalMenu = buildContextMenuSchema(previewLinkPayload);
    const wikiMenu = buildContextMenuSchema({
      type: "previewLink",
      linkType: "wiki",
      href: "[[需求]]",
      notePath: "notes/产品/需求.md",
      handlers: {
        open: () => undefined,
        copy: () => undefined,
        openTargetNote: () => undefined,
      },
    });

    expect(externalMenu.find((item) => item.id === "previewLink.open")?.enabled).toBe(true);
    expect(externalMenu.find((item) => item.id === "previewLink.copy")?.enabled).toBe(true);
    expect(externalMenu.find((item) => item.id === "previewLink.openTargetNote")?.enabled).toBe(false);
    expect(internalMenu.find((item) => item.id === "previewLink.openTargetNote")?.enabled).toBe(true);
    expect(wikiMenu.find((item) => item.id === "previewLink.openTargetNote")?.enabled).toBe(true);
  });

  it("only enables context actions that already have real consumers", () => {
    const notebookMenu = buildContextMenuSchema(notebookPayload);
    const noteMenu = buildContextMenuSchema(notePayload);
    const tagMenu = buildContextMenuSchema(tagPayload);
    const blankMenu = buildContextMenuSchema({
      type: "fileTreeBlank",
      path: "notes",
      handlers: {
        createNote: () => undefined,
        createNotebook: () => undefined,
        importNote: () => undefined,
      },
    });

    expect(notebookMenu.find((item) => item.id === "notebook.createNote")?.enabled).toBe(true);
    expect(notebookMenu.find((item) => item.id === "notebook.reorder")?.enabled).toBe(false);
    expect(noteMenu.find((item) => item.id === "note.open")?.enabled).toBe(true);
    expect(noteMenu.find((item) => item.id === "note.rename")?.enabled).toBe(false);
    expect(tagMenu.find((item) => item.id === "tag.delete")?.enabled).toBe(true);
    expect(tagMenu.find((item) => item.id === "tag.rename")?.enabled).toBe(false);
    expect(blankMenu.every((item) => item.enabled === true)).toBe(true);
    expect(buildContextMenuSchema(previewBlankPayload).every((item) => item.enabled === true)).toBe(true);
    expect(buildContextMenuSchema(linksBlankPayload).every((item) => item.enabled === true)).toBe(true);
    expect(buildContextMenuSchema(relationBlankPayload).every((item) => item.enabled === true)).toBe(true);
    expect(buildContextMenuSchema(relationItemPayload).every((item) => item.enabled === true)).toBe(true);
  });

  it("only exposes enabled actions that the runner supports", () => {
    const supportedIds = new Set<string>(MENU_ACTION_IDS);

    expect(collectEnabledActionIds().every((actionId) => supportedIds.has(actionId))).toBe(true);
  });
});