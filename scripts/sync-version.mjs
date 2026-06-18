import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const versionArg = process.argv[2] ?? process.env.RELEASE_VERSION ?? process.env.npm_package_version;
const releaseDateArg = process.env.RELEASE_DATE;
const dryRun = process.argv.includes("--dry-run");

if (!versionArg) {
  console.error("Missing version. Usage: pnpm sync:version <semver> [--dry-run]");
  process.exit(1);
}

if (!VERSION_PATTERN.test(versionArg)) {
  console.error(`Invalid version '${versionArg}'. Expected semver like 0.2.3 or v0.2.3.`);
  process.exit(1);
}

const normalizedVersion = versionArg.replace(/^v/, "");

function formatReleaseDate(value = new Date()) {
  return `${value.getFullYear()} 年 ${value.getMonth() + 1} 月 ${value.getDate()} 日`;
}

const normalizedReleaseDate = releaseDateArg?.trim() || formatReleaseDate();

const targets = [
  {
    filePath: path.join(repoRoot, "package.json"),
    update: (content) => {
      const data = JSON.parse(content);
      data.version = normalizedVersion;
      return `${JSON.stringify(data, null, 2)}\n`;
    },
  },
  {
    filePath: path.join(repoRoot, "src-tauri", "Cargo.toml"),
    update: (content) => content.replace(/^(version\s*=\s*")[^"]+("\s*)$/m, `$1${normalizedVersion}$2`),
  },
  {
    filePath: path.join(repoRoot, "src-tauri", "tauri.conf.json"),
    update: (content) => {
      const data = JSON.parse(content);
      data.version = normalizedVersion;
      return `${JSON.stringify(data, null, 2)}\n`;
    },
  },
  {
    filePath: path.join(repoRoot, "src", "config", "appReleaseMetadata.json"),
    update: () => `${JSON.stringify({ releaseDate: normalizedReleaseDate }, null, 2)}\n`,
  },
];

const changedFiles = [];

for (const target of targets) {
  const original = await readFile(target.filePath, "utf8");
  const updated = target.update(original);

  if (updated === original) {
    continue;
  }

  changedFiles.push(path.relative(repoRoot, target.filePath));
  if (!dryRun) {
    await writeFile(target.filePath, updated, "utf8");
  }
}

const modeLabel = dryRun ? "[dry-run] " : "";
if (changedFiles.length === 0) {
  console.log(`${modeLabel}Version already synchronized at ${normalizedVersion} (${normalizedReleaseDate}).`);
} else {
  console.log(`${modeLabel}Synchronized version ${normalizedVersion} and release date ${normalizedReleaseDate} in:`);
  changedFiles.forEach((file) => console.log(`- ${file}`));
}