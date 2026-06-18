// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGitHubUpdaterPlan, buildGitLabUpdaterPlan, writeUpdaterManifestFromPlan } from "./updaterReleasePlan.mjs";

const tempDirs = [];

function makeTempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mynote-updater-plan-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("buildGitLabUpdaterPlan", () => {
  it("builds package upload URLs, release asset links, and manifest platform entries from a macOS updater bundle", () => {
    const tempDir = makeTempDir();
    const bundleRoot = path.join(tempDir, "src-tauri", "target", "release", "bundle");
    const macosDir = path.join(bundleRoot, "macos");
    fs.mkdirSync(macosDir, { recursive: true });

    const bundleFile = path.join(macosDir, "MyNote.app.tar.gz");
    const signatureFile = path.join(macosDir, "MyNote.app.tar.gz.sig");
    fs.writeFileSync(bundleFile, "bundle");
    fs.writeFileSync(signatureFile, "signature");

    const plan = buildGitLabUpdaterPlan({
      repoRoot: tempDir,
      version: "0.2.3",
      releaseTag: "v0.2.3",
      projectBaseUrl: "https://gitlab.totalapp.cn:8991/lijun/mynote",
      projectPath: "lijun/mynote",
      packageName: "mynote-updater",
      currentTarget: "darwin-aarch64",
    });

    expect(plan.manifestOutputPath).toBe(path.join(tempDir, "release", "updater", "latest.json"));
    expect(plan.packageUploads).toEqual([
      {
        localPath: bundleFile,
        packageUrl: "https://gitlab.totalapp.cn:8991/api/v4/projects/lijun%2Fmynote/packages/generic/mynote-updater/0.2.3/darwin-aarch64/MyNote.app.tar.gz",
        releaseAssetName: "MyNote darwin-aarch64 updater",
        releaseAssetFilepath: "/updater/darwin-aarch64/MyNote.app.tar.gz",
        releaseDownloadUrl: "https://gitlab.totalapp.cn:8991/lijun/mynote/-/releases/v0.2.3/downloads/updater/darwin-aarch64/MyNote.app.tar.gz",
        signaturePath: signatureFile,
        target: "darwin-aarch64",
      },
    ]);
    expect(plan.manifestPlatforms).toEqual([
      {
        signaturePath: signatureFile,
        target: "darwin-aarch64",
        url: "https://gitlab.totalapp.cn:8991/lijun/mynote/-/releases/v0.2.3/downloads/updater/darwin-aarch64/MyNote.app.tar.gz",
      },
    ]);
    expect(plan.latestManifestPackageUrl).toBe(
      "https://gitlab.totalapp.cn:8991/api/v4/projects/lijun%2Fmynote/packages/generic/mynote-updater/0.2.3/latest.json",
    );
    expect(plan.latestManifestReleaseFilepath).toBe("/updater/latest.json");
  });

  it("writes latest.json from the planned platform URLs and signature files", () => {
    const tempDir = makeTempDir();
    const bundleRoot = path.join(tempDir, "src-tauri", "target", "release", "bundle");
    const macosDir = path.join(bundleRoot, "macos");
    fs.mkdirSync(macosDir, { recursive: true });

    const bundleFile = path.join(macosDir, "MyNote.app.tar.gz");
    const signatureFile = path.join(macosDir, "MyNote.app.tar.gz.sig");
    fs.writeFileSync(bundleFile, "bundle");
    fs.writeFileSync(signatureFile, "test-signature\n");

    const plan = buildGitLabUpdaterPlan({
      repoRoot: tempDir,
      version: "0.2.3",
      releaseTag: "v0.2.3",
      projectBaseUrl: "https://gitlab.totalapp.cn:8991/lijun/mynote",
      projectPath: "lijun/mynote",
      currentTarget: "darwin-aarch64",
    });

    const result = writeUpdaterManifestFromPlan(plan, {
      version: "0.2.3",
      pubDate: "2026-06-19T00:00:00.000Z",
      notes: "修复稳定性问题",
    });

    expect(result.outputPath).toBe(path.join(tempDir, "release", "updater", "latest.json"));
    expect(JSON.parse(fs.readFileSync(result.outputPath, "utf8"))).toEqual({
      version: "0.2.3",
      notes: "修复稳定性问题",
      pub_date: "2026-06-19T00:00:00.000Z",
      platforms: {
        "darwin-aarch64": {
          url: "https://gitlab.totalapp.cn:8991/lijun/mynote/-/releases/v0.2.3/downloads/updater/darwin-aarch64/MyNote.app.tar.gz",
          signature: "test-signature",
        },
      },
    });
  });
});

describe("buildGitHubUpdaterPlan", () => {
  it("builds release asset URLs and latest manifest URLs for GitHub Releases", () => {
    const tempDir = makeTempDir();
    const bundleRoot = path.join(tempDir, "src-tauri", "target", "release", "bundle");
    const macosDir = path.join(bundleRoot, "macos");
    const dmgDir = path.join(bundleRoot, "dmg");
    fs.mkdirSync(macosDir, { recursive: true });
    fs.mkdirSync(dmgDir, { recursive: true });

    const bundleFile = path.join(macosDir, "MyNote.app.tar.gz");
    const signatureFile = path.join(macosDir, "MyNote.app.tar.gz.sig");
    const dmgFile = path.join(dmgDir, "MyNote_0.2.3_aarch64.dmg");
    fs.writeFileSync(bundleFile, "bundle");
    fs.writeFileSync(signatureFile, "signature");
    fs.writeFileSync(dmgFile, "dmg");

    const plan = buildGitHubUpdaterPlan({
      repoRoot: tempDir,
      version: "0.2.3",
      releaseTag: "v0.2.3",
      repository: "lijun2212/MyNote",
      currentTarget: "darwin-arm64",
    });

    expect(plan.releasePageUrl).toBe("https://github.com/lijun2212/MyNote/releases");
    expect(plan.latestManifestReleaseUrl).toBe("https://github.com/lijun2212/MyNote/releases/latest/download/latest.json");
    expect(plan.manifestAssetDownloadUrl).toBe("https://github.com/lijun2212/MyNote/releases/download/v0.2.3/latest.json");
    expect(plan.manifestPlatforms).toEqual([
      {
        target: "darwin-arm64",
        url: "https://github.com/lijun2212/MyNote/releases/download/v0.2.3/MyNote.app.tar.gz",
        signaturePath: signatureFile,
      },
    ]);
    expect(plan.releaseAssets).toEqual([
      {
        localPath: bundleFile,
        assetName: "MyNote.app.tar.gz",
        downloadUrl: "https://github.com/lijun2212/MyNote/releases/download/v0.2.3/MyNote.app.tar.gz",
      },
      {
        localPath: dmgFile,
        assetName: "MyNote_0.2.3_aarch64.dmg",
        downloadUrl: "https://github.com/lijun2212/MyNote/releases/download/v0.2.3/MyNote_0.2.3_aarch64.dmg",
      },
    ]);
  });
});