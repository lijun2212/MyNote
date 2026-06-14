import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiSettingsDialog } from "./AiSettingsDialog";
import { useAiSettingsStore } from "../../store/useAiSettingsStore";
import type { AiProfile, AiProfileTestResult, AiSettings } from "../../types";

const apiMocks = vi.hoisted(() => ({
  saveAiSettings: vi.fn(),
  hasAiProfileSecret: vi.fn(),
  upsertAiProfile: vi.fn(),
  setAiProfileSecret: vi.fn(),
  testAiProfile: vi.fn(),
  testAiProfileInput: vi.fn(),
}));

vi.mock("../../api/commands", () => ({
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
    message: "连接成功",
    error_kind: null,
    retryable: false,
    text: "pong",
    input_tokens: 1,
    output_tokens: 1,
    total_tokens: 2,
    latency_ms: 100,
    ...overrides,
  };
}

describe("AiSettingsDialog", () => {
  beforeEach(() => {
    apiMocks.upsertAiProfile.mockReset();
    apiMocks.saveAiSettings.mockReset();
    apiMocks.hasAiProfileSecret.mockReset();
    apiMocks.setAiProfileSecret.mockReset();
    apiMocks.testAiProfile.mockReset();
    apiMocks.testAiProfileInput.mockReset();
    apiMocks.hasAiProfileSecret.mockResolvedValue(false);
    useAiSettingsStore.getState().resetForTest();
    useAiSettingsStore.setState({
      isDialogOpen: true,
      settings: makeSettings(),
      defaultProfile: makeProfile(),
    });
  });

  it("shows the current default profile and saves edited fields with the api key", async () => {
    const user = userEvent.setup();
    apiMocks.hasAiProfileSecret.mockResolvedValue(true);
    apiMocks.upsertAiProfile.mockResolvedValue(makeProfile({
      name: "Work",
      model: "claude-3-7-sonnet",
      base_url: "https://example.test/v1",
      max_tokens: 2048,
      temperature: 0.2,
    }));
    apiMocks.saveAiSettings.mockResolvedValue(makeSettings({
      default_profile_id: "profile-1",
      profiles: [makeProfile({
        name: "Work",
        model: "claude-3-7-sonnet",
        base_url: "https://example.test/v1",
        max_tokens: 2048,
        temperature: 0.2,
      })],
    }));

    render(<AiSettingsDialog />);

    expect(screen.getByRole("dialog", { name: "AI 设置" })).toBeInTheDocument();
    expect(screen.getByLabelText("默认 profile")).toHaveTextContent("Default");

    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "Work");
    await user.clear(screen.getByLabelText("模型"));
    await user.type(screen.getByLabelText("模型"), "claude-3-7-sonnet");
    await user.clear(screen.getByLabelText("Base URL"));
    await user.type(screen.getByLabelText("Base URL"), "https://example.test/v1");
    await user.clear(screen.getByLabelText("最大 Tokens"));
    await user.type(screen.getByLabelText("最大 Tokens"), "2048");
    await user.clear(screen.getByLabelText("Temperature"));
    await user.type(screen.getByLabelText("Temperature"), "0.2");
    await user.type(screen.getByLabelText("API Key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(apiMocks.upsertAiProfile).toHaveBeenCalledWith({
        id: "profile-1",
        name: "Work",
        provider: "anthropic",
        model: "claude-3-7-sonnet",
        base_url: "https://example.test/v1",
        max_tokens: 2048,
        temperature: 0.2,
        enabled: true,
      });
    });

    expect(apiMocks.setAiProfileSecret).toHaveBeenCalledWith("profile-1", "sk-test");
    expect(apiMocks.saveAiSettings).toHaveBeenCalledWith(true, "profile-1");
    expect(apiMocks.hasAiProfileSecret).toHaveBeenCalledWith("profile-1");
    expect(useAiSettingsStore.getState().defaultProfile?.name).toBe("Work");
    expect(screen.getByLabelText("API Key")).toHaveValue("sk-test");
  });

  it("shows a visible error when secret persistence verification fails after save", async () => {
    const user = userEvent.setup();
    apiMocks.hasAiProfileSecret.mockResolvedValue(false);
    apiMocks.upsertAiProfile.mockResolvedValue(makeProfile({
      name: "Work",
      model: "claude-3-7-sonnet",
    }));
    apiMocks.saveAiSettings.mockResolvedValue(makeSettings({
      default_profile_id: "profile-1",
      profiles: [makeProfile({
        name: "Work",
        model: "claude-3-7-sonnet",
      })],
    }));

    render(<AiSettingsDialog />);

    await user.clear(screen.getByLabelText("模型"));
    await user.type(screen.getByLabelText("模型"), "claude-3-7-sonnet");
    await user.type(screen.getByLabelText("API Key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(apiMocks.hasAiProfileSecret).toHaveBeenCalledWith("profile-1");
    });

    expect(screen.getByText("API Key 已提交，但未能写入系统密钥链，请重试。"))
      .toBeInTheDocument();
    expect(screen.queryByText("已保存到系统密钥链，本次会话可直接测试；留空则不更新。"))
      .not.toBeInTheDocument();
  });

  it("persists the global AI toggle from the dialog", async () => {
    const user = userEvent.setup();
    apiMocks.saveAiSettings.mockResolvedValue(makeSettings({ enabled: false }));

    render(<AiSettingsDialog />);

    await user.click(screen.getByLabelText("全局 AI 摘要开关"));

    await waitFor(() => {
      expect(apiMocks.saveAiSettings).toHaveBeenCalledWith(false, "profile-1");
    });

    expect(screen.getByText("已关闭")).toBeInTheDocument();
  });

  it("shows a visible error when testing connection without a default profile", async () => {
    const user = userEvent.setup();
    apiMocks.testAiProfileInput.mockResolvedValue(makeTestResult({
      success: false,
      status: "failed",
      message: "AI 配置的模型不能为空",
      error_kind: "invalid_configuration",
      retryable: false,
      text: null,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      latency_ms: null,
    }));
    useAiSettingsStore.setState({
      settings: makeSettings({ default_profile_id: null, profiles: [] }),
      defaultProfile: null,
    });

    render(<AiSettingsDialog />);

    await user.click(screen.getByRole("button", { name: "测试连接" }));

    const details = await screen.findByLabelText("AI 测试详情");
    expect(within(details).getByText("AI 配置的模型不能为空")).toBeInTheDocument();
    expect(apiMocks.testAiProfileInput).toHaveBeenCalledWith({
      id: null,
      name: "默认配置",
      provider: "anthropic",
      model: "",
      base_url: null,
      max_tokens: null,
      temperature: null,
      enabled: true,
    }, null);
    expect(apiMocks.testAiProfile).not.toHaveBeenCalled();
  });

  it("tests the current form values before saving", async () => {
    const user = userEvent.setup();
    apiMocks.testAiProfileInput.mockResolvedValue(makeTestResult());

    render(<AiSettingsDialog />);

    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "Draft Profile");
    await user.clear(screen.getByLabelText("模型"));
    await user.type(screen.getByLabelText("模型"), "claude-3-7-sonnet");
    await user.type(screen.getByLabelText("API Key"), "sk-live-test");

    await user.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(apiMocks.testAiProfileInput).toHaveBeenCalledWith({
        id: "profile-1",
        name: "Draft Profile",
        provider: "anthropic",
        model: "claude-3-7-sonnet",
        base_url: null,
        max_tokens: 1024,
        temperature: 0.4,
        enabled: true,
      }, "sk-live-test");
    });

    const details = await screen.findByLabelText("AI 测试详情");
    expect(within(details).getByText("连接成功")).toBeInTheDocument();
  });

  it("falls back to the saved keychain secret when the api key input is blank", async () => {
    const user = userEvent.setup();
    apiMocks.testAiProfileInput.mockResolvedValue(makeTestResult({ message: "已使用已保存密钥测试成功" }));

    render(<AiSettingsDialog />);

    await user.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(apiMocks.testAiProfileInput).toHaveBeenCalledWith({
        id: "profile-1",
        name: "Default",
        provider: "anthropic",
        model: "claude-sonnet",
        base_url: null,
        max_tokens: 1024,
        temperature: 0.4,
        enabled: true,
      }, null);
    });

    const details = await screen.findByLabelText("AI 测试详情");
    expect(within(details).getByText("已使用已保存密钥测试成功")).toBeInTheDocument();
  });

  it("reuses the just-saved api key in the same session when the input is cleared", async () => {
    const user = userEvent.setup();
    apiMocks.hasAiProfileSecret.mockResolvedValue(true);
    apiMocks.upsertAiProfile.mockResolvedValue(makeProfile({ id: "profile-2", name: "Draft Saved" }));
    apiMocks.saveAiSettings.mockResolvedValue(makeSettings({
      default_profile_id: "profile-2",
      profiles: [makeProfile({ id: "profile-2", name: "Draft Saved" })],
    }));
    apiMocks.testAiProfileInput.mockResolvedValue(makeTestResult({ message: "session key test ok" }));

    render(<AiSettingsDialog />);

    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "Draft Saved");
    await user.clear(screen.getByLabelText("模型"));
    await user.type(screen.getByLabelText("模型"), "claude-3-7-sonnet");
    await user.type(screen.getByLabelText("API Key"), "sk-saved-session");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => {
      expect(apiMocks.setAiProfileSecret).toHaveBeenCalledWith("profile-2", "sk-saved-session");
    });

    await user.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(apiMocks.testAiProfileInput).toHaveBeenCalledWith({
        id: "profile-2",
        name: "Draft Saved",
        provider: "anthropic",
        model: "claude-sonnet",
        base_url: null,
        max_tokens: 1024,
        temperature: 0.4,
        enabled: true,
      }, "sk-saved-session");
    });
  });

  it("shows detailed diagnostics for a failed connection test", async () => {
    const user = userEvent.setup();
    apiMocks.testAiProfileInput.mockResolvedValue(makeTestResult({
      success: false,
      status: "failed",
      message: "Parse error: Anthropic response did not include text content. Response excerpt: {\"content\":[{\"type\":\"thinking\"}]}",
      error_kind: "invalid_response",
      retryable: false,
      text: null,
      input_tokens: 9,
      output_tokens: 4,
      total_tokens: 13,
      latency_ms: 240,
    }));

    render(<AiSettingsDialog />);

    await user.click(screen.getByRole("button", { name: "测试连接" }));

    const details = await screen.findByLabelText("AI 测试详情");
    expect(within(details).getByText("测试详情")).toBeInTheDocument();
    expect(within(details).getByText("失败")).toBeInTheDocument();
    expect(within(details).getByText("invalid_response")).toBeInTheDocument();
    expect(within(details).getByText("不可重试")).toBeInTheDocument();
    expect(within(details).getByText("13")).toBeInTheDocument();
    expect(within(details).getByText(/Anthropic response did not include text content/)).toBeInTheDocument();
  });

  it("uses compact consistent control sizing for form fields and diagnostics actions", () => {
    render(<AiSettingsDialog />);

    expect(screen.getByLabelText("名称")).toHaveStyle({
      fontSize: "13px",
      minHeight: "36px",
      padding: "8px 10px",
    });
    expect(screen.getByLabelText("Provider")).toHaveStyle({
      fontSize: "13px",
      height: "36px",
      minHeight: "36px",
      padding: "8px 28px 8px 10px",
      lineHeight: "1.2",
    });
    expect(screen.getByRole("button", { name: "测试连接" })).toHaveStyle({
      fontSize: "13px",
      minHeight: "36px",
      padding: "8px 12px",
    });
  });
});