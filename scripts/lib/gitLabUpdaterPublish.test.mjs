// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildGitLabReleaseLinkSyncPlan, buildGitLabUpdaterUploadPlan } from "./gitLabUpdaterPublish.mjs";

describe("buildGitLabUpdaterUploadPlan", () => {
  it("returns package upload operations for the updater bundle and latest manifest", () => {
    const plan = {
      manifestOutputPath: "/repo/release/updater/latest.json",
      latestManifestPackageUrl: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/latest.json",
      packageUploads: [
        {
          localPath: "/repo/src-tauri/target/release/bundle/macos/MyNote.app.tar.gz",
          packageUrl: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/darwin-aarch64/MyNote.app.tar.gz",
        },
      ],
    };

    expect(buildGitLabUpdaterUploadPlan(plan)).toEqual([
      {
        localPath: "/repo/src-tauri/target/release/bundle/macos/MyNote.app.tar.gz",
        packageUrl: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/darwin-aarch64/MyNote.app.tar.gz",
      },
      {
        localPath: "/repo/release/updater/latest.json",
        packageUrl: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/latest.json",
      },
    ]);
  });
});

describe("buildGitLabReleaseLinkSyncPlan", () => {
  it("creates missing release links and updates existing mismatched links", () => {
    const plan = {
      latestManifestPackageUrl: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/latest.json",
      latestManifestReleaseFilepath: "/updater/latest.json",
      packageUploads: [
        {
          releaseAssetName: "MyNote darwin-aarch64 updater",
          releaseAssetFilepath: "/updater/darwin-aarch64/MyNote.app.tar.gz",
          packageUrl: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/darwin-aarch64/MyNote.app.tar.gz",
        },
      ],
    };

    const existingLinks = [
      {
        id: 7,
        name: "MyNote darwin-aarch64 updater",
        url: "https://old.example.com/MyNote.app.tar.gz",
        direct_asset_url: "https://gitlab.example.com/group/project/-/releases/v0.2.3/downloads/updater/darwin-aarch64/MyNote.app.tar.gz",
      },
    ];

    expect(buildGitLabReleaseLinkSyncPlan(plan, existingLinks)).toEqual([
      {
        method: "PUT",
        linkId: 7,
        name: "MyNote darwin-aarch64 updater",
        url: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/darwin-aarch64/MyNote.app.tar.gz",
        directAssetPath: "/updater/darwin-aarch64/MyNote.app.tar.gz",
        linkType: "package",
      },
      {
        method: "POST",
        name: "MyNote updater manifest",
        url: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/latest.json",
        directAssetPath: "/updater/latest.json",
        linkType: "package",
      },
    ]);
  });

  it("skips links that are already aligned", () => {
    const plan = {
      latestManifestPackageUrl: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/latest.json",
      latestManifestReleaseFilepath: "/updater/latest.json",
      packageUploads: [
        {
          releaseAssetName: "MyNote darwin-aarch64 updater",
          releaseAssetFilepath: "/updater/darwin-aarch64/MyNote.app.tar.gz",
          packageUrl: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/darwin-aarch64/MyNote.app.tar.gz",
        },
      ],
    };

    const existingLinks = [
      {
        id: 7,
        name: "MyNote darwin-aarch64 updater",
        url: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/darwin-aarch64/MyNote.app.tar.gz",
        direct_asset_url: "https://gitlab.example.com/group/project/-/releases/v0.2.3/downloads/updater/darwin-aarch64/MyNote.app.tar.gz",
      },
      {
        id: 8,
        name: "MyNote updater manifest",
        url: "https://gitlab.example.com/api/v4/projects/group%2Fproject/packages/generic/mynote-updater/0.2.3/latest.json",
        direct_asset_url: "https://gitlab.example.com/group/project/-/releases/v0.2.3/downloads/updater/latest.json",
      },
    ];

    expect(buildGitLabReleaseLinkSyncPlan(plan, existingLinks)).toEqual([]);
  });
});