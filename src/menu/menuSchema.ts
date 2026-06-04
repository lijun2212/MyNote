import type { ContextMenuPayload } from "../components/ContextMenu/contextMenuTypes";
import { APP_MENU_IDS } from "./menuIds";
import type { MenuLeafId, MenuSchemaId } from "./menuIds";

export interface AppMenuSchemaOptions {
  hasKnowledgeBase: boolean;
  hasCurrentNote: boolean;
  leftSidebarVisible: boolean;
  rightSidebarVisible: boolean;
  editorMode: "editor" | "split";
}

export interface MenuSchemaItem {
  id: MenuSchemaId;
  label: string;
  enabled?: boolean;
  checked?: boolean;
  children?: MenuSchemaItem[];
}

function item(id: MenuLeafId, label: string, enabled = true): MenuSchemaItem {
  return { id, label, enabled };
}

function isEnabled(handler: unknown) {
  return typeof handler === "function";
}

function hasNotePath(notePath: string | undefined) {
  return typeof notePath === "string" && notePath.length > 0;
}

export function buildAppMenuSchema(options: AppMenuSchemaOptions): MenuSchemaItem[] {
  const { hasKnowledgeBase, hasCurrentNote, leftSidebarVisible, rightSidebarVisible, editorMode } = options;

  return [
    {
      id: APP_MENU_IDS[0],
      label: "文件",
      children: [
        item("file.newNote", "新建笔记", false),
        item("file.newNotebook", "新建笔记本", false),
        item("file.importNote", "导入笔记", false),
      ],
    },
    {
      id: APP_MENU_IDS[1],
      label: "编辑",
      children: [
        item("edit.rename", "重命名", false),
        item("edit.move", "移动", false),
        item("edit.copyLink", "复制链接", hasCurrentNote),
      ],
    },
    {
      id: APP_MENU_IDS[2],
      label: "视图",
      children: [
        item("view.search", "搜索", hasKnowledgeBase),
        { id: "view.toggleLeftSidebar", label: "显示左侧栏", enabled: true, checked: leftSidebarVisible },
        { id: "view.toggleRightSidebar", label: "显示右侧栏", enabled: true, checked: rightSidebarVisible },
        { id: "view.editorOnly", label: "仅编辑器", enabled: true, checked: editorMode === "editor" },
        { id: "view.split", label: "分栏编辑", enabled: true, checked: editorMode === "split" },
        item("view.graph", "知识图谱", false),
        item("view.revisions", "历史修订", false),
      ],
    },
    {
      id: APP_MENU_IDS[3],
      label: "笔记",
      children: [
        item("note.rename", "重命名", false),
        item("note.move", "移动", false),
        item("note.copyLink", "复制链接", hasCurrentNote),
        item("note.copyWikiLink", "复制 Wiki 链接", hasCurrentNote),
        item("note.relations", "关系", false),
      ],
    },
    {
      id: APP_MENU_IDS[4],
      label: "帮助",
      children: [
        item("help.shortcuts", "快捷键", false),
        item("help.about", "关于 MyNote", false),
      ],
    },
  ];
}

