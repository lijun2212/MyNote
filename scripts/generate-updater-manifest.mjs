import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readArgValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  if (index === args.length - 1) {
    fail(`Missing value for ${flag}`);
  }
  return args[index + 1];
}

function collectRepeatedValues(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      if (index === args.length - 1) {
        fail(`Missing value for ${flag}`);
      }
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function normalizeVersion(rawVersion) {
  const trimmed = rawVersion.trim().replace(/^v/, "");
  if (!VERSION_PATTERN.test(trimmed)) {
    fail(`Invalid version '${rawVersion}'. Expected forms like 0.2.3 or v0.2.3.`);
  }
  return trimmed;
}

function normalizePubDate(rawDate) {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    fail(`Invalid RFC3339 date '${rawDate}'.`);
  }
  return date.toISOString();
}

function parsePlatformSpec(rawSpec) {
  const equalIndex = rawSpec.indexOf("=");
  const separatorIndex = rawSpec.indexOf("::");

  if (equalIndex <= 0 || separatorIndex <= equalIndex + 1) {
    fail(`Invalid --platform value '${rawSpec}'. Expected <target>=<url>::<signature-file>.`);
  }

  const target = rawSpec.slice(0, equalIndex).trim();
  const url = rawSpec.slice(equalIndex + 1, separatorIndex).trim();
  const signatureFile = rawSpec.slice(separatorIndex + 2).trim();

  if (!target || !url || !signatureFile) {
    fail(`Invalid --platform value '${rawSpec}'. Expected <target>=<url>::<signature-file>.`);
  }

  try {
    new URL(url);
  } catch {
    fail(`Invalid platform URL '${url}' in '${rawSpec}'.`);
  }

  const absoluteSignatureFile = path.resolve(repoRoot, signatureFile);
  if (!fs.existsSync(absoluteSignatureFile)) {
    fail(`Signature file not found: ${path.relative(repoRoot, absoluteSignatureFile)}`);
  }

  const signature = fs.readFileSync(absoluteSignatureFile, "utf8").trim();
  if (!signature) {
    fail(`Signature file is empty: ${path.relative(repoRoot, absoluteSignatureFile)}`);
  }

  return {
    target,
    url,
    signature,
  };
}

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const filteredArgs = rawArgs.filter((arg) => arg !== "--dry-run");
const positionalArgs = filteredArgs.filter((arg, index, args) => {
  const previous = args[index - 1];
  return previous !== "--version"
    && previous !== "--pub-date"
    && previous !== "--notes"
    && previous !== "--notes-file"
    && previous !== "--output"
    && previous !== "--platform"
    && !arg.startsWith("--");
});

const versionInput = readArgValue(filteredArgs, "--version") ?? positionalArgs[0];
if (!versionInput) {
  fail("Missing version. Use --version 0.2.3 or pass 0.2.3 as the first positional argument.");
}

const version = normalizeVersion(versionInput);
const pubDate = normalizePubDate(readArgValue(filteredArgs, "--pub-date") ?? new Date().toISOString());
const notes = readArgValue(filteredArgs, "--notes");
const notesFile = readArgValue(filteredArgs, "--notes-file");
const outputPath = path.resolve(repoRoot, readArgValue(filteredArgs, "--output") ?? path.join("release", "updater", "latest.json"));
const platformSpecs = collectRepeatedValues(filteredArgs, "--platform");

if (platformSpecs.length === 0) {
  fail("At least one --platform <target>=<url>::<signature-file> entry is required.");
}

let resolvedNotes = notes ?? undefined;
if (notesFile) {
  const notesPath = path.resolve(repoRoot, notesFile);
  if (!fs.existsSync(notesPath)) {
    fail(`Notes file not found: ${path.relative(repoRoot, notesPath)}`);
  }
  resolvedNotes = fs.readFileSync(notesPath, "utf8").trim();
}

const platforms = Object.fromEntries(platformSpecs.map((spec) => {
  const parsed = parsePlatformSpec(spec);
  return [parsed.target, { url: parsed.url, signature: parsed.signature }];
}));

const manifest = {
  version,
  notes: resolvedNotes,
  pub_date: pubDate,
  platforms,
};

console.log(`Generating updater manifest for version ${version}`);
console.log(`Output: ${path.relative(repoRoot, outputPath)}`);
console.log(`Platforms: ${Object.keys(platforms).join(", ")}`);

if (dryRun) {
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Updater manifest written to ${path.relative(repoRoot, outputPath)}`);