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
    delete: () => undefined,
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

const fileTreeBlankPayload = {
  type: "fileTreeBlank" as const,
  path: "notes",
  handlers: {
    createNote: () => undefined,
    createNotebook: () => undefined,
    importNote: () => undefined,
    refreshTree: () => undefined,
  },
};

const editorBlankPayload = {
  type: "editorBlank" as const,
  handlers: {
    paste: () => undefined,
    insertLink: () => undefined,
    insertImage: () => undefined,
    createWikiLink: () => undefined,
    refreshIndex: () => undefined,
    showSidebar: () => undefined,
  },
};

const editorSelectionPayload = {
  type: "editorSelection" as const,
  selectedText: "项目周报",
  handlers: {
    paste: () => undefined,
    insertLink: () => undefined,
    insertImage: () => undefined,
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
  linkType: "internal" as const,
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
    showSidebar: () => undefined,
  },
};

const linkItemPayload = {
  type: "linkItem" as const,
  linkId: "link-1",
  linkType: "internal" as const,
  href: "notes/产品/需求.md",
  notePath: "notes/产品/需求.md",
  handlers: {
    open: () => undefined,
    openTargetNote: () => undefined,
    copy: () => undefined,
  },
};

const relationBlankPayload = {
  type: "relationBlank" as const,
  handlers: {
    create: () => undefined,
    refresh: () => undefined,
    showSidebar: () => undefined,
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
    hasDefaultAiProfile: true,
    autoSummaryAgentEnabled: true,
    projectionEnabled: false,
    projectionFollowScroll: true,
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

  const fileTreeBlankActions = buildContextMenuSchema(fileTreeBlankPayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  const editorSelectionActions = buildContextMenuSchema(editorSelectionPayload)
    .filter((item) => item.enabled !== false)
    .map((item) => item.id);

  const editorBlankActions = buildContextMenuSchema(editorBlankPayload)
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
    ...fileTreeBlankActions,
    ...editorSelectionActions,
    ...editorBlankActions,
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
      hasDefaultAiProfile: false,
      autoSummaryAgentEnabled: false,
      projectionEnabled: false,
      projectionFollowScroll: true,
    });

    expect(schema.map((item) => item.id)).toEqual([
      "file",
      "edit",
      "view",
      "note",
      "ai",
      "help",
    ]);
  });

  it("does not expose unfinished placeholder entries in the app menu", () => {
    const schema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: true,
      editorMode: "editor",
      hasDefaultAiProfile: false,
      autoSummaryAgentEnabled: false,
      projectionEnabled: false,
      projectionFollowScroll: true,
    });

    const viewMenu = schema.find((item) => item.id === "view");
    const noteMenu = schema.find((item) => item.id === "note");

    expect(viewMenu?.children?.some((item) => item.id === "view.graph")).toBe(false);
    expect(viewMenu?.children?.some((item) => item.id === "view.revisions")).toBe(false);
    expect(noteMenu?.children?.some((item) => item.id === "note.relations")).toBe(false);
  });

  it("marks editor layout entries as checked from the derived editor mode", () => {
    const editorSchema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "editor",
      hasDefaultAiProfile: false,
      autoSummaryAgentEnabled: false,
      projectionEnabled: false,
      projectionFollowScroll: true,
    });
    const splitSchema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
      hasDefaultAiProfile: false,
      autoSummaryAgentEnabled: false,
      projectionEnabled: false,
      projectionFollowScroll: true,
    });

    const editorViewMenu = editorSchema.find((item) => item.id === "view");
    const splitViewMenu = splitSchema.find((item) => item.id === "view");

    expect(editorViewMenu?.children?.find((item) => item.id === "view.editorOnly")?.checked).toBe(true);
    expect(editorViewMenu?.children?.find((item) => item.id === "view.split")?.checked).toBe(false);
    expect(splitViewMenu?.children?.find((item) => item.id === "view.editorOnly")?.checked).toBe(false);
    expect(splitViewMenu?.children?.find((item) => item.id === "view.split")?.checked).toBe(true);
  });

  it("exposes AI settings actions and reflects the auto-summary toggle state", () => {
    const enabledSchema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
      hasDefaultAiProfile: true,
      autoSummaryAgentEnabled: true,
      projectionEnabled: false,
      projectionFollowScroll: true,
    });
    const disabledSchema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
      hasDefaultAiProfile: false,
      autoSummaryAgentEnabled: false,
      projectionEnabled: false,
      projectionFollowScroll: true,
    });

    const enabledAiMenu = enabledSchema.find((item) => item.id === "ai");
    const disabledAiMenu = disabledSchema.find((item) => item.id === "ai");

    expect(enabledAiMenu?.children?.map((item) => item.id)).toEqual([
      "ai.settings",
      "ai.testConnection",
      "ai.toggleAutoSummaryAgent",
    ]);
    expect(enabledAiMenu?.children?.find((item) => item.id === "ai.testConnection")?.enabled).toBe(true);
    expect(enabledAiMenu?.children?.find((item) => item.id === "ai.toggleAutoSummaryAgent")?.checked).toBe(true);
    expect(disabledAiMenu?.children?.find((item) => item.id === "ai.testConnection")?.enabled).toBe(false);
    expect(disabledAiMenu?.children?.find((item) => item.id === "ai.toggleAutoSummaryAgent")?.enabled).toBe(false);
    expect(disabledAiMenu?.children?.find((item) => item.id === "ai.toggleAutoSummaryAgent")?.checked).toBe(false);
  });

  it("exposes refresh in the file app menu when a knowledge base is open", () => {
    const schema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: false,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
      hasDefaultAiProfile: false,
      autoSummaryAgentEnabled: false,
      projectionEnabled: false,
      projectionFollowScroll: true,
    });

    const fileMenu = schema.find((item) => item.id === "file");
    expect(fileMenu?.children?.map((item) => item.id)).toContain("file.refreshTree");
    expect(fileMenu?.children?.find((item) => item.id === "file.refreshTree")?.enabled).toBe(true);
  });

  it("enables file creation and help actions when available", () => {
    const enabledSchema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: false,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
      hasDefaultAiProfile: false,
      autoSummaryAgentEnabled: false,
      projectionEnabled: false,
      projectionFollowScroll: true,
    });
    const disabledSchema = buildAppMenuSchema({
      hasKnowledgeBase: false,
      hasCurrentNote: false,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
      hasDefaultAiProfile: false,
      autoSummaryAgentEnabled: false,
      projectionEnabled: false,
      projectionFollowScroll: true,
    });

    const enabledFileMenu = enabledSchema.find((item) => item.id === "file");
    const disabledFileMenu = disabledSchema.find((item) => item.id === "file");
    const helpMenu = enabledSchema.find((item) => item.id === "help");

    expect(enabledFileMenu?.children?.find((item) => item.id === "file.newNote")?.enabled).toBe(true);
    expect(enabledFileMenu?.children?.find((item) => item.id === "file.newNotebook")?.enabled).toBe(true);
    expect(enabledFileMenu?.children?.find((item) => item.id === "file.importNote")?.enabled).toBe(true);
    expect(disabledFileMenu?.children?.find((item) => item.id === "file.newNote")?.enabled).toBe(false);
    expect(disabledFileMenu?.children?.find((item) => item.id === "file.newNotebook")?.enabled).toBe(false);
    expect(disabledFileMenu?.children?.find((item) => item.id === "file.importNote")?.enabled).toBe(false);
    expect(helpMenu?.children?.find((item) => item.id === "help.shortcuts")?.enabled).toBe(true);
    expect(helpMenu?.children?.find((item) => item.id === "help.about")?.enabled).toBe(true);
  });

    it("enables note edit actions in the app menu when a current note exists", () => {
      const enabledSchema = buildAppMenuSchema({
        hasKnowledgeBase: true,
        hasCurrentNote: true,
        leftSidebarVisible: true,
        rightSidebarVisible: false,
        editorMode: "split",
        hasDefaultAiProfile: false,
        autoSummaryAgentEnabled: false,
        projectionEnabled: false,
        projectionFollowScroll: true,
      });
      const disabledSchema = buildAppMenuSchema({
        hasKnowledgeBase: true,
        hasCurrentNote: false,
        leftSidebarVisible: true,
        rightSidebarVisible: false,
        editorMode: "split",
        hasDefaultAiProfile: false,
        autoSummaryAgentEnabled: false,
        projectionEnabled: false,
        projectionFollowScroll: true,
      });

      const enabledEditMenu = enabledSchema.find((item) => item.id === "edit");
      const enabledNoteMenu = enabledSchema.find((item) => item.id === "note");
      const disabledEditMenu = disabledSchema.find((item) => item.id === "edit");
      const disabledNoteMenu = disabledSchema.find((item) => item.id === "note");

      expect(enabledEditMenu?.children?.find((item) => item.id === "edit.rename")?.enabled).toBe(true);
      expect(enabledEditMenu?.children?.find((item) => item.id === "edit.move")?.enabled).toBe(true);
      expect(enabledNoteMenu?.children?.find((item) => item.id === "note.move")?.enabled).toBe(true);
      expect(disabledEditMenu?.children?.find((item) => item.id === "edit.rename")?.enabled).toBe(false);
      expect(disabledEditMenu?.children?.find((item) => item.id === "edit.move")?.enabled).toBe(false);
      expect(disabledNoteMenu?.children?.find((item) => item.id === "note.move")?.enabled).toBe(false);
    });

  it("shows projection actions in the view menu and reflects projection state", () => {
    const inactiveSchema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
      hasDefaultAiProfile: false,
      autoSummaryAgentEnabled: false,
      projectionEnabled: false,
      projectionFollowScroll: true,
    });
    const activeSchema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: true,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
      hasDefaultAiProfile: false,
      autoSummaryAgentEnabled: false,
      projectionEnabled: true,
      projectionFollowScroll: false,
    });

    const inactiveViewMenu = inactiveSchema.find((item) => item.id === "view");
    const activeViewMenu = activeSchema.find((item) => item.id === "view");

    expect(inactiveViewMenu?.children?.some((item) => item.id === "view.openProjection")).toBe(true);
    expect(inactiveViewMenu?.children?.find((item) => item.id === "view.openProjection")?.enabled).toBe(true);
    expect(inactiveViewMenu?.children?.find((item) => item.id === "view.closeProjection")?.enabled).toBe(false);
    expect(inactiveViewMenu?.children?.find((item) => item.id === "view.projectionFollowScroll")?.enabled).toBe(false);

    expect(activeViewMenu?.children?.find((item) => item.id === "view.openProjection")?.enabled).toBe(false);
    expect(activeViewMenu?.children?.find((item) => item.id === "view.closeProjection")?.enabled).toBe(true);
    expect(activeViewMenu?.children?.find((item) => item.id === "view.projectionFollowScroll")?.enabled).toBe(true);
    expect(activeViewMenu?.children?.find((item) => item.id === "view.projectionFollowScroll")?.checked).toBe(false);
  });

  it("builds notebook and note context menus as different object menus", () => {
    const notebookMenu = buildContextMenuSchema(notebookPayload);
    const noteMenu = buildContextMenuSchema(notePayload);
    const tagMenu = buildContextMenuSchema(tagPayload);
    const fileTreeBlankMenu = buildContextMenuSchema(fileTreeBlankPayload);
    const selectionMenu = buildContextMenuSchema(editorSelectionPayload);
    const editorBlankMenu = buildContextMenuSchema(editorBlankPayload);
    const tagBlankMenu = buildContextMenuSchema(tagBlankPayload);
    const previewBlankMenu = buildContextMenuSchema(previewBlankPayload);
    const previewLinkMenu = buildContextMenuSchema(previewLinkPayload);
    const linksBlankMenu = buildContextMenuSchema(linksBlankPayload);
    const linkItemMenu = buildContextMenuSchema(linkItemPayload);
    const relationBlankMenu = buildContextMenuSchema(relationBlankPayload);
    const relationItemMenu = buildContextMenuSchema(relationItemPayload);

    expect(notebookMenu.map((item) => item.id)).toContain("notebook.createNote");
    expect(noteMenu.map((item) => item.id)).toContain("note.copyWikiLink");
    expect(noteMenu.map((item) => item.id)).toContain("note.delete");
    expect(noteMenu.map((item) => item.id)).not.toContain("notebook.reorder");
    expect(tagMenu.map((item) => item.id)).toContain("tag.delete");
    expect(fileTreeBlankMenu.map((item) => item.id)).toContain("file.newNotebook");
    expect(fileTreeBlankMenu.map((item) => item.id)).toContain("file.refreshTree");
    expect(selectionMenu.map((item) => item.id)).toContain("selection.insertLink");
    expect(selectionMenu.map((item) => item.id)).toContain("selection.paste");
    expect(selectionMenu.map((item) => item.id)).toContain("selection.insertImage");
    expect(selectionMenu[0]?.label).toBe("粘贴");
    expect(selectionMenu[1]?.label).toBe("转为双链");
    expect(selectionMenu[2]?.label).toBe("转为 Markdown 链接");
    expect(editorBlankMenu.map((item) => item.id)).toContain("blank.insertLink");
    expect(editorBlankMenu.map((item) => item.id)).toContain("blank.paste");
    expect(editorBlankMenu.map((item) => item.id)).toContain("blank.insertImage");
    expect(editorBlankMenu.map((item) => item.id)).toContain("blank.createWikiLink");
    expect(editorBlankMenu.map((item) => item.id)).toContain("blank.refreshIndex");
    expect(tagBlankMenu.map((item) => item.id)).toContain("tagBlank.clearFilter");
    expect(previewBlankMenu.map((item) => item.id)).toContain("previewBlank.returnToEditor");
    expect(previewLinkMenu.map((item) => item.id)).toContain("previewLink.openTargetNote");
    expect(linksBlankMenu.map((item) => item.id)).toContain("linksBlank.refresh");
    expect(linkItemMenu.map((item) => item.id)).toContain("linkItem.openTargetNote");
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

  it("reflects enabled differences between internal and external link-item menus", () => {
    const internalMenu = buildContextMenuSchema(linkItemPayload);
    const externalMenu = buildContextMenuSchema({
      type: "linkItem",
      linkId: "link-external",
      linkType: "external",
      href: "https://example.com",
      handlers: {
        open: () => undefined,
        copy: () => undefined,
        openTargetNote: () => undefined,
      },
    });

    expect(internalMenu.find((item) => item.id === "linkItem.open")?.enabled).toBe(true);
    expect(internalMenu.find((item) => item.id === "linkItem.openTargetNote")?.enabled).toBe(true);
    expect(internalMenu.find((item) => item.id === "linkItem.copy")?.enabled).toBe(true);
    expect(externalMenu.find((item) => item.id === "linkItem.open")?.enabled).toBe(true);
    expect(externalMenu.find((item) => item.id === "linkItem.openTargetNote")?.enabled).toBe(false);
    expect(externalMenu.find((item) => item.id === "linkItem.copy")?.enabled).toBe(true);
  });

  it("only enables relationItem.openTarget when a target note path and handler both exist", () => {
    const enabledMenu = buildContextMenuSchema(relationItemPayload);
    const missingTargetMenu = buildContextMenuSchema({
      type: "relationItem",
      relationId: "rel-1",
      handlers: {
        openTarget: () => undefined,
        delete: () => undefined,
      },
    });
    const missingHandlerMenu = buildContextMenuSchema({
      type: "relationItem",
      relationId: "rel-1",
      notePath: "notes/产品/需求.md",
      handlers: {
        delete: () => undefined,
      },
    });

    expect(enabledMenu.find((item) => item.id === "relationItem.openTarget")?.enabled).toBe(true);
    expect(missingTargetMenu.find((item) => item.id === "relationItem.openTarget")?.enabled).toBe(false);
    expect(missingHandlerMenu.find((item) => item.id === "relationItem.openTarget")?.enabled).toBe(false);
  });

  it("only enables context actions that already have real consumers", () => {
    const notebookMenu = buildContextMenuSchema(notebookPayload);
    const noteMenu = buildContextMenuSchema(notePayload);
    const tagMenu = buildContextMenuSchema(tagPayload);
    const blankMenu = buildContextMenuSchema(fileTreeBlankPayload);

    expect(notebookMenu.find((item) => item.id === "notebook.createNote")?.enabled).toBe(true);
    expect(notebookMenu.find((item) => item.id === "notebook.reorder")?.enabled).toBe(false);
    expect(noteMenu.find((item) => item.id === "note.open")?.enabled).toBe(true);
    expect(noteMenu.find((item) => item.id === "note.delete")?.enabled).toBe(true);
    expect(noteMenu.find((item) => item.id === "note.rename")?.enabled).toBe(false);
    expect(tagMenu.find((item) => item.id === "tag.delete")?.enabled).toBe(true);
    expect(tagMenu.find((item) => item.id === "tag.rename")?.enabled).toBe(false);
    expect(blankMenu.every((item) => item.enabled === true)).toBe(true);
    expect(buildContextMenuSchema(previewBlankPayload).every((item) => item.enabled === true)).toBe(true);
    expect(buildContextMenuSchema(linksBlankPayload).every((item) => item.enabled === true)).toBe(true);
    expect(buildContextMenuSchema(linkItemPayload).every((item) => item.enabled === true)).toBe(true);
    expect(buildContextMenuSchema(relationBlankPayload).every((item) => item.enabled === true)).toBe(true);
    expect(buildContextMenuSchema(relationItemPayload).every((item) => item.enabled === true)).toBe(true);
  });

  it("only exposes enabled actions that the runner supports", () => {
    const supportedIds = new Set<string>(MENU_ACTION_IDS);

    expect(collectEnabledActionIds().every((actionId) => supportedIds.has(actionId))).toBe(true);
  });
});