export function buildContextMenuSchema(payload: ContextMenuPayload): MenuSchemaItem[] {
  if (payload.type === "notebook") {
    return [
      item("notebook.createNote", "新建笔记", isEnabled(payload.handlers?.createNote)),
      item("notebook.rename", "重命名", isEnabled(payload.handlers?.rename)),
      item("notebook.reorder", "调整顺序", isEnabled(payload.handlers?.reorder)),
      item("notebook.delete", "删除", isEnabled(payload.handlers?.delete)),
    ];
  }

  if (payload.type === "tag") {
    return [
      item("tag.open", "查看标签上下文", isEnabled(payload.handlers?.open)),
      item("tag.rename", "重命名", isEnabled(payload.handlers?.rename)),
      item("tag.delete", "删除标签", isEnabled(payload.handlers?.delete)),
    ];
  }

  if (payload.type === "fileTreeBlank") {
    return [
      item("file.newNote", "新建笔记", isEnabled(payload.handlers?.createNote)),
      item("file.newNotebook", "新建笔记本", isEnabled(payload.handlers?.createNotebook)),
      item("file.importNote", "导入笔记", isEnabled(payload.handlers?.importNote)),
    ];
  }

  if (payload.type === "editorSelection") {
    return [
      item("selection.insertLink", "添加链接", isEnabled(payload.handlers?.insertLink)),
      item("selection.insertTag", "添加标签", isEnabled(payload.handlers?.insertTag)),
      item("selection.createWikiLink", "创建双链", isEnabled(payload.handlers?.createWikiLink)),
      item("selection.relation", "创建知识关联", false),
    ];
  }

  if (payload.type === "editorBlank") {
    return [
      item("blank.newNote", "新建笔记", false),
      item("blank.paste", "粘贴", false),
      item("blank.refreshIndex", "刷新索引", isEnabled(payload.handlers?.refreshIndex)),
      item("blank.showSidebar", "显示侧栏", isEnabled(payload.handlers?.showSidebar)),
    ];
  }

  if (payload.type === "tagBlank") {
    return [
      item("tagBlank.refresh", "刷新标签结果", isEnabled(payload.handlers?.refresh)),
      item(
        "tagBlank.clearFilter",
        "清空标签过滤",
        payload.selectedTagIds.length > 0 && isEnabled(payload.handlers?.clearFilter),
      ),
    ];
  }

  if (payload.type === "tagContextItem") {
    return [
      item("tagContextItem.openNote", "打开笔记", isEnabled(payload.handlers?.open)),
      item("tagContextItem.locate", "定位到标签位置", isEnabled(payload.handlers?.locate)),
    ];
  }

  if (payload.type === "previewBlank") {
    return [
      item("previewBlank.returnToEditor", "返回编辑器", isEnabled(payload.handlers?.returnToEditor)),
      item("previewBlank.showSidebar", "显示侧栏", isEnabled(payload.handlers?.showSidebar)),
    ];
  }

  if (payload.type === "previewLink") {
    const canOpenTargetNote =
      payload.linkType !== "external"
      && hasNotePath(payload.notePath)
      && isEnabled(payload.handlers?.openTargetNote);

    return [
      item("previewLink.open", "打开链接", isEnabled(payload.handlers?.open)),
      item("previewLink.copy", "复制链接", isEnabled(payload.handlers?.copy)),
      item("previewLink.openTargetNote", "打开目标笔记", canOpenTargetNote),
    ];
  }

  if (payload.type === "linksBlank") {
    return [
      item("linksBlank.refresh", "刷新链接", isEnabled(payload.handlers?.refresh)),
    ];
  }

  if (payload.type === "linkItem") {
    return [];
  }

  if (payload.type === "relationBlank") {
    return [
      item("relationBlank.create", "创建关系", isEnabled(payload.handlers?.create)),
      item("relationBlank.refresh", "刷新关系", isEnabled(payload.handlers?.refresh)),
    ];
  }

  if (payload.type === "relationItem") {
    return [
      item("relationItem.openTarget", "打开目标笔记", hasNotePath(payload.notePath) && isEnabled(payload.handlers?.openTarget)),
      item("relationItem.delete", "删除关系", isEnabled(payload.handlers?.delete)),
    ];
  }

  if (payload.type === "note") {
    return [
      item("note.open", "打开笔记", isEnabled(payload.handlers?.open)),
      item("note.rename", "重命名", isEnabled(payload.handlers?.rename)),
      item("note.move", "移动", isEnabled(payload.handlers?.move)),
      item("note.copyLink", "复制链接", isEnabled(payload.handlers?.copyLink)),
      item("note.copyWikiLink", "复制 Wiki 链接", isEnabled(payload.handlers?.copyWikiLink)),
    ];
  }

  return [];
}