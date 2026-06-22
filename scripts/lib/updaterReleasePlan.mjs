import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function fail(message) {
  throw new Error(message);
}

function resolveBundleRoot(repoRoot) {
  return path.join(repoRoot, "src-tauri", "target", "release", "bundle");
}

function normalizeUpdaterArch(arch) {
  switch (arch) {
    case "x64":
      return "x86_64";
    case "arm64":
      return "aarch64";
    case "x32":
    case "ia32":
      return "i686";
    case "arm":
      return "armv7";
    default:
      return arch;
  }
}

function normalizeUpdaterPlatform(platform) {
  if (platform === "win32") {
    return "windows";
  }

  return platform;
}

function normalizeUpdaterTarget(target) {
  const [platform, ...archParts] = target.split("-");
  if (!platform || archParts.length === 0) {
    return target;
  }

  return `${normalizeUpdaterPlatform(platform)}-${normalizeUpdaterArch(archParts.join("-"))}`;
}

function getCurrentTarget() {
  const platform = normalizeUpdaterPlatform(os.platform());
  const arch = normalizeUpdaterArch(os.arch());
  return `${platform}-${arch}`;
}

function getCandidateFolders(target) {
  if (target.startsWith("darwin-")) {
    return [{ folder: "macos", suffixes: [".app.tar.gz"] }];
  }
  if (target.startsWith("windows-")) {
    return [{ folder: "nsis", suffixes: [".exe"] }, { folder: "msi", suffixes: [".msi"] }];
  }
  if (target.startsWith("linux-")) {
    return [{ folder: "appimage", suffixes: [".AppImage"] }];
  }
  fail(`Unsupported updater target '${target}'.`);
}

