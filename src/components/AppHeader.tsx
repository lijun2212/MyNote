import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { SearchOverlay } from "./SearchOverlay";

export function AppHeader() {
  const kb = useAppStore((s) => s.kb);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <header className="app-header">
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {kb ? kb.name : "MyNote"}
        </span>
        {kb && (
          <button
            onClick={() => setSearchOpen(true)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
              padding: "2px 6px",
              marginLeft: "auto",
              opacity: 0.7,
            }}
            title="搜索 (⌘K)"
          >
            🔍
          </button>
        )}
      </header>
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </>
  );
}
