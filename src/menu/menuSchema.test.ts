import { describe, expect, it } from "vitest";
import { MENU_ACTION_IDS } from "./menuIds";
import { buildAppMenuSchema, buildContextMenuSchema } from "./menuSchema";
import type { MenuSchemaItem, MenuSchemaNode } from "./menuSchema";

function isMenuItem(node: MenuSchemaNode | undefined): node is MenuSchemaItem {
  return Boolean(node) && !("type" in (node as MenuSchemaNode));
}

function findMenuItem(children: MenuSchemaNode[] | undefined, id: string): MenuSchemaItem | undefined {
  return children?.find((item) => item.id === id && isMenuItem(item)) as MenuSchemaItem | undefined;
}

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
  const flattenEnabledIds = (items: ReturnType<typeof buildAppMenuSchema>): string[] => items.flatMap((menuItem) => {
    if (!menuItem.children) {
      return menuItem.enabled === false || ("type" in menuItem && menuItem.type === "separator") ? [] : [menuItem.id];
    }

    return flattenEnabledIds(menuItem.children as ReturnType<typeof buildAppMenuSchema>);
  });

  const appMenuActions = flattenEnabledIds(buildAppMenuSchema({
    hasKnowledgeBase: true,
    hasCurrentNote: true,
    leftSidebarVisible: true,
    rightSidebarVisible: true,
    editorMode: "split",
    hasDefaultAiProfile: true,
    autoSummaryAgentEnabled: true,
    projectionEnabled: false,
    projectionFollowScroll: true,
  }));

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
      "mynote",
      "edit",
      "view",
      "help",
    ]);
  });

  it("builds the Edit menu with merged note actions plus undo and redo", () => {
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

    const editMenu = schema.find((item) => item.id === "edit");

    expect(editMenu?.children?.map((item) => item.id)).toEqual([
      "edit.rename",
      "edit.move",
      "edit.copyLink",
      "note.copyWikiLink",
      "note.delete",
      "edit.paste",
      "edit.undo",
      "edit.redo",
    ]);
    expect(editMenu?.children?.map((item) => ("type" in item ? "separator" : item.label))).toEqual([
      "重命名",
      "移动",
      "复制链接",
      "复制 Wiki 链接",
      "删除笔记",
      "粘贴",
      "撤销",
      "重做",
    ]);
    expect(findMenuItem(editMenu?.children, "edit.copyLink")).toMatchObject({
      enabled: true,
      accelerator: "Cmd+L",
    });
    expect(findMenuItem(editMenu?.children, "note.copyWikiLink")).toMatchObject({
      enabled: true,
      accelerator: "Cmd+Shift+W",
    });
    expect(findMenuItem(editMenu?.children, "edit.paste")).toMatchObject({
      enabled: true,
    });
  });

  it("disables note-scoped Edit actions when there is no current note", () => {
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

    const editMenu = schema.find((item) => item.id === "edit");

    expect(findMenuItem(editMenu?.children, "edit.rename")?.enabled).toBe(false);
    expect(findMenuItem(editMenu?.children, "edit.move")?.enabled).toBe(false);
    expect(findMenuItem(editMenu?.children, "edit.copyLink")?.enabled).toBe(false);
    expect(findMenuItem(editMenu?.children, "note.copyWikiLink")?.enabled).toBe(false);
    expect(findMenuItem(editMenu?.children, "note.delete")?.enabled).toBe(false);
  });

  it("builds the MyNote menu with kb actions, explicit separator, and nested AI submenu", () => {
    const enabledSchema = buildAppMenuSchema({
      hasKnowledgeBase: true,
      hasCurrentNote: false,
      leftSidebarVisible: true,
      rightSidebarVisible: false,
      editorMode: "split",
      hasDefaultAiProfile: true,
      autoSummaryAgentEnabled: true,
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

    const mynoteMenu = enabledSchema.find((item) => item.id === "mynote");
    const disabledMynoteMenu = disabledSchema.find((item) => item.id === "mynote");
    const aiMenu = findMenuItem(mynoteMenu?.children, "mynote.ai");

    expect(mynoteMenu?.children?.map((item) => item.id)).toEqual([
      "file.newNote",
      "file.newNotebook",
      "kb.open",
      "kb.close",
      "file.importNote",
      "mynote.separator",
      "mynote.ai",
    ]);
    expect(mynoteMenu?.children?.map((item) => ("type" in item ? item.type : "item"))).toEqual([
      "item",
      "item",
      "item",
      "item",
      "item",
      "separator",
      "item",
    ]);
    expect(mynoteMenu?.children?.map((item) => ("type" in item ? "separator" : item.label))).toEqual([
      "新建笔记",
      "新建笔记本",
      "打开知识库",
      "关闭知识库",
      "导入笔记",
      "separator",
      "AI 设置",
    ]);
    expect(mynoteMenu?.children?.find((item) => item.id === "mynote.separator")).toMatchObject({
      type: "separator",
    });
    expect(aiMenu?.children?.map((item) => item.id)).toEqual([
      "ai.settings",
      "ai.toggleAutoSummaryAgent",
    ]);
    expect(aiMenu?.children?.filter(isMenuItem).map((item) => item.label)).toEqual([
      "打开 AI 设置",
      "启用自动摘要",
    ]);
    expect(findMenuItem(aiMenu?.children, "ai.toggleAutoSummaryAgent")?.checked).toBe(true);
    expect(findMenuItem(disabledMynoteMenu?.children, "file.newNote")?.enabled).toBe(false);
    expect(findMenuItem(disabledMynoteMenu?.children, "file.newNotebook")?.enabled).toBe(false);
    expect(findMenuItem(disabledMynoteMenu?.children, "file.importNote")?.enabled).toBe(false);
    expect(findMenuItem(disabledMynoteMenu?.children, "kb.open")?.enabled).toBe(true);
    expect(findMenuItem(disabledMynoteMenu?.children, "kb.close")?.enabled).toBe(false);
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

    expect(viewMenu?.children?.some((item) => item.id === "view.graph")).toBe(false);
    expect(viewMenu?.children?.some((item) => item.id === "view.revisions")).toBe(false);
    expect(schema.map((item) => item.label)).not.toContain("笔记");
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

    expect(findMenuItem(editorViewMenu?.children, "view.editorOnly")?.checked).toBe(true);
    expect(findMenuItem(editorViewMenu?.children, "view.split")?.checked).toBe(false);
    expect(findMenuItem(splitViewMenu?.children, "view.editorOnly")?.checked).toBe(false);
    expect(findMenuItem(splitViewMenu?.children, "view.split")?.checked).toBe(true);
  });

  it("keeps help menu actions available", () => {
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
    const helpMenu = enabledSchema.find((item) => item.id === "help");

    expect(helpMenu?.children?.map((item) => item.id)).toEqual([
      "help.shortcuts",
      "help.manual",
      "help.about",
    ]);
    expect(findMenuItem(helpMenu?.children, "help.shortcuts")?.enabled).toBe(true);
    expect(findMenuItem(helpMenu?.children, "help.manual")?.enabled).toBe(true);
    expect(findMenuItem(helpMenu?.children, "help.about")?.enabled).toBe(true);
  });

  it("enables MyNote creation actions when a knowledge base is open", () => {
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

    const enabledMynoteMenu = enabledSchema.find((item) => item.id === "mynote");
    const disabledMynoteMenu = disabledSchema.find((item) => item.id === "mynote");

    expect(findMenuItem(enabledMynoteMenu?.children, "file.newNote")?.enabled).toBe(true);
    expect(findMenuItem(enabledMynoteMenu?.children, "file.newNotebook")?.enabled).toBe(true);
    expect(findMenuItem(enabledMynoteMenu?.children, "file.importNote")?.enabled).toBe(true);
    expect(findMenuItem(disabledMynoteMenu?.children, "file.newNote")?.enabled).toBe(false);
    expect(findMenuItem(disabledMynoteMenu?.children, "file.newNotebook")?.enabled).toBe(false);
    expect(findMenuItem(disabledMynoteMenu?.children, "file.importNote")?.enabled).toBe(false);
  });

  it("moves remaining note actions into the Edit menu when a current note exists", () => {
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
    const disabledEditMenu = disabledSchema.find((item) => item.id === "edit");

    expect(findMenuItem(enabledEditMenu?.children, "edit.rename")?.enabled).toBe(true);
    expect(findMenuItem(enabledEditMenu?.children, "edit.move")?.enabled).toBe(true);
    expect(findMenuItem(enabledEditMenu?.children, "edit.copyLink")?.enabled).toBe(true);
    expect(findMenuItem(enabledEditMenu?.children, "note.copyWikiLink")?.enabled).toBe(true);
    expect(findMenuItem(enabledEditMenu?.children, "note.delete")?.enabled).toBe(true);
    expect(findMenuItem(disabledEditMenu?.children, "edit.rename")?.enabled).toBe(false);
    expect(findMenuItem(disabledEditMenu?.children, "edit.move")?.enabled).toBe(false);
    expect(findMenuItem(disabledEditMenu?.children, "edit.copyLink")?.enabled).toBe(false);
    expect(findMenuItem(disabledEditMenu?.children, "note.copyWikiLink")?.enabled).toBe(false);
    expect(findMenuItem(disabledEditMenu?.children, "note.delete")?.enabled).toBe(false);
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
    expect(findMenuItem(inactiveViewMenu?.children, "view.openProjection")?.enabled).toBe(true);
    expect(findMenuItem(inactiveViewMenu?.children, "view.closeProjection")?.enabled).toBe(false);
    expect(findMenuItem(inactiveViewMenu?.children, "view.projectionFollowScroll")?.enabled).toBe(false);

    expect(findMenuItem(activeViewMenu?.children, "view.openProjection")?.enabled).toBe(false);
    expect(findMenuItem(activeViewMenu?.children, "view.closeProjection")?.enabled).toBe(true);
    expect(findMenuItem(activeViewMenu?.children, "view.projectionFollowScroll")?.enabled).toBe(true);
    expect(findMenuItem(activeViewMenu?.children, "view.projectionFollowScroll")?.checked).toBe(false);
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