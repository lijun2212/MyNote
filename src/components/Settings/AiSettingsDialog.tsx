import { useEffect, useState } from "react";
import type { AiProfileInput, AiProviderKind } from "../../types";
import { useAiSettingsStore } from "../../store/useAiSettingsStore";

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.24)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  width: "min(720px, 100%)",
  maxHeight: "min(780px, calc(100vh - 48px))",
  overflow: "auto",
  background: "#ffffff",
  border: "1px solid #d7dce5",
  borderRadius: 14,
  boxShadow: "0 20px 48px rgba(15, 23, 42, 0.18)",
  padding: 20,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #c7ced9",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
  color: "#243041",
  background: "#fff",
};

const actionButtonStyle: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid #c7ced9",
  background: "#fff",
  color: "#243041",
  padding: "10px 14px",
  fontSize: 14,
  cursor: "pointer",
};

type FormState = {
  id?: string | null;
  name: string;
  provider: AiProviderKind;
  model: string;
  base_url: string;
  max_tokens: string;
  temperature: string;
  enabled: boolean;
};

function createFormState(profile: ReturnType<typeof useAiSettingsStore.getState>["defaultProfile"]): FormState {
  return {
    id: profile?.id ?? null,
    name: profile?.name ?? "默认配置",
    provider: profile?.provider ?? "anthropic",
    model: profile?.model ?? "",
    base_url: profile?.base_url ?? "",
    max_tokens: profile?.max_tokens?.toString() ?? "",
    temperature: profile?.temperature?.toString() ?? "",
    enabled: profile?.enabled ?? true,
  };
}

function normalizeNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatTestStatus(status: ReturnType<typeof useAiSettingsStore.getState>["lastTestResult"] extends infer TResult
  ? TResult extends { status: infer TStatus }
    ? TStatus
    : never
  : never) {
  switch (status) {
    case "ok":
      return "成功";
    case "failed":
      return "失败";
    case "missing_secret":
      return "缺少密钥";
    case "keychain_unavailable":
      return "密钥链不可用";
    case "not_implemented":
      return "未实现";
    default:
      return String(status ?? "未知");
  }
}

