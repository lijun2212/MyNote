import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSettingsStore } from "./useAiSettingsStore";
import type { AiProfile, AiProfileTestResult, AiSettings } from "../types";

const apiMocks = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  upsertAiProfile: vi.fn(),
  saveAiSettings: vi.fn(),
  setAiProfileSecret: vi.fn(),
  hasAiProfileSecret: vi.fn(),
  testAiProfile: vi.fn(),
  testAiProfileInput: vi.fn(),
}));

vi.mock("../api/commands", () => ({
  api: apiMocks,
}));

function makeProfile(overrides: Partial<AiProfile> = {}): AiProfile {
  return {
    id: "profile-1",
    name: "Default",
    provider: "anthropic",
    model: "claude-sonnet",
    base_url: null,
    max_tokens: 1024,
    temperature: 0.4,
    enabled: true,
    ...overrides,
  };
}

function makeSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    enabled: true,
    default_profile_id: "profile-1",
    profiles: [makeProfile()],
    ...overrides,
  };
}

function makeTestResult(overrides: Partial<AiProfileTestResult> = {}): AiProfileTestResult {
  return {
    success: true,
    status: "ok",
    message: "ok",
    error_kind: null,
    retryable: false,
    text: "pong",
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    latency_ms: 120,
    ...overrides,
  };
}

