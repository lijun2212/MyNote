import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGitLabReleaseLinkSyncPlan, buildGitLabUpdaterUploadPlan } from "./lib/gitLabUpdaterPublish.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const planPathArg = rawArgs.find((arg) => !arg.startsWith("--"));
const planPath = path.resolve(repoRoot, planPathArg ?? path.join("release", "updater", "publish-plan.json"));
const token = process.env.GITLAB_TOKEN ?? process.env.GITLAB_PRIVATE_TOKEN;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readPlan() {
  if (!fs.existsSync(planPath)) {
    fail([
      `Publish plan not found: ${path.relative(repoRoot, planPath)}`,
      "Run `corepack pnpm release:build <version>` first and make sure it completes successfully.",
      "If release:build fails before Step 3/3, publish-plan.json and latest.json will not be created.",
    ].join("\n"));
  }
  return JSON.parse(fs.readFileSync(planPath, "utf8"));
}

function extractProjectPackagesApiUrl(plan) {
  const firstUploadUrl = plan?.packageUploads?.[0]?.packageUrl;
  if (!firstUploadUrl) {
    fail("Publish plan is missing package upload URLs.");
  }

  const marker = "/packages/generic/";
  const markerIndex = firstUploadUrl.indexOf(marker);
  if (markerIndex === -1) {
    fail(`Unable to determine project packages API URL from upload URL: ${firstUploadUrl}`);
  }

  return `${firstUploadUrl.slice(0, markerIndex)}/packages`;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${options?.method ?? "GET"} ${url} failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`);
  }
  return response.status === 204 ? null : response.json();
}

async function readGitLabVersion(projectPackagesApiUrl) {
  const apiRoot = projectPackagesApiUrl.replace(/\/projects\/[^/]+\/packages$/, "");

  try {
    const versionInfo = await requestJson(`${apiRoot}/version`, {
      headers: {
        "PRIVATE-TOKEN": token,
      },
    });
    return versionInfo?.version ? String(versionInfo.version) : null;
  } catch {
    return null;
  }
}

async function ensurePackageRegistryAvailable(plan) {
  const projectPackagesApiUrl = extractProjectPackagesApiUrl(plan);
  const response = await fetch(projectPackagesApiUrl, {
    headers: {
      "PRIVATE-TOKEN": token,
    },
  });

  if (response.ok) {
    return;
  }

  const text = await response.text();
  const gitLabVersion = await readGitLabVersion(projectPackagesApiUrl);
  const versionLine = gitLabVersion ? `GitLab version: ${gitLabVersion}` : "GitLab version: unknown";

  if (response.status === 404) {
    fail([
      `Package Registry API is not available at ${projectPackagesApiUrl}.`,
      versionLine,
      "This release:publish flow depends on GitLab Generic Package Registry endpoints.",
      "Your GitLab instance is responding with 404 for /projects/:id/packages and /packages/generic uploads, so this publish target is not supported as configured.",
      "Use a newer GitLab instance, or switch updater artifacts to another hosting target that provides stable download URLs.",
      text ? `Server response: ${text}` : null,
    ].filter(Boolean).join("\n"));
  }

  fail([
    `Package Registry API probe failed: ${response.status} ${response.statusText}`,
    versionLine,
    text ? `Server response: ${text}` : null,
  ].filter(Boolean).join("\n"));
}

async function uploadFile(localPath, packageUrl) {
  const body = fs.readFileSync(localPath);
  const response = await fetch(packageUrl, {
    method: "PUT",
    headers: {
      "PRIVATE-TOKEN": token,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PUT ${packageUrl} failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`);
  }
}

async function syncReleaseLink(releaseLinksApiUrl, operation) {
  const url = operation.method === "POST"
    ? releaseLinksApiUrl
    : `${releaseLinksApiUrl}/${operation.linkId}`;

  const body = new URLSearchParams({
    name: operation.name,
    url: operation.url,
    direct_asset_path: operation.directAssetPath,
    link_type: operation.linkType,
  });

  await requestJson(url, {
    method: operation.method,
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

const plan = readPlan();
const uploads = buildGitLabUpdaterUploadPlan(plan);

if (dryRun || !token) {
  console.log(`Plan: ${path.relative(repoRoot, planPath)}`);
  console.log("Uploads:");
  uploads.forEach((upload) => {
    console.log(`- ${path.relative(repoRoot, upload.localPath)} -> ${upload.packageUrl}`);
  });

  if (!plan.releaseLinksApiUrl) {
    console.log("Release link sync skipped: releaseLinksApiUrl is missing from publish plan.");
    process.exit(0);
  }

  const syncPlan = buildGitLabReleaseLinkSyncPlan(plan, []);
  console.log("Release link operations:");
  syncPlan.forEach((operation) => {
    console.log(`- ${operation.method} ${operation.name} (${operation.directAssetPath}) -> ${operation.url}`);
  });

  if (!token) {
    console.log("Dry-run enforced because GITLAB_TOKEN / GITLAB_PRIVATE_TOKEN is not set.");
  }
  process.exit(0);
}

await ensurePackageRegistryAvailable(plan);

for (const upload of uploads) {
  console.log(`Uploading ${path.relative(repoRoot, upload.localPath)} -> ${upload.packageUrl}`);
  await uploadFile(upload.localPath, upload.packageUrl);
}

const existingLinks = await requestJson(plan.releaseLinksApiUrl, {
  headers: {
    "PRIVATE-TOKEN": token,
  },
});

const syncPlan = buildGitLabReleaseLinkSyncPlan(plan, existingLinks);
for (const operation of syncPlan) {
  console.log(`${operation.method} release link ${operation.name}`);
  await syncReleaseLink(plan.releaseLinksApiUrl, operation);
}

console.log("GitLab updater publish completed.");