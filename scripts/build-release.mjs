import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import appUpdateConfig from "../src/config/appUpdateConfig.json" with { type: "json" };
import { buildGitHubUpdaterPlan, renderGitHubUpdaterPlanMarkdown, writeUpdaterManifestFromPlan } from "./lib/updaterReleasePlan.mjs";
import { withDefaultUpdaterSigningEnv } from "./lib/updaterSigningEnv.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const buildEnv = withDefaultUpdaterSigningEnv(process.env, repoRoot);
const usingDefaultLocalUpdaterKey = !process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH && !!buildEnv.TAURI_SIGNING_PRIVATE_KEY;

const prepareScriptPath = path.join(repoRoot, "scripts", "prepare-release-from-tag.mjs");
const prepareArgs = [prepareScriptPath, ...rawArgs];

function resolveGitHubRepository(releasePageUrl) {
  const url = new URL(releasePageUrl);
  if (url.hostname !== "github.com") {
    throw new Error(`Expected a GitHub release page URL, got '${releasePageUrl}'.`);
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length < 2) {
    throw new Error(`Unable to resolve GitHub repository from '${releasePageUrl}'.`);
  }

  return `${pathParts[0]}/${pathParts[1]}`;
}

console.log("Step 1/3: preparing release metadata");
if (usingDefaultLocalUpdaterKey && !process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  console.log("Using default local updater key from .local/updater/updater.key");
  console.log("If this key is password-protected, set TAURI_SIGNING_PRIVATE_KEY_PASSWORD before running release:build.");
}
execFileSync(process.execPath, prepareArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  env: buildEnv,
});

const packageJson = readJson("package.json");
const releaseMetadata = readJson(path.join("src", "config", "appReleaseMetadata.json"));

if (dryRun) {
  console.log("Step 2/3: skipped tauri build because --dry-run was provided");
  console.log("Step 3/3: skipped updater manifest and publish plan because no fresh bundle was produced");
  process.exit(0);
}

console.log("Step 2/3: building Tauri bundle");
execFileSync("corepack", ["pnpm", "tauri", "build"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: buildEnv,
});

const releaseTag = `v${packageJson.version}`;
const updaterDirectory = path.join(repoRoot, "release", "updater");
fs.mkdirSync(updaterDirectory, { recursive: true });

try {
  const updaterPlan = buildGitHubUpdaterPlan({
    repoRoot,
    version: packageJson.version,
    releaseTag,
    repository: resolveGitHubRepository(appUpdateConfig.releasePageUrl),
  });

  const manifestResult = writeUpdaterManifestFromPlan(updaterPlan, {
    version: packageJson.version,
    pubDate: buildEnv.RELEASE_PUB_DATE ?? new Date().toISOString(),
    notes: buildEnv.RELEASE_NOTES ?? `Release ${releaseTag} (${releaseMetadata.releaseDate})`,
  });
  fs.writeFileSync(
    path.join(updaterDirectory, "publish-plan.json"),
    `${JSON.stringify(updaterPlan, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(updaterDirectory, "publish-plan.md"),
    `${renderGitHubUpdaterPlanMarkdown(updaterPlan)}\n`,
    "utf8",
  );

  console.log("Step 3/3: updater manifest and publish plan written");
  console.log(`- ${path.relative(repoRoot, manifestResult.outputPath)}`);
  console.log(`- ${path.relative(repoRoot, path.join(updaterDirectory, "publish-plan.json"))}`);
  console.log(`- ${path.relative(repoRoot, path.join(updaterDirectory, "publish-plan.md"))}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log("Step 3/3: skipped updater manifest and publish plan");
  console.log(`Reason: ${message}`);
}