import { AppHeader } from "./AppHeader";
import { StatusBar } from "./StatusBar";
import { LeftSidebar } from "./LeftSidebar/LeftSidebar";
import { EditorWorkspace } from "./EditorWorkspace/EditorWorkspace";
import { RightSidebar } from "./RightSidebar/RightSidebar";
import "../styles/layout.css";

export function AppShell() {
  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-body">
        <aside className="left-sidebar">
          <LeftSidebar />
        </aside>
        <main className="editor-workspace">
          <EditorWorkspace />
        </main>
        <aside className="right-sidebar">
          <RightSidebar />
        </aside>
      </div>
      <StatusBar />
    </div>
  );
}
