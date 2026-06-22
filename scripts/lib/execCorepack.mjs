import { execFileSync } from "node:child_process";

export function execCorepack(args, options) {
  if (process.platform === "win32") {
    return execFileSync("corepack", args, {
      ...options,
      shell: true,
    });
  }

  return execFileSync("corepack", args, options);
}