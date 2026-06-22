import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execCorepack } from "./lib/execCorepack.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const force = rawArgs.includes("--force");
const positionalArgs = rawArgs.filter((arg) => arg !== "--dry-run" && arg !== "--force");

const outputPath = positionalArgs[0]
  ? path.resolve(repoRoot, positionalArgs[0])
  : path.join(repoRoot, ".local", "updater", "updater.key");

if (!force && fs.existsSync(outputPath)) {
  console.error(`Updater private key already exists: ${path.relative(repoRoot, outputPath)}`);
  console.error("Use --force to overwrite it, or pass another output path.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const commandArgs = ["pnpm", "tauri", "signer", "generate", "--ci", "-w", outputPath];
if (force) {
  commandArgs.push("--force");
}

console.log(`Generating updater signing key at ${path.relative(repoRoot, outputPath)}`);
console.log("The Tauri CLI will print the public key to stdout. Keep the private key out of git.");

if (dryRun) {
  console.log(`[dry-run] Would run: corepack ${commandArgs.join(" ")}`);
  process.exit(0);
}

execCorepack(commandArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});