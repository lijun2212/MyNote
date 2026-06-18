import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const positionalArgs = rawArgs.filter((arg) => arg !== "--dry-run");

function resolveTagFromGit() {
  const result = spawnSync("git", ["describe", "--tags", "--exact-match", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    console.log("Unable to determine release tag from current HEAD.");
    console.log("Provide a tag explicitly, for example: corepack pnpm prepare:release v0.2.3 --dry-run");
    if (stderr) {
      console.log(stderr);
    }
    process.exit(1);
  }

  return result.stdout.trim();
}

function normalizeTag(rawTag) {
  const trimmed = rawTag.trim().replace(/^refs\/tags\//, "");
  if (!VERSION_TAG_PATTERN.test(trimmed)) {
    console.error(`Invalid release tag '${rawTag}'. Expected forms like v0.2.3 or 0.2.3.`);
    process.exit(1);
  }
  return trimmed.replace(/^v/, "");
}

const tagInput = positionalArgs[0] ?? process.env.GIT_TAG ?? resolveTagFromGit();
const normalizedVersion = normalizeTag(tagInput);
const releaseDate = process.env.RELEASE_DATE ?? (() => {
  const today = new Date();
  return `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日`;
})();

const syncScriptPath = path.join(repoRoot, "scripts", "sync-version.mjs");
const syncArgs = [syncScriptPath, normalizedVersion];
if (dryRun) {
  syncArgs.push("--dry-run");
}

console.log(`Preparing release metadata from tag ${tagInput} -> version ${normalizedVersion}`);
console.log(`Release date: ${releaseDate}`);

execFileSync(process.execPath, syncArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    RELEASE_DATE: releaseDate,
  },
});