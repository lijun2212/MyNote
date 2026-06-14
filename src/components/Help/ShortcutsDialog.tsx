import { useEffect } from "react";

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.34)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  zIndex: 1200,
};

const panelStyle: React.CSSProperties = {
  width: "min(680px, 100%)",
  maxHeight: "min(720px, calc(100vh - 48px))",
  overflow: "auto",
  borderRadius: "18px",
  background: "#fffdf8",
  boxShadow: "0 28px 80px rgba(15, 23, 42, 0.18)",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  padding: "24px 24px 20px",
};

const closeButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: "20px",
  lineHeight: 1,
  cursor: "pointer",
  color: "#334155",
};

const sectionStyle: React.CSSProperties = {
  marginTop: "18px",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  padding: "10px 0",
  borderBottom: "1px solid rgba(226, 232, 240, 0.8)",
};

function ShortcutRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={rowStyle}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="shortcuts-dialog-overlay"
      onClick={onClose}
      style={overlayStyle}
    >
      <div
        aria-label="快捷键"
        aria-modal="true"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        style={panelStyle}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "24px" }}>快捷键</h2>
            <p style={{ margin: "8px 0 0", color: "#475569" }}>当前可用的主要键盘操作与菜单切换说明。</p>
          </div>
          <button aria-label="关闭快捷键弹窗" onClick={onClose} style={closeButtonStyle} type="button">×</button>
        </div>

        <section style={sectionStyle}>
          <h3>全局</h3>
          <ShortcutRow label="搜索" value="⌘K" />
          <ShortcutRow label="关闭当前弹窗" value="Esc" />
        </section>

        <section style={sectionStyle}>
          <h3>编辑与布局</h3>
          <ShortcutRow label="仅编辑器" value="菜单切换" />
          <ShortcutRow label="分栏编辑" value="菜单切换" />
          <ShortcutRow label="粘贴文本/图片" value="⌘V" />
        </section>

        <section style={sectionStyle}>
          <h3>笔记链接与关联</h3>
          <ShortcutRow label="复制当前笔记链接" value="⌘L" />
          <ShortcutRow label="复制当前笔记 Wiki 链接" value="⌘⇧W" />
        </section>

        <section style={sectionStyle}>
          <h3>搜索</h3>
          <ShortcutRow label="上一项" value="↑" />
          <ShortcutRow label="下一项" value="↓" />
          <ShortcutRow label="打开命中" value="Enter" />
          <ShortcutRow label="关闭搜索" value="Esc" />
        </section>
      </div>
    </div>
  );
}