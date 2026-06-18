import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import appReleaseMetadata from "../../config/appReleaseMetadata.json";
import {
  checkForManualUpdate,
  installManualUpdate,
  type ManualUpdateCheckResult,
} from "../../updater/manualUpdate";
import appIconSrc from "../../../src-tauri/icons/128x128.png";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  onCheckForUpdates?: () => Promise<ManualUpdateCheckResult>;
  autoCheckRequest?: number;
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

const actionButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.32)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.92) 100%)",
  color: "#0f172a",
  borderRadius: "12px",
  padding: "10px 14px",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
};

const updateNoticeStyle: React.CSSProperties = {
  marginTop: "8px",
  padding: "12px 14px",
  borderRadius: "14px",
  background: "rgba(241, 245, 249, 0.85)",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  display: "grid",
  gap: "6px",
};

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; currentVersion: string }
  | { status: "release-page"; releasePageUrl: string }
  | {
      status: "update-available";
      currentVersion: string;
      version: string;
      date?: string;
      body?: string;
      update: Extract<ManualUpdateCheckResult, { status: "update-available" }>;
    }
  | { status: "installing"; version: string }
  | { status: "installed"; version: string }
  | { status: "error"; message: string };

function toErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "检查更新失败";
}

export function AboutDialog({ open, onClose, onCheckForUpdates = checkForManualUpdate, autoCheckRequest = 0 }: AboutDialogProps) {
  const [appVersion, setAppVersion] = useState<string>("版本读取中...");
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle" });

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

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    setAppVersion("版本读取中...");
    setUpdateState({ status: "idle" });

    void getVersion()
      .then((version) => {
        if (active) {
          setAppVersion(version);
        }
      })
      .catch(() => {
        if (active) {
          setAppVersion("版本信息不可用");
        }
      });

    return () => {
      active = false;
    };
  }, [open]);

  const handleCheckForUpdates = async () => {
    setUpdateState({ status: "checking" });

    try {
      const result = await onCheckForUpdates();
      if (result.status === "up-to-date") {
        setUpdateState({
          status: "up-to-date",
          currentVersion: result.currentVersion,
        });
        return;
      }

      if (result.status === "release-page") {
        setUpdateState({
          status: "release-page",
          releasePageUrl: result.releasePageUrl,
        });
        return;
      }

      setUpdateState({
        status: "update-available",
        currentVersion: result.currentVersion,
        version: result.version,
        date: result.date,
        body: result.body,
        update: result,
      });
    } catch (error) {
      setUpdateState({ status: "error", message: toErrorMessage(error) });
    }
  };

  const handleInstallUpdate = async () => {
    if (updateState.status !== "update-available") {
      return;
    }

    const confirmed = window.confirm(`发现新版本 ${updateState.version}，是否立即下载并安装？`);
    if (!confirmed) {
      return;
    }

    setUpdateState({ status: "installing", version: updateState.version });

    try {
      await installManualUpdate(updateState.update);
      setUpdateState({ status: "installed", version: updateState.version });
    } catch (error) {
      setUpdateState({ status: "error", message: toErrorMessage(error) });
    }
  };

  useEffect(() => {
    if (!open || autoCheckRequest === 0) {
      return;
    }

    void handleCheckForUpdates();
  }, [autoCheckRequest, open]);

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
              <p style={{ margin: "8px 0 0", color: "#475569" }}>版本 {appVersion}</p>
            </div>
          </div>
          <button aria-label="关闭关于弹窗" onClick={onClose} style={closeButtonStyle} type="button">×</button>
        </div>

        <div style={{ marginTop: "18px", display: "grid", gap: "14px", color: "#334155" }}>
          <p style={{ margin: 0 }}>本地优先的个人知识库与笔记应用</p>
          <p style={{ margin: 0 }}>帮助用户记录、整理并沉淀自己的知识与日常</p>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <button onClick={() => void handleCheckForUpdates()} style={actionButtonStyle} type="button">检查更新</button>
            {updateState.status === "checking" && <span>正在检查更新...</span>}
          </div>
          {updateState.status === "up-to-date" && (
            <div style={updateNoticeStyle}>
              <p style={{ margin: 0, color: "#0f172a" }}>当前已是最新版本 {updateState.currentVersion}</p>
            </div>
          )}
          {updateState.status === "release-page" && (
            <div style={updateNoticeStyle}>
              <p style={{ margin: 0, color: "#0f172a" }}>已打开发布页，请下载最新安装包完成手动更新。</p>
              <p style={{ margin: 0, wordBreak: "break-all" }}>{updateState.releasePageUrl}</p>
            </div>
          )}
          {updateState.status === "update-available" && (
            <div style={updateNoticeStyle}>
              <p style={{ margin: 0, color: "#0f172a", fontWeight: 600 }}>发现新版本 {updateState.version}</p>
              {updateState.date && <p style={{ margin: 0 }}>发布时间：{updateState.date}</p>}
              {updateState.body && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{updateState.body}</p>}
              <div>
                <button onClick={() => void handleInstallUpdate()} style={actionButtonStyle} type="button">立即更新</button>
              </div>
            </div>
          )}
          {updateState.status === "installing" && (
            <div style={updateNoticeStyle}>
              <p style={{ margin: 0 }}>正在下载并安装版本 {updateState.version}...</p>
            </div>
          )}
          {updateState.status === "installed" && (
            <div style={updateNoticeStyle}>
              <p style={{ margin: 0 }}>版本 {updateState.version} 已安装，应用即将完成更新。</p>
            </div>
          )}
          {updateState.status === "error" && (
            <div style={updateNoticeStyle}>
              <p style={{ margin: 0, color: "#991b1b" }}>{updateState.message}</p>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "14px 18px", marginTop: "4px" }}>
            <div>
              <p style={metaLabelStyle}>开发者</p>
              <p style={metaValueStyle}>个人开发者 LJ</p>
            </div>
            <div>
              <p style={metaLabelStyle}>发布时间</p>
              <p style={metaValueStyle}>{appReleaseMetadata.releaseDate}</p>
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