describe("useAiSettingsStore", () => {
  beforeEach(() => {
    apiMocks.getAiSettings.mockReset();
    apiMocks.upsertAiProfile.mockReset();
    apiMocks.saveAiSettings.mockReset();
    apiMocks.setAiProfileSecret.mockReset();
    apiMocks.hasAiProfileSecret.mockReset();
    apiMocks.testAiProfile.mockReset();
    apiMocks.testAiProfileInput.mockReset();
    apiMocks.hasAiProfileSecret.mockResolvedValue(true);
    useAiSettingsStore.getState().resetForTest();
  });

  it("loads AI settings and resolves the default profile", async () => {
    const settings = makeSettings();
    apiMocks.getAiSettings.mockResolvedValue(settings);

    await useAiSettingsStore.getState().loadSettings();

    expect(apiMocks.getAiSettings).toHaveBeenCalledTimes(1);
    expect(useAiSettingsStore.getState().settings).toEqual(settings);
    expect(useAiSettingsStore.getState().defaultProfile?.id).toBe("profile-1");
    expect(useAiSettingsStore.getState().isLoading).toBe(false);
  });

  it("opens and closes the placeholder dialog state", async () => {
    apiMocks.getAiSettings.mockResolvedValue(makeSettings());

    useAiSettingsStore.getState().openDialog();
    expect(useAiSettingsStore.getState().isDialogOpen).toBe(true);

    await Promise.resolve();
    expect(apiMocks.getAiSettings).toHaveBeenCalledTimes(1);

    useAiSettingsStore.getState().closeDialog();
    expect(useAiSettingsStore.getState().isDialogOpen).toBe(false);
  });

  it("toggles the global AI enabled flag and persists it", async () => {
    const settings = makeSettings();
    apiMocks.getAiSettings.mockResolvedValue(settings);
    apiMocks.saveAiSettings.mockResolvedValue({ ...settings, enabled: false });

    await useAiSettingsStore.getState().loadSettings();
    await useAiSettingsStore.getState().toggleAutoSummaryAgent();

    expect(apiMocks.saveAiSettings).toHaveBeenCalledWith(false, "profile-1");
    expect(useAiSettingsStore.getState().settings?.enabled).toBe(false);
    expect(useAiSettingsStore.getState().defaultProfile?.enabled).toBe(true);
    expect(useAiSettingsStore.getState().isSaving).toBe(false);
  });

  it("tests the default profile and stores the latest result", async () => {
    const settings = makeSettings();
    const result = makeTestResult();
    apiMocks.getAiSettings.mockResolvedValue(settings);
    apiMocks.testAiProfile.mockResolvedValue(result);

    await useAiSettingsStore.getState().loadSettings();
    await useAiSettingsStore.getState().testDefaultProfile();

    expect(apiMocks.testAiProfile).toHaveBeenCalledWith("profile-1");
    expect(useAiSettingsStore.getState().lastTestResult).toEqual(result);
    expect(useAiSettingsStore.getState().isTesting).toBe(false);
  });

  it("tests unsaved profile input and stores the latest result", async () => {
    const result = makeTestResult({ message: "draft ok" });
    apiMocks.testAiProfileInput.mockResolvedValue(result);

    await useAiSettingsStore.getState().testProfileInput({
      id: null,
      name: "Draft",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      base_url: null,
      temperature: 0.2,
      max_tokens: 2048,
      enabled: true,
    }, "sk-draft");

    expect(apiMocks.testAiProfileInput).toHaveBeenCalledWith({
      id: null,
      name: "Draft",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      base_url: null,
      temperature: 0.2,
      max_tokens: 2048,
      enabled: true,
    }, "sk-draft");
    expect(useAiSettingsStore.getState().lastTestResult).toEqual(result);
    expect(useAiSettingsStore.getState().isTesting).toBe(false);
  });

  it("saves the default profile and persists the api key when provided", async () => {
    apiMocks.getAiSettings.mockResolvedValue(makeSettings({ default_profile_id: null, profiles: [] }));
    apiMocks.saveAiSettings.mockResolvedValue(makeSettings({
      enabled: true,
      default_profile_id: "profile-2",
      profiles: [makeProfile({
        id: "profile-2",
        name: "Primary",
        model: "claude-3-7-sonnet",
        base_url: "https://example.test/v1",
        temperature: 0.2,
        max_tokens: 2048,
      })],
    }));
    apiMocks.upsertAiProfile.mockResolvedValue(makeProfile({
      id: "profile-2",
      name: "Primary",
      model: "claude-3-7-sonnet",
      base_url: "https://example.test/v1",
      temperature: 0.2,
      max_tokens: 2048,
    }));

    await useAiSettingsStore.getState().loadSettings();
    await useAiSettingsStore.getState().saveDefaultProfile({
      name: "Primary",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      base_url: "https://example.test/v1",
      temperature: 0.2,
      max_tokens: 2048,
      enabled: true,
    }, "sk-test");

    expect(apiMocks.upsertAiProfile).toHaveBeenCalledWith({
      name: "Primary",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      base_url: "https://example.test/v1",
      temperature: 0.2,
      max_tokens: 2048,
      enabled: true,
    });
    expect(apiMocks.setAiProfileSecret).toHaveBeenCalledWith("profile-2", "sk-test");
    expect(apiMocks.hasAiProfileSecret).toHaveBeenCalledWith("profile-2");
    expect(apiMocks.saveAiSettings).toHaveBeenCalledWith(true, "profile-2");
    expect(useAiSettingsStore.getState().defaultProfile?.id).toBe("profile-2");
    expect(useAiSettingsStore.getState().settings?.default_profile_id).toBe("profile-2");
    expect(useAiSettingsStore.getState().isSaving).toBe(false);
  });

  it("fails the save when the secret cannot be verified in the keychain", async () => {
    apiMocks.getAiSettings.mockResolvedValue(makeSettings({ default_profile_id: null, profiles: [] }));
    apiMocks.upsertAiProfile.mockResolvedValue(makeProfile({ id: "profile-2", name: "Primary" }));
    apiMocks.hasAiProfileSecret.mockResolvedValue(false);

    await useAiSettingsStore.getState().loadSettings();

    await expect(useAiSettingsStore.getState().saveDefaultProfile({
      name: "Primary",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      base_url: null,
      temperature: 0.2,
      max_tokens: 2048,
      enabled: true,
    }, "sk-test")).rejects.toThrow("API Key 已提交，但未能写入系统密钥链，请重试。");

    expect(apiMocks.setAiProfileSecret).toHaveBeenCalledWith("profile-2", "sk-test");
    expect(apiMocks.hasAiProfileSecret).toHaveBeenCalledWith("profile-2");
    expect(apiMocks.saveAiSettings).not.toHaveBeenCalled();
    expect(useAiSettingsStore.getState().error).toBe("API Key 已提交，但未能写入系统密钥链，请重试。");
  });

  it("surfaces string-shaped invoke errors instead of a generic fallback message", async () => {
    apiMocks.getAiSettings.mockResolvedValue(makeSettings({ default_profile_id: null, profiles: [] }));
    apiMocks.upsertAiProfile.mockResolvedValue(makeProfile({ id: "profile-2", name: "Primary" }));
    apiMocks.hasAiProfileSecret.mockRejectedValueOnce("command has_ai_profile_secret not found");

    await useAiSettingsStore.getState().loadSettings();

    await expect(useAiSettingsStore.getState().saveDefaultProfile({
      name: "Primary",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      base_url: null,
      temperature: 0.2,
      max_tokens: 2048,
      enabled: true,
    }, "sk-test")).rejects.toBe("command has_ai_profile_secret not found");

    expect(useAiSettingsStore.getState().error).toBe("command has_ai_profile_secret not found");
  });

  it("surfaces Rust AppError objects instead of a generic fallback message", async () => {
    apiMocks.getAiSettings.mockResolvedValue(makeSettings({ default_profile_id: null, profiles: [] }));
    apiMocks.upsertAiProfile.mockResolvedValue(makeProfile({ id: "profile-2", name: "Primary" }));
    apiMocks.hasAiProfileSecret.mockRejectedValueOnce({ Io: "系统密钥链操作失败" });

    await useAiSettingsStore.getState().loadSettings();

    await expect(useAiSettingsStore.getState().saveDefaultProfile({
      name: "Primary",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      base_url: null,
      temperature: 0.2,
      max_tokens: 2048,
      enabled: true,
    }, "sk-test")).rejects.toEqual({ Io: "系统密钥链操作失败" });

    expect(useAiSettingsStore.getState().error).toBe("系统密钥链操作失败");
  });

  it("requires a persisted keychain secret when saving without a new api key", async () => {
    apiMocks.getAiSettings.mockResolvedValue(makeSettings());
    apiMocks.upsertAiProfile.mockResolvedValue(makeProfile({ id: "profile-1", name: "Default" }));
    apiMocks.hasAiProfileSecret.mockResolvedValue(false);

    await useAiSettingsStore.getState().loadSettings();

    await expect(useAiSettingsStore.getState().saveDefaultProfile({
      id: "profile-1",
      name: "Default",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      base_url: null,
      temperature: 0.2,
      max_tokens: 2048,
      enabled: true,
    }, "")).rejects.toThrow("请填写 API Key 并保存");

    expect(apiMocks.setAiProfileSecret).not.toHaveBeenCalled();
    expect(apiMocks.hasAiProfileSecret).toHaveBeenCalledWith("profile-1");
    expect(apiMocks.saveAiSettings).not.toHaveBeenCalled();
    expect(useAiSettingsStore.getState().error).toBe("请填写 API Key 并保存，当前默认 profile 在系统密钥链中没有可用密钥。");
  });

  it("allows toggling the global AI flag without a default profile but still rejects testing", async () => {
    apiMocks.getAiSettings.mockResolvedValue(makeSettings({ default_profile_id: null, profiles: [] }));
    apiMocks.saveAiSettings.mockResolvedValue(makeSettings({ default_profile_id: null, profiles: [], enabled: false }));

    await useAiSettingsStore.getState().loadSettings();

    await expect(useAiSettingsStore.getState().toggleAutoSummaryAgent()).resolves.toBeUndefined();
    expect(useAiSettingsStore.getState().settings?.enabled).toBe(false);
    await expect(useAiSettingsStore.getState().testDefaultProfile()).rejects.toThrow(
      "请先保存默认 Profile，再测试连接。",
    );
    expect(useAiSettingsStore.getState().error).toBe("请先保存默认 Profile，再测试连接。");
  });

  it("reloads persisted settings after a partial default profile save failure", async () => {
    const persistedSettings = makeSettings({
      default_profile_id: "profile-1",
      profiles: [makeProfile({ name: "Persisted Name", model: "claude-3-7-sonnet" })],
    });
    apiMocks.getAiSettings
      .mockResolvedValueOnce(makeSettings())
      .mockResolvedValueOnce(persistedSettings);
    apiMocks.upsertAiProfile.mockResolvedValue(makeProfile({ name: "Persisted Name", model: "claude-3-7-sonnet" }));
    apiMocks.setAiProfileSecret.mockRejectedValueOnce(new Error("keychain locked"));

    await useAiSettingsStore.getState().loadSettings();

    await expect(useAiSettingsStore.getState().saveDefaultProfile({
      id: "profile-1",
      name: "Persisted Name",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      base_url: null,
      temperature: 0.4,
      max_tokens: 1024,
      enabled: true,
    }, "sk-test")).rejects.toThrow("keychain locked");

    expect(apiMocks.getAiSettings).toHaveBeenCalledTimes(2);
    expect(useAiSettingsStore.getState().settings).toEqual(persistedSettings);
    expect(useAiSettingsStore.getState().defaultProfile?.name).toBe("Persisted Name");
    expect(useAiSettingsStore.getState().error).toBe("keychain locked");
  });

  it("keeps locally confirmed profile updates when save recovery reload also fails", async () => {
    const initialSettings = makeSettings();
    const persistedProfile = makeProfile({ name: "Recovered Locally", model: "claude-3-7-sonnet" });
    apiMocks.getAiSettings
      .mockResolvedValueOnce(initialSettings)
      .mockRejectedValueOnce(new Error("reload failed"));
    apiMocks.upsertAiProfile.mockResolvedValue(persistedProfile);
    apiMocks.setAiProfileSecret.mockRejectedValueOnce(new Error("keychain locked"));

    await useAiSettingsStore.getState().loadSettings();

    await expect(useAiSettingsStore.getState().saveDefaultProfile({
      id: "profile-1",
      name: "Recovered Locally",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      base_url: null,
      temperature: 0.4,
      max_tokens: 1024,
      enabled: true,
    }, "sk-test")).rejects.toThrow("keychain locked");

    expect(useAiSettingsStore.getState().settings?.profiles[0]?.name).toBe("Recovered Locally");
    expect(useAiSettingsStore.getState().settings?.default_profile_id).toBe("profile-1");
    expect(useAiSettingsStore.getState().error).toBe("keychain locked");
  });

  it("retries loading settings when the dialog opens after a previous load failure", async () => {
    apiMocks.getAiSettings
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(makeSettings({ enabled: false }));

    await expect(useAiSettingsStore.getState().loadSettings()).rejects.toThrow("temporary failure");
    useAiSettingsStore.getState().openDialog();
    await Promise.resolve();

    expect(apiMocks.getAiSettings).toHaveBeenCalledTimes(2);
    expect(useAiSettingsStore.getState().settings?.enabled).toBe(false);
  });
});