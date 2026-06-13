import { describe, expect, it } from "vitest";
import tauriConfig from "../src-tauri/tauri.conf.json";
import infoPlist from "../src-tauri/Info.plist?raw";

describe("tauri macOS bundle localization", () => {
  it("allows the projection preview window in the default Tauri capability", async () => {
    const capabilityModule = await import("../src-tauri/capabilities/default.json");
    const capability = capabilityModule.default as { windows?: string[]; permissions?: string[] };

    expect(capability.windows).toEqual(expect.arrayContaining(["main", "projection-preview"]));
    expect(capability.permissions).toEqual(expect.arrayContaining([
      "core:window:allow-create",
      "core:window:allow-show",
      "core:window:allow-set-focus",
      "core:window:allow-close",
      "core:webview:allow-create-webview-window",
    ]));
  });

  it("bundles Chinese localization resources for native macOS dialogs", () => {
    const resources = tauriConfig.bundle.resources;

    expect(resources).toBeDefined();
    expect(resources).toEqual(
      expect.arrayContaining([
        "resources/zh-Hans.lproj",
        "resources/zh_CN.lproj",
        "resources/en.lproj",
      ]),
    );
  });

  it("declares a zh_CN alias in Info.plist for native macOS dialog fallback", () => {
    expect(infoPlist).toContain("<string>zh_CN</string>");
  });
});