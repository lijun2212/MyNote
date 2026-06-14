import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { SearchOverlay } from "./SearchOverlay";

const OPEN_SEARCH_EVENT = "mynote:open-search";

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      style={{
        width: 15,
        height: 15,
        display: "block",
        stroke: "currentColor",
        strokeWidth: 1.8,
        fill: "none",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }}
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25 13 13" />
    </svg>
  );
}

export function AppHeader() {
  const kb = useAppStore((s) => s.kb);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchButtonHovered, setSearchButtonHovered] = useState(false);

  useEffect(() => {
    const openSearch = () => setSearchOpen(true);
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener(OPEN_SEARCH_EVENT, openSearch);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener(OPEN_SEARCH_EVENT, openSearch);
    };
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
            onMouseEnter={() => setSearchButtonHovered(true)}
            onMouseLeave={() => setSearchButtonHovered(false)}
            style={{
              background: "transparent",
              border: "none",
              color: searchButtonHovered ? "#0969da" : "#475467",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: "4px 6px",
              marginLeft: "auto",
              transition: "color 180ms ease",
            }}
            title="搜索 (⌘K)"
          >
            <SearchIcon />
          </button>
        )}
      </header>
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </>
  );
}
