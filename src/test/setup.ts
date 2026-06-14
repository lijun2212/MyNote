const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((filePath: string) => `asset://${filePath}`),
  openDialog: vi.fn(),
  openUrl: vi.fn(),
  listen: vi.fn(),
  emitTo: vi.fn(),
  createWebviewWindow: vi.fn(),
  showWebviewWindow: vi.fn(),
  focusWebviewWindow: vi.fn(),
  setWebviewWindowTitle: vi.fn(),
  getCurrentWebviewWindow: vi.fn(),
  getWebviewWindowByLabel: vi.fn(),
  closeWebviewWindow: vi.fn(),
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
vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMocks.listen,
  emitTo: tauriMocks.emitTo,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class MockWebviewWindow {
    static getByLabel(label: string) {
      return tauriMocks.getWebviewWindowByLabel(label);
    }

    label: string;
    listeners: Record<string, Array<(event: { payload: unknown }) => void>> = {};

    constructor(label: string, options?: Record<string, unknown>) {
      this.label = label;
      tauriMocks.createWebviewWindow(label, options);

      queueMicrotask(() => {
        const createdListeners = this.listeners["tauri://created"] ?? [];
        for (const listener of createdListeners) {
          listener({ payload: null });
        }
      });
    }

    async once(event: string, handler: (event: { payload: unknown }) => void) {
      this.listeners[event] ??= [];
      this.listeners[event].push(handler);

      return () => {
        this.listeners[event] = (this.listeners[event] ?? []).filter((listener) => listener !== handler);
      };
    }

    async show() {
      tauriMocks.showWebviewWindow(this.label);
      return undefined;
    }

    async setFocus() {
      tauriMocks.focusWebviewWindow(this.label);
      return undefined;
    }

    async setTitle(title: string) {
      tauriMocks.setWebviewWindowTitle(this.label, title);
      return undefined;
    }
  },
  getCurrentWebviewWindow: tauriMocks.getCurrentWebviewWindow,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: tauriMocks.openDialog }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauriMocks.openUrl }));

export function resetTauriMocks() {
  tauriMocks.invoke.mockReset();
  tauriMocks.convertFileSrc.mockReset();
  tauriMocks.convertFileSrc.mockImplementation((filePath: string) => `asset://${filePath}`);
  tauriMocks.openDialog.mockReset();
  tauriMocks.openUrl.mockReset();
  tauriMocks.listen.mockReset();
  tauriMocks.listen.mockResolvedValue(() => {});
  tauriMocks.emitTo.mockReset();
  tauriMocks.emitTo.mockResolvedValue(undefined);
  tauriMocks.createWebviewWindow.mockReset();
  tauriMocks.showWebviewWindow.mockReset();
  tauriMocks.focusWebviewWindow.mockReset();
  tauriMocks.setWebviewWindowTitle.mockReset();
  tauriMocks.getCurrentWebviewWindow.mockReset();
  tauriMocks.getWebviewWindowByLabel.mockReset();
  tauriMocks.getCurrentWebviewWindow.mockReturnValue({
    close: tauriMocks.closeWebviewWindow,
  });
  tauriMocks.getWebviewWindowByLabel.mockReturnValue({
    close: tauriMocks.closeWebviewWindow,
  });
  tauriMocks.closeWebviewWindow.mockReset();
  tauriMocks.closeWebviewWindow.mockResolvedValue(undefined);
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