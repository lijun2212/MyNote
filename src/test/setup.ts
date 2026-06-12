const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((filePath: string) => `asset://${filePath}`),
  openDialog: vi.fn(),
  openUrl: vi.fn(),
}));

export { tauriMocks };

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { useEditorStore } from "../store/useEditorStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
  convertFileSrc: tauriMocks.convertFileSrc,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: tauriMocks.openDialog }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauriMocks.openUrl }));

export function resetTauriMocks() {
  tauriMocks.invoke.mockReset();
  tauriMocks.convertFileSrc.mockReset();
  tauriMocks.convertFileSrc.mockImplementation((filePath: string) => `asset://${filePath}`);
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