import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const planPathArg = rawArgs.find((arg) => !arg.startsWith("--"));
const planPath = path.resolve(repoRoot, planPathArg ?? path.join("release", "updater", "publish-plan.json"));
const winGetLinksPath = process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links")
  : null;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function buildGhEnv() {
  if (process.platform !== "win32" || !winGetLinksPath) {
    return process.env;
  }

  const currentPath = process.env.Path ?? process.env.PATH ?? "";
  const pathSegments = currentPath.split(path.delimiter).filter(Boolean);
  if (pathSegments.includes(winGetLinksPath)) {
    return process.env;
  }

  return {
    ...process.env,
    Path: `${winGetLinksPath}${path.delimiter}${currentPath}`,
  };
}

function resolveGhCommand() {
  const configuredPath = process.env.GITHUB_CLI_PATH;
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  if (process.platform !== "win32") {
    return "gh";
  }

  const candidatePaths = [
    winGetLinksPath ? path.join(winGetLinksPath, "gh.exe") : null,
    path.join(process.env.ProgramFiles ?? "", "GitHub CLI", "gh.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "GitHub CLI", "gh.exe"),
  ].filter(Boolean);

  const existingPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
  return existingPath ?? "gh";
}

const ghCommand = resolveGhCommand();
const ghEnv = buildGhEnv();

function readPlan() {
  if (!fs.existsSync(planPath)) {
    fail([
      `Publish plan not found: ${path.relative(repoRoot, planPath)}`,
      "Run `corepack pnpm release:build <version>` first and make sure it completes successfully.",
      "If release:build fails before Step 3/3, publish-plan.json and latest.json will not be created.",
    ].join("\n"));
  }

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  if (!plan?.repository || !plan?.releaseTag || !Array.isArray(plan?.releaseAssets)) {
    fail("Publish plan is missing GitHub release metadata. Re-run `corepack pnpm release:build <version>`.");
  }
  return plan;
}

function runGh(args, options = {}) {
  try {
    return execFileSync(ghCommand, args, {
      cwd: repoRoot,
      encoding: options.encoding ?? "utf8",
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      env: options.env ?? ghEnv,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`GitHub CLI command failed: gh ${args.join(" ")}\n${message}`);
  }
}

function ensureGitHubCliAvailable() {
  runGh(["--version"]);
}

function ensureGitHubAuth() {
  runGh(["auth", "status"], { stdio: ["ignore", "ignore", "pipe"] });
}

function releaseExists(plan) {
  try {
    runGh(["release", "view", plan.releaseTag, "--repo", plan.repository, "--json", "url"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function getUploadAssets(plan) {
  return [
    ...plan.releaseAssets.map((asset) => asset.localPath),
    plan.manifestOutputPath,
  ];
}

function ensureUploadAssetsExist(assetPaths) {
  const missingAssetPaths = assetPaths.filter((assetPath) => !fs.existsSync(assetPath));
  if (missingAssetPaths.length === 0) {
    return;
  }

  fail([
    "Publish plan references local assets that do not exist on this machine.",
    ...missingAssetPaths.map((assetPath) => `- ${assetPath}`),
    "Re-run `corepack pnpm release:build <version>` on the current machine to generate a fresh publish plan.",
    "If you are publishing updater assets, make sure a matching updater signing private key is available so Step 3/3 can produce signed bundles.",
  ].join("\n"));
}

function createRelease(plan) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  runGh([
    "release",
    "create",
    plan.releaseTag,
    "--repo",
    plan.repository,
    "--target",
    head,
    "--title",
    plan.releaseTag,
    "--notes",
    `Release ${plan.releaseTag}`,
  ], { stdio: "inherit" });
}

const plan = readPlan();
const uploadAssets = getUploadAssets(plan);

if (dryRun) {
  console.log(`Plan: ${path.relative(repoRoot, planPath)}`);
  console.log(`Repository: ${plan.repository}`);
  console.log(`Release tag: ${plan.releaseTag}`);
  console.log("Assets:");
  uploadAssets.forEach((assetPath) => {
    console.log(`- ${path.relative(repoRoot, assetPath)}`);
  });
  process.exit(0);
}

ensureUploadAssetsExist(uploadAssets);
ensureGitHubCliAvailable();
ensureGitHubAuth();

if (!releaseExists(plan)) {
  console.log(`Creating GitHub release ${plan.releaseTag} in ${plan.repository}`);
  createRelease(plan);
}

console.log(`Uploading assets to GitHub release ${plan.releaseTag}`);
runGh([
  "release",
  "upload",
  plan.releaseTag,
  ...uploadAssets,
  "--repo",
  plan.repository,
  "--clobber",
], { stdio: "inherit" });

console.log("GitHub updater publish completed.");