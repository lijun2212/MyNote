import { AppHeader } from "./AppHeader";
import { StatusBar } from "./StatusBar";
import { LeftSidebar } from "./LeftSidebar/LeftSidebar";
import { EditorWorkspace } from "./EditorWorkspace/EditorWorkspace";
import { RightSidebar } from "./RightSidebar/RightSidebar";
import { useSidebarResize } from "../hooks/useSidebarResize";
import "../styles/layout.css";

export function AppShell() {
  const left = useSidebarResize({
    side: "left",
    defaultWidth: 240,
    minWidth: 120,
    maxWidth: 480,
    defaultVisible: true,
  });
  const right = useSidebarResize({
    side: "right",
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 400,
    defaultVisible: false,
  });

  return (
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
    </div>
  );
}
