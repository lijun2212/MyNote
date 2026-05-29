import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";

export function WelcomeScreen() {
  const { setKb, refreshTree, setError } = useAppStore();

  async function handleCreate() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    const name = selected.split("/").pop() || "我的知识库";
    try {
      const kb = await api.createKnowledgeBase(selected, name);
      setKb(kb);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleOpen() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    try {
      const kb = await api.openKnowledgeBase(selected);
      setKb(kb);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      background: "#f6f8fa",
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>MyNote</h1>
      <p style={{ color: "#6e7681", marginBottom: 24 }}>个人 Markdown 知识库</p>
      <button
        onClick={handleCreate}
        style={{ padding: "10px 24px", fontSize: 15, cursor: "pointer", borderRadius: 6, border: "1px solid #ccc", background: "#0969da", color: "#fff" }}
      >
        新建知识库
      </button>
      <button
        onClick={handleOpen}
        style={{ padding: "10px 24px", fontSize: 15, cursor: "pointer", borderRadius: 6, border: "1px solid #ccc", background: "#fff" }}
      >
        打开知识库
      </button>
    </div>
  );
}
