import { describe, expect, it } from "vitest";
import tauriConfig from "../src-tauri/tauri.conf.json";
import infoPlist from "../src-tauri/Info.plist?raw";

describe("tauri macOS bundle localization", () => {
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