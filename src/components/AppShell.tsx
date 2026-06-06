import { AppHeader } from "./AppHeader";
import { StatusBar } from "./StatusBar";
import { LeftSidebar } from "./LeftSidebar/LeftSidebar";
import { EditorWorkspace } from "./EditorWorkspace/EditorWorkspace";
import { RightSidebar } from "./RightSidebar/RightSidebar";
import { useEffect, useMemo } from "react";
import type { MenuActionId } from "../menu/menuIds";
import { buildAppMenuSchema } from "../menu/menuSchema";
import { createMenuActionRunner } from "../menu/menuActionRunner";
import { useAppMenu } from "../menu/useAppMenu";
import { useSidebarResize } from "../hooks/useSidebarResize";
import { useAppStore } from "../store/useAppStore";
import { useAiSettingsStore } from "../store/useAiSettingsStore";
import { useEditorStore } from "../store/useEditorStore";
import { ContextMenuHost } from "./ContextMenu/ContextMenuHost";
import { ContextMenuProvider } from "./ContextMenu/useContextMenu";
import { AiSettingsDialog } from "./Settings/AiSettingsDialog";
import "../styles/layout.css";

const OPEN_SEARCH_EVENT = "mynote:open-search";
const REQUEST_CREATE_NOTE_EVENT = "mynote:menu-create-note";
const REQUEST_CREATE_NOTEBOOK_EVENT = "mynote:menu-create-notebook";
const REQUEST_IMPORT_NOTE_EVENT = "mynote:menu-import-note";
const REQUEST_RENAME_NOTE_EVENT = "mynote:menu-rename-note";
const REQUEST_MOVE_NOTE_EVENT = "mynote:menu-move-note";
const REQUEST_SHORTCUTS_EVENT = "mynote:menu-open-shortcuts";
const REQUEST_ABOUT_EVENT = "mynote:menu-open-about";

function dispatchWindowEvent(event: Event) {
  window.dispatchEvent(event);
}

async function writeClipboardText(text: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return;
  }

  await navigator.clipboard.writeText(text);
}

function ignoreAsyncError() {
  return undefined;
}

