import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateNotesInDirectory } from "./lib/tagSyntaxMigration.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function printUsage() {
  console.log("Usage: node scripts/migrate-inline-tags.mjs [--apply] [--notes-dir <path>]");
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const notesDirFlagIndex = args.indexOf("--notes-dir");
const notesDir = notesDirFlagIndex >= 0 ? args[notesDirFlagIndex + 1] : path.join(repoRoot, "notes");

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (notesDirFlagIndex >= 0 && !notesDir) {
  console.error("Missing value for --notes-dir.");
  printUsage();
  process.exit(1);
}

const summary = migrateNotesInDirectory(path.resolve(notesDir), { apply });
const modeLabel = apply ? "apply" : "dry-run";

console.log(`[${modeLabel}] scanned ${summary.scannedFileCount} markdown files under ${path.resolve(notesDir)}`);
console.log(`[${modeLabel}] changed ${summary.changedFileCount} files, converted ${summary.convertedReferenceCount} legacy references, added ${summary.addedFrontMatterTagCount} front matter tag entries`);

for (const file of summary.changedFiles.slice(0, 20)) {
  const relativePath = path.relative(repoRoot, file.path) || file.path;
  console.log(`- ${relativePath}: refs ${file.convertedCount}, fm tags ${file.addedFrontMatterTagCount}`);
}

if (summary.changedFiles.length > 20) {
  console.log(`- ... ${summary.changedFiles.length - 20} more files`);
}

if (!apply) {
  console.log("Use --apply to write the migrated content back to disk.");
}