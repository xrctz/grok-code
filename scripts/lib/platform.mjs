#!/usr/bin/env node
/**
 * Cross-platform helpers for Grok Code (Windows, macOS, Linux/Ubuntu).
 * Pure Node — no shell assumptions — so launch/bootstrap works everywhere.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** @typedef {"win32"|"darwin"|"linux"} GrokPlatform */

/**
 * @param {NodeJS.Platform} [platform]
 * @returns {GrokPlatform}
 */
export function normalizePlatform(platform = process.platform) {
  if (platform === "win32") return "win32";
  if (platform === "darwin") return "darwin";
  return "linux";
}

/**
 * Map Node arch / uname to VS Code download arch tokens.
 * @param {string} [arch]
 */
export function vscodeArch(arch = process.arch) {
  switch (arch) {
    case "x64":
    case "x86_64":
    case "amd64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    case "arm":
    case "armhf":
    case "armv7l":
      return "armhf";
    case "ia32":
      return "ia32";
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }
}

/**
 * Default on-disk cache for the branded VS Code binary.
 * Linux/Ubuntu: ~/.local/share/grok-code (XDG)
 * macOS: ~/Library/Application Support/grok-code
 * Windows: %LOCALAPPDATA%\\grok-code
 * @param {NodeJS.ProcessEnv} [env]
 * @param {GrokPlatform} [platform]
 */
export function defaultCacheRoot(env = process.env, platform = normalizePlatform()) {
  if (env.GROK_CODE_CACHE) return env.GROK_CODE_CACHE;
  const home = env.HOME || env.USERPROFILE || os.homedir();
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(local, "grok-code");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "grok-code");
  }
  const xdg = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdg, "grok-code");
}

/**
 * Editor user-data profile (settings, extensions dir parent).
 * Kept at ~/.grok-code-app on all platforms for a stable, memorable path.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function defaultUserDataDir(env = process.env) {
  if (env.GROK_CODE_USER_DATA) return env.GROK_CODE_USER_DATA;
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(home, ".grok-code-app");
}

/**
 * VS Code update feed URL + archive kind for this host.
 * @param {{ platform?: GrokPlatform, arch?: string }} [opts]
 */
export function vscodeDownloadSpec(opts = {}) {
  const platform = opts.platform || normalizePlatform();
  const arch = vscodeArch(opts.arch || process.arch);

  if (platform === "win32") {
    if (arch === "armhf" || arch === "ia32") {
      throw new Error(`Unsupported Windows architecture for bootstrap: ${arch}`);
    }
    const quality = arch === "arm64" ? "win32-arm64-archive" : "win32-x64-archive";
    return {
      platform,
      arch,
      quality,
      url: `https://update.code.visualstudio.com/latest/${quality}/stable`,
      archiveExt: ".zip",
      archiveKind: "zip",
    };
  }

  if (platform === "darwin") {
    const quality = arch === "arm64" ? "darwin-arm64" : "darwin";
    return {
      platform,
      arch,
      quality,
      url: `https://update.code.visualstudio.com/latest/${quality}/stable`,
      archiveExt: ".zip",
      archiveKind: "zip",
    };
  }

  // linux / ubuntu (primary target)
  if (arch === "ia32") {
    throw new Error("Unsupported Linux architecture for bootstrap: ia32");
  }
  const quality = `linux-${arch}`;
  return {
    platform,
    arch,
    quality,
    url: `https://update.code.visualstudio.com/latest/${quality}/stable`,
    archiveExt: ".tar.gz",
    archiveKind: "tar.gz",
  };
}

/**
 * Absolute path to the `code` / Code.exe binary inside a managed app tree.
 * @param {string} appDir
 * @param {GrokPlatform} [platform]
 */
export function codeBinaryInApp(appDir, platform = normalizePlatform()) {
  if (platform === "win32") {
    return path.join(appDir, "Code.exe");
  }
  if (platform === "darwin") {
    return path.join(
      appDir,
      "Contents",
      "Resources",
      "app",
      "bin",
      "code"
    );
  }
  return path.join(appDir, "bin", "code");
}

/**
 * Root of the VS Code `resources/app` tree for branding patches.
 * @param {string} appDir
 * @param {GrokPlatform} [platform]
 */
export function resourcesAppDir(appDir, platform = normalizePlatform()) {
  if (platform === "darwin") {
    return path.join(appDir, "Contents", "Resources", "app");
  }
  return path.join(appDir, "resources", "app");
}

/**
 * Platform-specific Chromium flags safe to pass to the Electron binary.
 * Sandbox flags are Linux-oriented (containers / Ubuntu desktops).
 * @param {GrokPlatform} [platform]
 */
export function electronLaunchFlags(platform = normalizePlatform()) {
  if (platform === "linux") {
    return ["--no-sandbox", "--disable-gpu-sandbox"];
  }
  return [];
}

/**
 * Common user bin dirs that GUI apps often miss (no shell rc).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {GrokPlatform} [platform]
 */
export function extraBinDirs(env = process.env, platform = normalizePlatform()) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const dirs = [
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".deno", "bin"),
    path.join(home, ".grok", "bin"),
  ];

  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const roaming = env.APPDATA || path.join(home, "AppData", "Roaming");
    dirs.push(
      path.join(local, "Programs"),
      path.join(roaming, "npm"),
      path.join(home, "AppData", "Roaming", "npm"),
      path.join(local, "Microsoft", "WindowsApps")
    );
  } else if (platform === "darwin") {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
  } else {
    dirs.push("/usr/local/bin", "/usr/bin", "/snap/bin");
  }

  return dirs;
}

/**
 * Whether a path looks like a usable Code binary (file exists; executable bit on Unix).
 * @param {string} p
 * @param {GrokPlatform} [platform]
 */
export function isCodeBinary(p, platform = normalizePlatform()) {
  if (!p) return false;
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (platform === "win32") return true;
    // Prefer execute bit; still accept readable files (some mounts omit +x)
    return (st.mode & 0o111) !== 0 || (st.mode & 0o444) !== 0;
  } catch {
    return false;
  }
}

/**
 * Resolve a real path when possible (handles symlinks).
 * @param {string} p
 */
export function resolveRealPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Default Grok CLI binary path.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function defaultGrokRealBin(env = process.env) {
  if (env.GROK_REAL_BIN) return env.GROK_REAL_BIN;
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const base = path.join(home, ".grok", "bin", "grok");
  if (normalizePlatform() === "win32") {
    return base + ".exe";
  }
  return base;
}

/**
 * Shell profile candidates for PATH install (Ubuntu bash first, then zsh/macOS, then PowerShell notes).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {GrokPlatform} [platform]
 */
export function shellProfileCandidates(env = process.env, platform = normalizePlatform()) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  if (platform === "win32") {
    return [];
  }
  if (platform === "darwin") {
    return [
      path.join(home, ".zshrc"),
      path.join(home, ".zprofile"),
      path.join(home, ".bashrc"),
      path.join(home, ".bash_profile"),
    ];
  }
  // Ubuntu / Linux — bash is the default login shell for most desktops
  return [
    path.join(home, ".bashrc"),
    path.join(home, ".bash_profile"),
    path.join(home, ".profile"),
    path.join(home, ".zshrc"),
  ];
}

/**
 * Which OS label to show in docs / CLI.
 * @param {GrokPlatform} [platform]
 */
export function platformLabel(platform = normalizePlatform()) {
  switch (platform) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    default:
      return "Linux / Ubuntu";
  }
}