export function AppShell() {
  const kb = useAppStore((s) => s.kb);
  const leftSidebarVisible = useAppStore((s) => s.leftSidebarVisible);
  const rightSidebarVisible = useAppStore((s) => s.rightSidebarVisible);
  const setLeftSidebarVisible = useAppStore((s) => s.setLeftSidebarVisible);
  const setRightSidebarVisible = useAppStore((s) => s.setRightSidebarVisible);
  const toggleLeftSidebar = useAppStore((s) => s.toggleLeftSidebar);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const refreshTree = useAppStore((s) => s.refreshTree);
  const currentNote = useEditorStore((s) => s.currentNote);
  const editorMode = useEditorStore((s) => s.getEditorMode());
  const setEditorMode = useEditorStore((s) => s.setEditorMode);
  const aiSettings = useAiSettingsStore((s) => s.settings);
  const defaultAiProfile = useAiSettingsStore((s) => s.defaultProfile);
  const loadAiSettings = useAiSettingsStore((s) => s.loadSettings);
  const openAiSettings = useAiSettingsStore((s) => s.openDialog);
  const testAiConnection = useAiSettingsStore((s) => s.testDefaultProfile);
  const toggleAutoSummaryAgent = useAiSettingsStore((s) => s.toggleAutoSummaryAgent);

  useEffect(() => {
    void loadAiSettings().catch(() => undefined);
  }, [loadAiSettings]);

  const left = useSidebarResize({
    side: "left",
    defaultWidth: 240,
    minWidth: 120,
    maxWidth: 480,
    defaultVisible: true,
    visible: leftSidebarVisible,
    onVisibleChange: setLeftSidebarVisible,
  });
  const right = useSidebarResize({
    side: "right",
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 400,
    defaultVisible: false,
    visible: rightSidebarVisible,
    onVisibleChange: setRightSidebarVisible,
  });

  const menuSchema = useMemo(() => buildAppMenuSchema({
    hasKnowledgeBase: Boolean(kb),
    hasCurrentNote: Boolean(currentNote),
    leftSidebarVisible,
    rightSidebarVisible,
    editorMode,
    hasDefaultAiProfile: Boolean(defaultAiProfile),
    autoSummaryAgentEnabled: Boolean(aiSettings?.enabled && defaultAiProfile?.enabled),
  }), [aiSettings?.enabled, currentNote, defaultAiProfile, editorMode, kb, leftSidebarVisible, rightSidebarVisible]);

  const menuRunner = useMemo(() => createMenuActionRunner({
    createNote: () => dispatchWindowEvent(new Event(REQUEST_CREATE_NOTE_EVENT)),
    createNotebook: () => dispatchWindowEvent(new Event(REQUEST_CREATE_NOTEBOOK_EVENT)),
    importNote: () => dispatchWindowEvent(new Event(REQUEST_IMPORT_NOTE_EVENT)),
    openSearch: () => dispatchWindowEvent(new Event(OPEN_SEARCH_EVENT)),
    openAiSettings: () => openAiSettings(),
    testAiConnection: () => testAiConnection().catch(ignoreAsyncError),
    toggleAutoSummaryAgent: () => toggleAutoSummaryAgent().catch(ignoreAsyncError),
    toggleLeftSidebar: () => toggleLeftSidebar(),
    toggleRightSidebar: () => toggleRightSidebar(),
    setEditorMode: (mode) => setEditorMode(mode),
    openCurrentNote: () => undefined,
    moveCurrentNote: (payload) => dispatchWindowEvent(new CustomEvent(REQUEST_MOVE_NOTE_EVENT, { detail: payload })),
    renameCurrentNote: (payload) => dispatchWindowEvent(new CustomEvent(REQUEST_RENAME_NOTE_EVENT, { detail: payload })),
    copyCurrentNoteLink: async () => {
      if (!currentNote) {
        return;
      }
      await writeClipboardText(currentNote.path);
    },
    copyCurrentNoteWikiLink: async () => {
      if (!currentNote) {
        return;
      }
      await writeClipboardText(`[[${currentNote.title}]]`);
    },
    createNoteInNotebook: () => undefined,
    renameNotebook: () => undefined,
    reorderNotebook: () => undefined,
    deleteNotebook: () => undefined,
    deleteTag: () => undefined,
    insertLinkFromSelection: () => undefined,
    insertTagFromSelection: () => undefined,
    createWikiLinkFromSelection: () => undefined,
    refreshIndex: () => refreshTree(),
    showLeftSidebar: () => setLeftSidebarVisible(true),
    openShortcuts: () => dispatchWindowEvent(new Event(REQUEST_SHORTCUTS_EVENT)),
    openAbout: () => dispatchWindowEvent(new Event(REQUEST_ABOUT_EVENT)),
  }), [
    currentNote,
    openAiSettings,
    refreshTree,
    setEditorMode,
    setLeftSidebarVisible,
    testAiConnection,
    toggleAutoSummaryAgent,
    toggleLeftSidebar,
    toggleRightSidebar,
  ]);

  const runMenuAction = useMemo(
    () => (actionId: MenuActionId) => {
      const requiresCurrentNote = actionId.startsWith("edit.") || actionId.startsWith("note.");
      if (requiresCurrentNote && !currentNote) {
        return false;
      }

      return menuRunner.run(actionId, currentNote ? {
        type: "note",
        noteId: currentNote.id,
        path: currentNote.path,
      } : undefined);
    },
    [currentNote, menuRunner],
  );

  useAppMenu({
    items: menuSchema,
    run: runMenuAction,
  });

  return (
    <ContextMenuProvider>
      <div className="app-shell">
        <AppHeader />
        <div className="app-body">
          {/* Left sidebar */}
          <div className="sidebar-container" style={{ width: left.isVisible ? left.width : 0 }}>
            {left.isVisible && (
              <aside className="left-sidebar" style={{ width: left.width }}>
                <LeftSidebar />
              </aside>
            )}
          </div>
          <div
            className={`resize-handle resize-handle-left${left.isVisible ? "" : " hidden"}`}
            onMouseDown={left.handleMouseDown}
          >
            <button
              className="sidebar-toggle sidebar-toggle-left"
              onClick={left.toggleVisible}
              title={left.isVisible ? "收起左侧栏" : "展开左侧栏"}
            >
              {left.isVisible ? "‹" : "›"}
            </button>
          </div>

          {/* Editor */}
          <main className="editor-workspace">
            <EditorWorkspace />
          </main>

          {/* Right sidebar */}
          <div
            className={`resize-handle resize-handle-right${right.isVisible ? "" : " hidden"}`}
            onMouseDown={right.handleMouseDown}
          >
            <button
              className="sidebar-toggle sidebar-toggle-right"
              onClick={right.toggleVisible}
              title={right.isVisible ? "收起右侧栏" : "展开右侧栏"}
            >
              {right.isVisible ? "›" : "‹"}
            </button>
          </div>
          <div className="sidebar-container" style={{ width: right.isVisible ? right.width : 0 }}>
            {right.isVisible && (
              <aside className="right-sidebar" style={{ width: right.width }}>
                <RightSidebar />
              </aside>
            )}
          </div>
        </div>
        <StatusBar />
        <AiSettingsDialog />
        <ContextMenuHost />
      </div>
    </ContextMenuProvider>
  );
}
