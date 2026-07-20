#!/usr/bin/env node
/**
 * Unit tests for cross-platform helpers (Windows / macOS / Linux).
 * Pure — no network, no VS Code binary required.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  codeBinaryInApp,
  defaultCacheRoot,
  defaultUserDataDir,
  electronLaunchFlags,
  extraBinDirs,
  normalizePlatform,
  platformLabel,
  resourcesAppDir,
  shellProfileCandidates,
  vscodeArch,
  vscodeDownloadSpec,
} from "./lib/platform.mjs";

const failures = [];
function check(cond, msg) {
  try {
    assert.ok(cond, msg);
    console.log("OK  :", msg);
  } catch (err) {
    failures.push(msg);
    console.error("FAIL:", msg, "-", err.message);
  }
}

check(normalizePlatform("win32") === "win32", "normalizePlatform win32");
check(normalizePlatform("darwin") === "darwin", "normalizePlatform darwin");
check(normalizePlatform("linux") === "linux", "normalizePlatform linux");
check(normalizePlatform("freebsd") === "linux", "normalizePlatform unknown → linux");

check(vscodeArch("x64") === "x64", "vscodeArch x64");
check(vscodeArch("arm64") === "arm64", "vscodeArch arm64");
check(vscodeArch("aarch64") === "arm64", "vscodeArch aarch64");

const linux = vscodeDownloadSpec({ platform: "linux", arch: "x64" });
check(
  linux.url.includes("linux-x64") && linux.archiveKind === "tar.gz",
  "linux download is tar.gz linux-x64"
);

const macArm = vscodeDownloadSpec({ platform: "darwin", arch: "arm64" });
check(
  macArm.url.includes("darwin-arm64") && macArm.archiveKind === "zip",
  "macOS arm64 download is zip"
);

const macIntel = vscodeDownloadSpec({ platform: "darwin", arch: "x64" });
check(
  macIntel.url.includes("/darwin/") && macIntel.archiveKind === "zip",
  "macOS x64 download uses darwin quality"
);

const win = vscodeDownloadSpec({ platform: "win32", arch: "x64" });
check(
  win.url.includes("win32-x64-archive") && win.archiveKind === "zip",
  "Windows download is win32-x64-archive zip"
);

const winArm = vscodeDownloadSpec({ platform: "win32", arch: "arm64" });
check(
  winArm.url.includes("win32-arm64-archive"),
  "Windows arm64 download quality"
);

check(
  codeBinaryInApp("/app", "linux") === path.join("/app", "bin", "code"),
  "linux code binary path"
);
check(
  codeBinaryInApp("C:\\app", "win32") === path.join("C:\\app", "Code.exe"),
  "windows Code.exe path"
);
check(
  codeBinaryInApp("/Apps/VSCode.app", "darwin").endsWith(
    path.join("Contents", "Resources", "app", "bin", "code")
  ),
  "darwin code binary path inside .app"
);

check(
  resourcesAppDir("/app", "linux") === path.join("/app", "resources", "app"),
  "linux resources/app"
);
check(
  resourcesAppDir("/Apps/VSCode.app", "darwin").includes(
    path.join("Contents", "Resources", "app")
  ),
  "darwin resources/app"
);

check(
  electronLaunchFlags("linux").includes("--no-sandbox"),
  "linux gets --no-sandbox"
);
check(
  electronLaunchFlags("darwin").length === 0,
  "macOS does not force sandbox flags"
);
check(
  electronLaunchFlags("win32").length === 0,
  "Windows does not force sandbox flags"
);

const linuxCache = defaultCacheRoot(
  { HOME: "/home/u", XDG_DATA_HOME: "/home/u/.local/share" },
  "linux"
);
check(
  linuxCache === path.join("/home/u", ".local", "share", "grok-code"),
  "linux cache uses XDG data home"
);

const macCache = defaultCacheRoot({ HOME: "/Users/u" }, "darwin");
check(
  macCache ===
    path.join("/Users/u", "Library", "Application Support", "grok-code"),
  "macOS cache uses Application Support"
);

const winCache = defaultCacheRoot(
  { USERPROFILE: "C:\\Users\\u", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
  "win32"
);
check(
  winCache === path.join("C:\\Users\\u\\AppData\\Local", "grok-code"),
  "Windows cache uses LOCALAPPDATA"
);

check(
  defaultUserDataDir({ HOME: "/home/u" }) ===
    path.join("/home/u", ".grok-code-app"),
  "user data dir is ~/.grok-code-app"
);

const linuxBins = extraBinDirs({ HOME: "/home/u" }, "linux");
check(linuxBins.includes("/snap/bin"), "linux extra bins include /snap/bin");

const macBins = extraBinDirs({ HOME: "/Users/u" }, "darwin");
check(
  macBins.includes("/opt/homebrew/bin"),
  "macOS extra bins include Homebrew"
);

const winBins = extraBinDirs(
  {
    USERPROFILE: "C:\\Users\\u",
    APPDATA: "C:\\Users\\u\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
  },
  "win32"
);
check(
  winBins.some((d) => d.includes("npm")),
  "Windows extra bins include npm roaming"
);

const ubuntuProfiles = shellProfileCandidates({ HOME: "/home/u" }, "linux");
check(
  ubuntuProfiles[0] === path.join("/home/u", ".bashrc"),
  "Ubuntu prefers ~/.bashrc"
);

const macProfiles = shellProfileCandidates({ HOME: "/Users/u" }, "darwin");
check(
  macProfiles[0] === path.join("/Users/u", ".zshrc"),
  "macOS prefers ~/.zshrc"
);

check(platformLabel("linux") === "Linux / Ubuntu", "platform label linux");
check(platformLabel("darwin") === "macOS", "platform label macOS");
check(platformLabel("win32") === "Windows", "platform label Windows");

// Ensure scripts exist
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const rel of [
  "scripts/lib/platform.mjs",
  "scripts/ensure-vscode-binary.mjs",
  "scripts/launch-grok-code.mjs",
  "scripts/patch-binary-branding.mjs",
  "scripts/install-grok-shell.mjs",
  "launch.ps1",
  "scripts/launch-grok-code.ps1",
  "scripts/ensure-vscode-binary.ps1",
]) {
  const p = path.join(root, rel);
  check(fs.existsSync(p), `ships ${rel}`);
}

if (failures.length) {
  console.error(`\n${failures.length} platform test(s) failed`);
  process.exit(1);
}
console.log("\nAll platform tests passed.");
