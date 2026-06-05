import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createMenuActionRunner } from "../../menu/menuActionRunner";
import type { MenuActionId } from "../../menu/menuIds";
import { buildContextMenuSchema } from "../../menu/menuSchema";
import type { ContextMenuPayload } from "./contextMenuTypes";
import { useContextMenu } from "./useContextMenu";

const MENU_WIDTH_PX = 220;
const MENU_MIN_HEIGHT_PX = 48;
const MENU_MARGIN_PX = 12;

function noop() {
  return undefined;
}

function getMenuPosition(position: { x: number; y: number }, size: { width: number; height: number }) {
  if (typeof window === "undefined") {
    return position;
  }

  return {
    x: Math.min(position.x, Math.max(MENU_MARGIN_PX, window.innerWidth - size.width - MENU_MARGIN_PX)),
    y: Math.min(position.y, Math.max(MENU_MARGIN_PX, window.innerHeight - size.height - MENU_MARGIN_PX)),
  };
}

function createContextRunner(payload: ContextMenuPayload) {
  return createMenuActionRunner({
    createNote: () => payload.type === "fileTreeBlank" ? payload.handlers?.createNote?.(payload) : undefined,
    createNotebook: () => payload.type === "fileTreeBlank" ? payload.handlers?.createNotebook?.(payload) : undefined,
    importNote: () => payload.type === "fileTreeBlank" ? payload.handlers?.importNote?.(payload) : undefined,
    openSearch: noop,
    toggleLeftSidebar: noop,
    toggleRightSidebar: noop,
    setEditorMode: noop,
    openCurrentNote: (notePayload) => notePayload.handlers?.open?.(notePayload),
    moveCurrentNote: (notePayload) => notePayload.handlers?.move?.(notePayload),
    renameCurrentNote: (notePayload) => notePayload.handlers?.rename?.(notePayload),
    copyCurrentNoteLink: (notePayload) => notePayload.handlers?.copyLink?.(notePayload),
    copyCurrentNoteWikiLink: (notePayload) => notePayload.handlers?.copyWikiLink?.(notePayload),
    createNoteInNotebook: (notebookPayload) => notebookPayload.handlers?.createNote?.(notebookPayload),
    renameNotebook: (notebookPayload) => notebookPayload.handlers?.rename?.(notebookPayload),
    reorderNotebook: (notebookPayload) => notebookPayload.handlers?.reorder?.(notebookPayload),
    deleteNotebook: (notebookPayload) => notebookPayload.handlers?.delete?.(notebookPayload),
    deleteTag: (tagPayload) => tagPayload.handlers?.delete?.(tagPayload),
    insertLinkFromSelection: (selectionPayload) => selectionPayload.handlers?.insertLink?.(selectionPayload),
    insertTagFromSelection: (selectionPayload) => selectionPayload.handlers?.insertTag?.(selectionPayload),
    createWikiLinkFromSelection: (selectionPayload) => selectionPayload.handlers?.createWikiLink?.(selectionPayload),
    insertLinkFromBlank: (blankPayload) => blankPayload.handlers?.insertLink?.(blankPayload),
    createWikiLinkFromBlank: (blankPayload) => blankPayload.handlers?.createWikiLink?.(blankPayload),
    refreshIndex: (blankPayload) => blankPayload.handlers?.refreshIndex?.(blankPayload),
    showLeftSidebar: (blankPayload) => blankPayload.handlers?.showSidebar?.(blankPayload),
    refreshTagFilter: (tagBlankPayload) => tagBlankPayload.handlers?.refresh?.(tagBlankPayload),
    clearSelectedTags: (tagBlankPayload) => tagBlankPayload.handlers?.clearFilter?.(tagBlankPayload),
    openTagContextItemNote: (tagContextItemPayload) => tagContextItemPayload.handlers?.open?.(tagContextItemPayload),
    locateTagContextItem: (tagContextItemPayload) => tagContextItemPayload.handlers?.locate?.(tagContextItemPayload),
    returnToEditor: (previewBlankPayload) => previewBlankPayload.handlers?.returnToEditor?.(previewBlankPayload),
    showPreviewSidebar: (previewBlankPayload) => previewBlankPayload.handlers?.showSidebar?.(previewBlankPayload),
    openPreviewLink: (previewLinkPayload) => previewLinkPayload.handlers?.open?.(previewLinkPayload),
    copyPreviewLink: (previewLinkPayload) => previewLinkPayload.handlers?.copy?.(previewLinkPayload),
    openPreviewTargetNote: (previewLinkPayload) => previewLinkPayload.handlers?.openTargetNote?.(previewLinkPayload),
    refreshLinks: (linksBlankPayload) => linksBlankPayload.handlers?.refresh?.(linksBlankPayload),
    showLinksSidebar: (linksBlankPayload) => linksBlankPayload.handlers?.showSidebar?.(linksBlankPayload),
    openLinkItem: (linkItemPayload) => linkItemPayload.handlers?.open?.(linkItemPayload),
    openLinkTargetNote: (linkItemPayload) => linkItemPayload.handlers?.openTargetNote?.(linkItemPayload),
    copyLinkItem: (linkItemPayload) => linkItemPayload.handlers?.copy?.(linkItemPayload),
    createRelation: (relationBlankPayload) => relationBlankPayload.handlers?.create?.(relationBlankPayload),
    refreshRelations: (relationBlankPayload) => relationBlankPayload.handlers?.refresh?.(relationBlankPayload),
    showRelationSidebar: (relationBlankPayload) => relationBlankPayload.handlers?.showSidebar?.(relationBlankPayload),
    openRelationTarget: (relationItemPayload) => relationItemPayload.handlers?.openTarget?.(relationItemPayload),
    deleteRelation: (relationItemPayload) => relationItemPayload.handlers?.delete?.(relationItemPayload),
    openShortcuts: noop,
    openAbout: noop,
  });
}

export function ContextMenuHost() {
  const { request, closeContextMenu } = useContextMenu();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuSize, setMenuSize] = useState({ width: MENU_WIDTH_PX, height: MENU_MIN_HEIGHT_PX });

  const items = useMemo(() => (
    request ? buildContextMenuSchema(request.payload) : []
  ), [request]);

  const runner = useMemo(() => (
    request ? createContextRunner(request.payload) : null
  ), [request]);

  useLayoutEffect(() => {
    if (!request || !menuRef.current) {
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    setMenuSize({
      width: rect.width || MENU_WIDTH_PX,
      height: rect.height || MENU_MIN_HEIGHT_PX,
    });
  }, [items, request]);

  useEffect(() => {
    if (!request) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      closeContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeContextMenu, request]);

  if (!request || !runner) {
    return null;
  }

  const position = getMenuPosition(request.position, menuSize);

  return (
    <div className="context-menu-host" onContextMenu={(event) => event.preventDefault()}>
      <div
        ref={menuRef}
        role="menu"
        aria-label="右键菜单"
        className="context-menu"
        style={{ left: position.x, top: position.y }}
      >
        {items.map((item) => {
          const disabled = item.enabled === false;

          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`context-menu-item${disabled ? " is-disabled" : ""}`}
              aria-disabled={disabled ? "true" : "false"}
              tabIndex={disabled ? -1 : 0}
              onClick={() => {
                if (disabled) {
                  return;
                }

                void runner.run(item.id as MenuActionId, request.payload);
                closeContextMenu();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}