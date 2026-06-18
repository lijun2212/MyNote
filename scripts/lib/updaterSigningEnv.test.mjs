// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDefaultUpdaterSigningEnv } from "./updaterSigningEnv.mjs";

const tempDirs = [];

function makeTempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mynote-updater-env-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("withDefaultUpdaterSigningEnv", () => {
  it("uses the default local updater key path when no signing env is set", () => {
    const repoRoot = makeTempDir();
    const keyPath = path.join(repoRoot, ".local", "updater", "updater.key");
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, "private-key");

    const env = withDefaultUpdaterSigningEnv({}, repoRoot);

    expect(env.TAURI_SIGNING_PRIVATE_KEY).toBe("private-key");
    expect(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe("");
    expect(env.TAURI_SIGNING_PRIVATE_KEY_PATH).toBeUndefined();
  });

  it("does not override an explicitly provided signing key path", () => {
    const repoRoot = makeTempDir();
    const env = withDefaultUpdaterSigningEnv({ TAURI_SIGNING_PRIVATE_KEY_PATH: "/custom/key" }, repoRoot);

    expect(env.TAURI_SIGNING_PRIVATE_KEY_PATH).toBe("/custom/key");
  });

  it("does not add a key path when no default key exists", () => {
    const repoRoot = makeTempDir();

    const env = withDefaultUpdaterSigningEnv({}, repoRoot);

    expect(env.TAURI_SIGNING_PRIVATE_KEY_PATH).toBeUndefined();
  });
});