function findFirstMatchingBundle(bundleRoot, target) {
  for (const candidate of getCandidateFolders(target)) {
    const directory = path.join(bundleRoot, candidate.folder);
    if (!fs.existsSync(directory)) {
      continue;
    }

    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      const matchingSuffix = candidate.suffixes.find((suffix) => entry.name.endsWith(suffix));
      if (!matchingSuffix) {
        continue;
      }

      const signaturePath = `${absolutePath}.sig`;
      if (!fs.existsSync(signaturePath)) {
        continue;
      }

      return {
        localPath: absolutePath,
        signaturePath,
      };
    }
  }

  fail(`Unable to find a signed updater bundle for target '${target}' under ${bundleRoot}.`);
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function joinGitHubReleaseAssetUrl(repository, releaseTag, assetName) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`;
}

function findFilesMatchingSuffixes(directory, suffixes) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix)))
    .map((entry) => path.join(directory, entry.name));
}

function isVersionedBundleAsset(filePath, version) {
  const fileName = path.basename(filePath);
  return fileName.includes(`_${version}_`);
}

function findSupplementalReleaseAssets(bundleRoot, target, version) {
  if (target.startsWith("darwin-")) {
    return findFilesMatchingSuffixes(path.join(bundleRoot, "dmg"), [".dmg"])
      .filter((filePath) => isVersionedBundleAsset(filePath, version));
  }
  if (target.startsWith("windows-")) {
    return [
      ...findFilesMatchingSuffixes(path.join(bundleRoot, "nsis"), [".exe"]),
      ...findFilesMatchingSuffixes(path.join(bundleRoot, "msi"), [".msi"]),
    ].filter((filePath) => isVersionedBundleAsset(filePath, version));
  }
  return [];
}

function readSignature(signaturePath) {
  if (!fs.existsSync(signaturePath)) {
    fail(`Signature file not found: ${signaturePath}`);
  }

  const signature = fs.readFileSync(signaturePath, "utf8").trim();
  if (!signature) {
    fail(`Signature file is empty: ${signaturePath}`);
  }

  return signature;
}

export function buildGitLabUpdaterPlan({
  repoRoot,
  version,
  releaseTag = `v${version}`,
  projectBaseUrl,
  projectPath,
  packageName = "mynote-updater",
  currentTarget = getCurrentTarget(),
}) {
  if (!repoRoot || !version || !projectBaseUrl || !projectPath) {
    fail("repoRoot, version, projectBaseUrl, and projectPath are required.");
  }

  const normalizedTarget = normalizeUpdaterTarget(currentTarget);
  const bundleRoot = resolveBundleRoot(repoRoot);
  const bundle = findFirstMatchingBundle(bundleRoot, normalizedTarget);
  const normalizedProjectBaseUrl = trimTrailingSlash(projectBaseUrl);
  const encodedProjectPath = encodeURIComponent(projectPath);
  const packageBaseUrl = `${new URL(normalizedProjectBaseUrl).origin}/api/v4/projects/${encodedProjectPath}/packages/generic/${packageName}/${version}`;
  const releaseLinksApiUrl = `${new URL(normalizedProjectBaseUrl).origin}/api/v4/projects/${encodedProjectPath}/releases/${encodeURIComponent(releaseTag)}/assets/links`;
  const fileName = path.basename(bundle.localPath);
  const releaseAssetFilepath = `/updater/${normalizedTarget}/${fileName}`;
  const releaseDownloadUrl = `${normalizedProjectBaseUrl}/-/releases/${releaseTag}/downloads${releaseAssetFilepath}`;
  const latestManifestPackageUrl = `${packageBaseUrl}/latest.json`;
  const latestManifestReleaseFilepath = "/updater/latest.json";
  const latestManifestReleaseUrl = `${normalizedProjectBaseUrl}/-/releases/permalink/latest/downloads/updater/latest.json`;

  return {
    manifestOutputPath: path.join(repoRoot, "release", "updater", "latest.json"),
    releaseTag,
    releaseLinksApiUrl,
    latestManifestPackageUrl,
    latestManifestReleaseFilepath,
    latestManifestReleaseUrl,
    manifestPlatforms: [
      {
        target: normalizedTarget,
        url: releaseDownloadUrl,
        signaturePath: bundle.signaturePath,
      },
    ],
    packageUploads: [
      {
        target: normalizedTarget,
        localPath: bundle.localPath,
        signaturePath: bundle.signaturePath,
        packageUrl: `${packageBaseUrl}/${normalizedTarget}/${fileName}`,
        releaseAssetName: `MyNote ${normalizedTarget} updater`,
        releaseAssetFilepath,
        releaseDownloadUrl,
      },
    ],
  };
}

export function buildGitHubUpdaterPlan({
  repoRoot,
  version,
  releaseTag = `v${version}`,
  repository,
  currentTarget = getCurrentTarget(),
}) {
  if (!repoRoot || !version || !repository) {
    fail("repoRoot, version, and repository are required.");
  }

  const normalizedTarget = normalizeUpdaterTarget(currentTarget);
  const bundleRoot = resolveBundleRoot(repoRoot);
  const bundle = findFirstMatchingBundle(bundleRoot, normalizedTarget);
  const bundleFileName = path.basename(bundle.localPath);
  const supplementalAssets = findSupplementalReleaseAssets(bundleRoot, normalizedTarget, version)
    .filter((localPath) => localPath !== bundle.localPath)
    .map((localPath) => ({
      localPath,
      assetName: path.basename(localPath),
      downloadUrl: joinGitHubReleaseAssetUrl(repository, releaseTag, path.basename(localPath)),
    }));

  return {
    manifestOutputPath: path.join(repoRoot, "release", "updater", "latest.json"),
    releaseTag,
    repository,
    releasePageUrl: `https://github.com/${repository}/releases`,
    latestManifestReleaseUrl: `https://github.com/${repository}/releases/latest/download/latest.json`,
    manifestAssetName: "latest.json",
    manifestAssetDownloadUrl: joinGitHubReleaseAssetUrl(repository, releaseTag, "latest.json"),
    manifestPlatforms: [
      {
        target: normalizedTarget,
        url: joinGitHubReleaseAssetUrl(repository, releaseTag, bundleFileName),
        signaturePath: bundle.signaturePath,
      },
    ],
    releaseAssets: [
      {
        localPath: bundle.localPath,
        assetName: bundleFileName,
        downloadUrl: joinGitHubReleaseAssetUrl(repository, releaseTag, bundleFileName),
      },
      ...supplementalAssets,
    ],
  };
}