export function AiSettingsDialog() {
  const isDialogOpen = useAiSettingsStore((state) => state.isDialogOpen);
  const closeDialog = useAiSettingsStore((state) => state.closeDialog);
  const settings = useAiSettingsStore((state) => state.settings);
  const defaultProfile = useAiSettingsStore((state) => state.defaultProfile);
  const isLoading = useAiSettingsStore((state) => state.isLoading);
  const isSaving = useAiSettingsStore((state) => state.isSaving);
  const isTesting = useAiSettingsStore((state) => state.isTesting);
  const error = useAiSettingsStore((state) => state.error);
  const lastTestResult = useAiSettingsStore((state) => state.lastTestResult);
  const toggleAutoSummaryAgent = useAiSettingsStore((state) => state.toggleAutoSummaryAgent);
  const saveDefaultProfile = useAiSettingsStore((state) => state.saveDefaultProfile);
  const testProfileInput = useAiSettingsStore((state) => state.testProfileInput);
  const [form, setForm] = useState<FormState>(() => createFormState(defaultProfile));
  const [apiKey, setApiKey] = useState("");
  const [savedApiKeyForSession, setSavedApiKeyForSession] = useState<string | null>(null);

  const handleToggleAutoSummaryAgent = () => {
    void toggleAutoSummaryAgent().catch(() => undefined);
  };

  const handleSaveClick = () => {
    void handleSave().catch(() => undefined);
  };

  const handleTestDefaultProfile = () => {
    const input: AiProfileInput = {
      id: form.id ?? null,
      name: form.name.trim(),
      provider: form.provider,
      model: form.model.trim(),
      base_url: form.base_url.trim() || null,
      max_tokens: normalizeNumber(form.max_tokens),
      temperature: normalizeNumber(form.temperature),
      enabled: form.enabled,
    };

    const nextApiKey = apiKey.trim() || savedApiKeyForSession || null;
    void testProfileInput(input, nextApiKey).catch(() => undefined);
  };

  useEffect(() => {
    if (!isDialogOpen) {
      return;
    }

    setForm(createFormState(defaultProfile));
    setApiKey("");
    setSavedApiKeyForSession(null);
  }, [defaultProfile, isDialogOpen]);

  if (!isDialogOpen) {
    return null;
  }

  const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    const input: AiProfileInput = {
      id: form.id ?? null,
      name: form.name.trim(),
      provider: form.provider,
      model: form.model.trim(),
      base_url: form.base_url.trim() || null,
      max_tokens: normalizeNumber(form.max_tokens),
      temperature: normalizeNumber(form.temperature),
      enabled: form.enabled,
    };

    const normalizedApiKey = apiKey.trim();
    const savedProfile = await saveDefaultProfile(input, normalizedApiKey);
    setForm(createFormState(savedProfile));
    setApiKey("");
    setSavedApiKeyForSession(normalizedApiKey || savedApiKeyForSession);
  };

  return (
    <div style={overlayStyle}>
      <div aria-label="AI 设置" aria-modal="true" role="dialog" style={dialogStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: "#111827" }}>AI 设置</h2>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#5b6472" }}>
              先配置默认 profile，用于摘要生成与连接测试。
            </p>
          </div>
          <button onClick={closeDialog} style={actionButtonStyle} type="button">关闭</button>
        </div>

        <div aria-label="默认 profile" style={{ marginTop: 16, padding: 12, borderRadius: 10, background: "#f7f9fc", color: "#334155", fontSize: 14 }}>
          默认 profile：{defaultProfile?.name ?? "未配置"}
        </div>

        <label style={{ ...fieldStyle, marginTop: 16 }}>
          <span style={{ fontSize: 13, color: "#475467" }}>全局 AI 摘要</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              aria-label="全局 AI 摘要开关"
              checked={Boolean(settings?.enabled)}
              disabled={isSaving}
              onChange={handleToggleAutoSummaryAgent}
              type="checkbox"
            />
            <span>{settings?.enabled ? "已启用" : "已关闭"}</span>
          </span>
        </label>

        <div style={{ ...gridStyle, marginTop: 16 }}>
          <label style={fieldStyle}>
            <span>名称</span>
            <input aria-label="名称" onChange={(event) => handleChange("name", event.target.value)} style={inputStyle} type="text" value={form.name} />
          </label>
          <label style={fieldStyle}>
            <span>Provider</span>
            <select aria-label="Provider" onChange={(event) => handleChange("provider", event.target.value as AiProviderKind)} style={inputStyle} value={form.provider}>
              <option value="anthropic">Anthropic</option>
              <option value="open_ai_compatible">OpenAI Compatible</option>
            </select>
          </label>
          <label style={fieldStyle}>
            <span>模型</span>
            <input aria-label="模型" onChange={(event) => handleChange("model", event.target.value)} style={inputStyle} type="text" value={form.model} />
          </label>
          <label style={fieldStyle}>
            <span>Base URL</span>
            <input aria-label="Base URL" onChange={(event) => handleChange("base_url", event.target.value)} style={inputStyle} type="text" value={form.base_url} />
          </label>
          <label style={fieldStyle}>
            <span>最大 Tokens</span>
            <input aria-label="最大 Tokens" onChange={(event) => handleChange("max_tokens", event.target.value)} style={inputStyle} type="number" value={form.max_tokens} />
          </label>
          <label style={fieldStyle}>
            <span>Temperature</span>
            <input aria-label="Temperature" onChange={(event) => handleChange("temperature", event.target.value)} step="0.1" style={inputStyle} type="number" value={form.temperature} />
          </label>
          <label style={fieldStyle}>
            <span>Profile 启用</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 42 }}>
              <input aria-label="Profile 启用开关" checked={form.enabled} onChange={(event) => handleChange("enabled", event.target.checked)} type="checkbox" />
              <span>{form.enabled ? "已启用" : "已禁用"}</span>
            </span>
          </label>
          <label style={fieldStyle}>
            <span>API Key</span>
            <input aria-label="API Key" onChange={(event) => setApiKey(event.target.value)} placeholder="留空则不更新" style={inputStyle} type="password" value={apiKey} />
            {savedApiKeyForSession && !apiKey ? (
              <span style={{ fontSize: 12, color: "#667085" }}>已保存到系统密钥链，本次会话可直接测试；留空则不更新。</span>
            ) : null}
          </label>
        </div>

        {(isLoading || error || lastTestResult) ? (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: "#fbfcfe", border: "1px solid #e5e7eb", fontSize: 13 }}>
            {isLoading ? <div>加载 AI 设置中...</div> : null}
            {error ? <div style={{ color: "#b42318" }}>{error}</div> : null}
            {lastTestResult ? <div>{lastTestResult.message}</div> : null}
            {lastTestResult ? (
              <div aria-label="AI 测试详情" style={{ marginTop: 12, borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#344054", marginBottom: 8 }}>测试详情</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 10 }}>
                  <div>
                    <div style={{ color: "#667085", fontSize: 11 }}>状态</div>
                    <div>{formatTestStatus(lastTestResult.status)}</div>
                  </div>
                  {lastTestResult.error_kind ? (
                    <div>
                      <div style={{ color: "#667085", fontSize: 11 }}>错误类型</div>
                      <div>{lastTestResult.error_kind}</div>
                    </div>
                  ) : null}
                  {typeof lastTestResult.retryable === "boolean" ? (
                    <div>
                      <div style={{ color: "#667085", fontSize: 11 }}>是否可重试</div>
                      <div>{lastTestResult.retryable ? "可重试" : "不可重试"}</div>
                    </div>
                  ) : null}
                  {lastTestResult.total_tokens != null ? (
                    <div>
                      <div style={{ color: "#667085", fontSize: 11 }}>总 Tokens</div>
                      <div>{lastTestResult.total_tokens}</div>
                    </div>
                  ) : null}
                  {lastTestResult.latency_ms != null ? (
                    <div>
                      <div style={{ color: "#667085", fontSize: 11 }}>耗时</div>
                      <div>{lastTestResult.latency_ms} ms</div>
                    </div>
                  ) : null}
                </div>
                <div style={{ color: "#667085", fontSize: 11, marginBottom: 6 }}>日志</div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, color: "#243041", fontSize: 12 }}>
                  {lastTestResult.message}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}>
          <button
            disabled={isTesting || isSaving}
            onClick={handleTestDefaultProfile}
            style={{
              ...actionButtonStyle,
              cursor: isTesting || isSaving ? "not-allowed" : "pointer",
              opacity: isTesting || isSaving ? 0.7 : 1,
            }}
            type="button"
          >
            {isTesting ? "测试中..." : "测试连接"}
          </button>
          <button disabled={isSaving} onClick={handleSaveClick} style={{ ...actionButtonStyle, background: "#243041", borderColor: "#243041", color: "#fff" }} type="button">
            {isSaving ? "保存中..." : "保存设置"}
          </button>
        </div>
      </div>
    </div>
  );
}