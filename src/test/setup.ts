import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";

export const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  openDialog: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: tauriMocks.openDialog }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauriMocks.openUrl }));

export function resetTauriMocks() {
  tauriMocks.invoke.mockReset();
  tauriMocks.openDialog.mockReset();
  tauriMocks.openUrl.mockReset();
}

export function resetStores() {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useEditorStore.setState(useEditorStore.getInitialState(), true);
}

afterEach(() => {
  cleanup();
  resetTauriMocks();
  resetStores();
  vi.useRealTimers();
});