export function renderGitLabUpdaterPlanMarkdown(plan) {
  const bundle = plan.packageUploads[0];
  const platform = plan.manifestPlatforms[0];

  return [
    "# Updater Publish Plan",
    "",
    "## Files",
    `- Update bundle: ${bundle.localPath}`,
    `- Signature: ${bundle.signaturePath}`,
    `- Manifest output: ${plan.manifestOutputPath}`,
    "",
    "## Preferred Command",
    `GITLAB_TOKEN=<token> corepack pnpm release:publish`,
    "",
    "## Package Upload Commands",
    `curl --header \"PRIVATE-TOKEN: <token>\" --upload-file \"${bundle.localPath}\" \"${bundle.packageUrl}\"`,
    `curl --header \"PRIVATE-TOKEN: <token>\" --upload-file \"${plan.manifestOutputPath}\" \"${plan.latestManifestPackageUrl}\"`,
    "",
    "## Manifest Command",
    `corepack pnpm updater:manifest <version> --platform ${platform.target}=${platform.url}::${platform.signaturePath} --output ${plan.manifestOutputPath}`,
    "",
    "## Release Asset Links",
    `- direct_asset_path=${bundle.releaseAssetFilepath} -> ${bundle.packageUrl}`,
    `- direct_asset_path=${plan.latestManifestReleaseFilepath} -> ${plan.latestManifestPackageUrl}`,
    "",
    "## Latest Release URL",
    `- ${plan.latestManifestReleaseUrl}`,
    "",
  ].join("\n");
}

export function renderGitHubUpdaterPlanMarkdown(plan) {
  const platform = plan.manifestPlatforms[0];

  return [
    "# Updater Publish Plan",
    "",
    "## Files",
    ...plan.releaseAssets.map((asset) => `- Release asset: ${asset.localPath}`),
    `- Manifest output: ${plan.manifestOutputPath}`,
    "",
    "## Preferred Command",
    "corepack pnpm release:publish",
    "",
    "## GitHub Release",
    `- Repository: ${plan.repository}`,
    `- Tag: ${plan.releaseTag}`,
    `- Release page: ${plan.releasePageUrl}`,
    "",
    "## Upload Command",
    `gh release upload ${plan.releaseTag} ${plan.releaseAssets.map((asset) => asset.localPath).join(" ")} ${plan.manifestOutputPath} --repo ${plan.repository} --clobber`,
    "",
    "## Manifest Command",
    `corepack pnpm updater:manifest <version> --platform ${platform.target}=${platform.url}::${platform.signaturePath} --output ${plan.manifestOutputPath}`,
    "",
    "## Latest Release URL",
    `- ${plan.latestManifestReleaseUrl}`,
    "",
  ].join("\n");
}

export function writeUpdaterManifestFromPlan(plan, { version, pubDate, notes }) {
  if (!plan?.manifestOutputPath || !Array.isArray(plan.manifestPlatforms) || plan.manifestPlatforms.length === 0) {
    fail("A valid updater plan with at least one manifest platform is required.");
  }
  if (!version || !pubDate) {
    fail("version and pubDate are required to write updater manifest.");
  }

  const manifest = {
    version,
    notes,
    pub_date: new Date(pubDate).toISOString(),
    platforms: Object.fromEntries(
      plan.manifestPlatforms.map((platform) => [
        platform.target,
        {
          url: platform.url,
          signature: readSignature(platform.signaturePath),
        },
      ]),
    ),
  };

  fs.mkdirSync(path.dirname(plan.manifestOutputPath), { recursive: true });
  fs.writeFileSync(plan.manifestOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    outputPath: plan.manifestOutputPath,
    manifest,
  };
}