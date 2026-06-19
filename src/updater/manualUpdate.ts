import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import appUpdateConfig from "../config/appUpdateConfig.json";

export interface AppUpdateConfig {
  provider: "release-page" | "tauri-updater";
  releasePageUrl: string;
  updaterManifestUrl: string;
  updaterPubkey: string;
}

export type ManualUpdateCheckResult =
  | {
      status: "up-to-date";
      currentVersion: string;
    }
  | {
      status: "release-page";
      releasePageUrl: string;
    }
  | {
      status: "update-available";
      currentVersion: string;
      version: string;
      date?: string;
      body?: string;
      update: Update;
    };

function getResolvedConfig(overrides?: Partial<AppUpdateConfig>): AppUpdateConfig {
  const provider = appUpdateConfig.provider === "tauri-updater" ? "tauri-updater" : "release-page";

  return {
    provider,
    releasePageUrl: appUpdateConfig.releasePageUrl,
    updaterManifestUrl: appUpdateConfig.updaterManifestUrl,
    updaterPubkey: appUpdateConfig.updaterPubkey,
    ...overrides,
  };
}

export async function checkForManualUpdate(overrides?: Partial<AppUpdateConfig>): Promise<ManualUpdateCheckResult> {
  const config = getResolvedConfig(overrides);

  if (config.provider === "release-page") {
    await openUrl(config.releasePageUrl);
    return {
      status: "release-page",
      releasePageUrl: config.releasePageUrl,
    };
  }

  const update = await check();

  if (!update) {
    return {
      status: "up-to-date",
      currentVersion: await getVersion(),
    };
  }

  return {
    status: "update-available",
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date,
    body: update.body,
    update,
  };
}

export async function installManualUpdate(result: Extract<ManualUpdateCheckResult, { status: "update-available" }>) {
  await result.update.downloadAndInstall();
  await relaunch();
}