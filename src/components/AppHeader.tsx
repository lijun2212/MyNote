import { useAppStore } from "../store/useAppStore";

export function AppHeader() {
  const kb = useAppStore((s) => s.kb);
  return (
    <header className="app-header">
      <span style={{ fontWeight: 600, fontSize: 14 }}>
        {kb ? kb.name : "MyNote"}
      </span>
    </header>
  );
}
