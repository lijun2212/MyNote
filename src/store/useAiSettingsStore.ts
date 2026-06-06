import { create } from "zustand";
import { api } from "../api/commands";
import type { AiProfile, AiProfileInput, AiProfileTestResult, AiSettings } from "../types";

interface AiSettingsState {
  isDialogOpen: boolean;
  settings: AiSettings | null;
  defaultProfile: AiProfile | null;
  isLoading: boolean;
  isSaving: boolean;
  isTesting: boolean;
  error: string | null;
  lastTestResult: AiProfileTestResult | null;

  openDialog: () => void;
  closeDialog: () => void;
  loadSettings: () => Promise<AiSettings | null>;
  toggleAutoSummaryAgent: () => Promise<void>;
  saveDefaultProfile: (input: AiProfileInput, apiKey?: string) => Promise<AiProfile>;
  testDefaultProfile: () => Promise<AiProfileTestResult>;
  testProfileInput: (input: AiProfileInput, apiKey?: string | null) => Promise<AiProfileTestResult>;
  resetForTest: () => void;
}

const initialState = {
  isDialogOpen: false,
  settings: null,
  defaultProfile: null,
  isLoading: false,
  isSaving: false,
  isTesting: false,
  error: null,
  lastTestResult: null,
};

function toErrorMessage(error: unknown) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof (error as { message?: unknown }).message === "string"
    && (error as { message: string }).message.trim()
  ) {
    return (error as { message: string }).message;
  }

  if (typeof error === "object" && error !== null) {
    const entries = Object.entries(error as Record<string, unknown>);
    if (entries.length === 1) {
      const [kind, value] = entries[0];
      if (typeof value === "string" && value.trim()) {
        return `${kind}: ${value}`;
      }
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Fall through to the stable fallback below.
    }
  }

  return "AI settings request failed";
}

function resolveDefaultProfile(settings: AiSettings | null) {
  if (!settings?.default_profile_id) {
    return null;
  }

  return settings.profiles.find((profile) => profile.id === settings.default_profile_id) ?? null;
}

function assertDefaultProfile(settings: AiSettings | null) {
  const profile = resolveDefaultProfile(settings);

  if (!profile) {
    throw new Error("请先保存默认 Profile，再测试连接。");
  }

  return profile;
}

function upsertDefaultProfile(settings: AiSettings | null, profile: AiProfile): AiSettings {
  const profiles = settings?.profiles ?? [];
  const nextProfiles = profiles.some((item) => item.id === profile.id)
    ? profiles.map((item) => (item.id === profile.id ? profile : item))
    : [...profiles, profile];

  return {
    enabled: settings?.enabled ?? true,
    default_profile_id: profile.id,
    profiles: nextProfiles,
  };
}

function mergeProfileIntoSettings(settings: AiSettings | null, profile: AiProfile): AiSettings {
  const profiles = settings?.profiles ?? [];
  const nextProfiles = profiles.some((item) => item.id === profile.id)
    ? profiles.map((item) => (item.id === profile.id ? profile : item))
    : [...profiles, profile];

  return {
    enabled: settings?.enabled ?? true,
    default_profile_id: settings?.default_profile_id ?? null,
    profiles: nextProfiles,
  };
}

export const useAiSettingsStore = create<AiSettingsState>((set, get) => ({
  ...initialState,

  openDialog: () => {
    set({ isDialogOpen: true });
    const { settings, error } = get();
    if (!settings || error) {
      void get().loadSettings().catch(() => undefined);
    }
  },
  closeDialog: () => set({ isDialogOpen: false }),

  async loadSettings() {
    set({ isLoading: true, error: null });

    try {
      const settings = await api.getAiSettings();
      const defaultProfile = resolveDefaultProfile(settings);
      set({ settings, defaultProfile, isLoading: false });
      return settings;
    } catch (error) {
      set({ isLoading: false, error: toErrorMessage(error) });
      throw error;
    }
  },

  async toggleAutoSummaryAgent() {
    const { settings } = get();

    if (!settings) {
      throw new Error("AI settings are not loaded.");
    }

    set({ isSaving: true, error: null });

    try {
      const nextSettings = await api.saveAiSettings(
        !settings.enabled,
        settings.default_profile_id ?? null,
      );

      set({
        settings: nextSettings,
        defaultProfile: resolveDefaultProfile(nextSettings),
        isSaving: false,
      });
    } catch (error) {
      set({ isSaving: false, error: toErrorMessage(error) });
      throw error;
    }
  },

  async saveDefaultProfile(input, apiKey) {
    set({ isSaving: true, error: null });

    const previousSettings = get().settings;
    let persistedProfile: AiProfile | null = null;

    try {
      const savedProfile = await api.upsertAiProfile(input);
      persistedProfile = savedProfile;

      if (apiKey?.trim()) {
        await api.setAiProfileSecret(savedProfile.id, apiKey.trim());
      }

      const hasPersistedSecret = await api.hasAiProfileSecret(savedProfile.id);
      if (!hasPersistedSecret) {
        throw new Error(
          apiKey?.trim()
            ? "API Key 已提交，但未能写入系统密钥链，请重试。"
            : "请填写 API Key 并保存，当前默认 profile 在系统密钥链中没有可用密钥。",
        );
      }

      const currentSettings = get().settings;
      const nextSettings = await api.saveAiSettings(
        currentSettings?.enabled ?? true,
        savedProfile.id,
      );
      const mergedSettings = upsertDefaultProfile(nextSettings, savedProfile);
      const defaultProfile = resolveDefaultProfile(nextSettings);

      set({
        settings: mergedSettings,
        defaultProfile: defaultProfile ?? savedProfile,
        isSaving: false,
      });

      return savedProfile;
    } catch (error) {
      let refreshedSettings = persistedProfile
        ? mergeProfileIntoSettings(previousSettings, persistedProfile)
        : get().settings;

      try {
        refreshedSettings = await api.getAiSettings();
      } catch {
        refreshedSettings = refreshedSettings ?? get().settings;
      }

      set({
        settings: refreshedSettings,
        defaultProfile: resolveDefaultProfile(refreshedSettings),
        isSaving: false,
        error: toErrorMessage(error),
      });
      throw error;
    }
  },

  async testDefaultProfile() {
    set({ isTesting: true, error: null, lastTestResult: null });

    try {
      const { settings } = get();
      const defaultProfile = assertDefaultProfile(settings);
      const lastTestResult = await api.testAiProfile(defaultProfile.id);
      set({ lastTestResult, isTesting: false });
      return lastTestResult;
    } catch (error) {
      set({ isTesting: false, error: toErrorMessage(error) });
      throw error;
    }
  },

  async testProfileInput(input, apiKey) {
    set({ isTesting: true, error: null, lastTestResult: null });

    try {
      const lastTestResult = await api.testAiProfileInput(input, apiKey ?? null);
      set({ lastTestResult, isTesting: false });
      return lastTestResult;
    } catch (error) {
      set({ isTesting: false, error: toErrorMessage(error) });
      throw error;
    }
  },

  resetForTest: () => set(initialState),
}));