import { useState } from "react";
import { FileTreePanel } from "./FileTreePanel";
import { TagPanel } from "./TagPanel";
import { useAppStore } from "../../store/useAppStore";

type Tab = "files" | "tags";

export function LeftSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("files");
  const setSelectedTagIds = useAppStore((s) => s.setSelectedTagIds);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Tab bar */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid #e0e2e7",
        flexShrink: 0,
        background: "#fafbfc",
      }}>
        {(["files", "tags"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              if (tab === "files") setSelectedTagIds([]);
              setActiveTab(tab);
            }}
            style={{
              flex: 1,
              padding: "7px 0",
              fontSize: 12,
              background: "none",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid #1a73e8" : "2px solid transparent",
              color: activeTab === tab ? "#1a73e8" : "#555",
              cursor: "pointer",
              fontWeight: activeTab === tab ? 600 : 400,
            }}
          >
            {tab === "files" ? "文件" : "标签"}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {activeTab === "files" ? <FileTreePanel /> : <TagPanel />}
      </div>
    </div>
  );
}
