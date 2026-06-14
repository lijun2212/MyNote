import { describe, expect, it } from "vitest";
import { tauriMocks } from "../test/setup";
import {
  closeProjectionWindow,
  emitProjectionState,
  getProjectionWindowCapabilities,
  openProjectionWindow,
} from "./windowApi";

describe("projection windowApi", () => {
  it("creates and focuses the projection preview window with the expected label and role", async () => {
    await openProjectionWindow("技术方案");

    expect(tauriMocks.createWebviewWindow).toHaveBeenCalledWith(
      "projection-preview",
      expect.objectContaining({
        title: "技术方案",
        url: "/?windowRole=projection-preview",
        visible: true,
        focus: true,
        center: true,
      }),
    );
    expect(tauriMocks.showWebviewWindow).toHaveBeenCalledWith("projection-preview");
    expect(tauriMocks.focusWebviewWindow).toHaveBeenCalledWith("projection-preview");
  });

  it("falls back to a generic title when no note title is available", async () => {
    await openProjectionWindow(null);

    expect(tauriMocks.createWebviewWindow).toHaveBeenCalledWith(
      "projection-preview",
      expect.objectContaining({
        title: "投影预览",
      }),
    );
  });

  it("closes the current projection window", async () => {
    await closeProjectionWindow();

    expect(tauriMocks.getWebviewWindowByLabel).toHaveBeenCalledWith("projection-preview");
    expect(tauriMocks.closeWebviewWindow).toHaveBeenCalledTimes(1);
    expect(tauriMocks.getCurrentWebviewWindow).not.toHaveBeenCalled();
  });

  it("does nothing when the projection preview window is unavailable", async () => {
    tauriMocks.getWebviewWindowByLabel.mockReturnValue(null);

    await closeProjectionWindow();

    expect(tauriMocks.getWebviewWindowByLabel).toHaveBeenCalledWith("projection-preview");
    expect(tauriMocks.closeWebviewWindow).not.toHaveBeenCalled();
    expect(tauriMocks.getCurrentWebviewWindow).not.toHaveBeenCalled();
  });

  it("emits projection events to the projection preview window", async () => {
    await emitProjectionState("projection:state-sync", { revision: 1 });

    expect(tauriMocks.emitTo).toHaveBeenCalledWith("projection-preview", "projection:state-sync", { revision: 1 });
  });

  it("reports conservative projection window capabilities", () => {
    expect(getProjectionWindowCapabilities()).toEqual({
      supportsExternalMonitorPlacement: false,
      supportsFullscreenProjection: true,
    });
  });
});