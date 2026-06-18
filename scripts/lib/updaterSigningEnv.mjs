import fs from "node:fs";
import path from "node:path";

export function withDefaultUpdaterSigningEnv(baseEnv, repoRoot) {
  if (baseEnv.TAURI_SIGNING_PRIVATE_KEY || baseEnv.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    return baseEnv;
  }

  const defaultKeyPath = path.join(repoRoot, ".local", "updater", "updater.key");
  if (!fs.existsSync(defaultKeyPath)) {
    return baseEnv;
  }

  return {
    ...baseEnv,
    TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(defaultKeyPath, "utf8"),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  };
}