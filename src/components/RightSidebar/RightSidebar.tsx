import { useState } from "react";
import { useEditorStore } from "../../store/useEditorStore";
import { BacklinksPanel } from "./BacklinksPanel";

type Tab = "outline" | "links";

export function RightSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("outline");
  const currentNote = useEditorStore((s) => s.currentNote);
  const noteId = currentNote?.id ?? null;

  const tabBarStyle: React.CSSProperties = {
    display: "flex",
    borderBottom: "1px solid #e0e2e7",
    background: "#fafbfc",
    flexShrink: 0,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "6px 4px",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? "var(--color-accent, #5b6af9)" : "#666",
    borderBottom: active ? "2px solid var(--color-accent, #5b6af9)" : "2px solid transparent",
    cursor: "pointer",
    textAlign: "center",
    background: "none",
    border: "none",
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    borderBottomColor: active ? "var(--color-accent, #5b6af9)" : "transparent",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontSize: 13 }}>
      <div style={tabBarStyle}>
        <button style={tabStyle(activeTab === "outline")} onClick={() => setActiveTab("outline")}>
          大纲
        </button>
        <button style={tabStyle(activeTab === "links")} onClick={() => setActiveTab("links")}>
          链接
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {activeTab === "outline" && (
          <div style={{ padding: 12, color: "#999" }}>大纲（待实现）</div>
        )}
        {activeTab === "links" && <BacklinksPanel noteId={noteId} />}
      </div>
    </div>
  );
}
