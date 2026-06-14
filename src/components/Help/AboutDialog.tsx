import { useEffect } from "react";
import appIconSrc from "../../../src-tauri/icons/128x128.png";

interface AboutDialogProps {
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
  width: "min(560px, 100%)",
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

const appIconFrameStyle: React.CSSProperties = {
  width: "68px",
  height: "68px",
  borderRadius: "20px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.92) 100%)",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  boxShadow: "0 16px 36px rgba(15, 23, 42, 0.12)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const appIconStyle: React.CSSProperties = {
  width: "52px",
  height: "52px",
  borderRadius: "14px",
  display: "block",
  objectFit: "cover",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.16)",
};

const metaLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "12px",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#64748b",
};

const metaValueStyle: React.CSSProperties = {
  margin: "4px 0 0",
  color: "#0f172a",
  fontSize: "14px",
  fontWeight: 400,
};

export function AboutDialog({ open, onClose }: AboutDialogProps) {
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
      data-testid="about-dialog-overlay"
      onClick={onClose}
      style={overlayStyle}
    >
      <div
        aria-label="关于 MyNote"
        aria-modal="true"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        style={panelStyle}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={appIconFrameStyle}>
              <img alt="MyNote 应用图标" src={appIconSrc} style={appIconStyle} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "24px" }}>MyNote</h2>
              <p style={{ margin: "8px 0 0", color: "#475569" }}>版本 0.1.0</p>
            </div>
          </div>
          <button aria-label="关闭关于弹窗" onClick={onClose} style={closeButtonStyle} type="button">×</button>
        </div>

        <div style={{ marginTop: "18px", display: "grid", gap: "14px", color: "#334155" }}>
          <p style={{ margin: 0 }}>本地优先的个人知识库与笔记应用</p>
          <p style={{ margin: 0 }}>帮助用户记录、整理并沉淀自己的知识与日常</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 18px", marginTop: "4px" }}>
            <div>
              <p style={metaLabelStyle}>开发者</p>
              <p style={metaValueStyle}>个人开发者 LJ</p>
            </div>
            <div>
              <p style={metaLabelStyle}>更新时间</p>
              <p style={metaValueStyle}>2026 年 6 月</p>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <p style={metaLabelStyle}>版权信息</p>
              <p style={metaValueStyle}>Copyright © 2026 LJ. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}