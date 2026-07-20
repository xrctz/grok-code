#!/usr/bin/env node
/**
 * Ensure a VS Code binary exists for Grok Code on Windows, macOS, or Linux.
 * Downloads the correct archive for the host OS, extracts it, applies branding,
 * and prints the absolute path of the `code` / Code.exe binary on stdout (last line).
 *
 * Usage:
 *   node scripts/ensure-vscode-binary.mjs [--force]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT,
  codeBinaryInApp,
  defaultCacheRoot,
  isCodeBinary,
  normalizePlatform,
  resolveRealPath,
  resourcesAppDir,
  vscodeDownloadSpec,
} from "./lib/platform.mjs";

const FORCE = process.argv.includes("--force");
const PLATFORM = normalizePlatform();
const CACHE_ROOT = defaultCacheRoot();
const APP_DIR = process.env.GROK_CODE_APP || path.join(CACHE_ROOT, "app");
const DOWNLOAD_DIR =
  process.env.GROK_CODE_DOWNLOAD_DIR || path.join(CACHE_ROOT, "download");
const LEGACY_APP = "/tmp/vscode-extract/usr/share/code";

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

/**
 * @param {string} url
 * @param {string} dest
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = url.startsWith("https:") ? https.get : http.get;
    const req = get(url, { headers: { "User-Agent": "grok-code-bootstrap" } }, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    });
    req.on("error", (err) => {
      try {
        file.close();
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      reject(err);
    });
  });
}

/**
 * Prefer system curl/wget when available (better retries); fall back to Node https.
 * @param {string} url
 * @param {string} dest
 */
async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const curl = spawnSync(
    "curl",
    ["-fL", "--retry", "3", "--retry-delay", "2", "-o", dest, url],
    { stdio: "inherit" }
  );
  if (curl.status === 0 && fs.existsSync(dest)) return;
  const wget = spawnSync("wget", ["-O", dest, url], { stdio: "inherit" });
  if (wget.status === 0 && fs.existsSync(dest)) return;
  log("curl/wget unavailable or failed; using Node https…");
  await downloadFile(url, dest);
}

/**
 * Extract archive into targetDir (contents land directly under targetDir).
 * @param {string} archive
 * @param {"zip"|"tar.gz"} kind
 * @param {string} targetDir
 */
function extractArchive(archive, kind, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  if (kind === "tar.gz") {
    const r = spawnSync("tar", ["-xzf", archive, "-C", targetDir], {
      stdio: "inherit",
    });
    if (r.status !== 0) {
      throw new Error(`tar extract failed for ${archive}`);
    }
    return;
  }

  // zip — try unzip, then PowerShell Expand-Archive, then Node fallback is not available
  const unzip = spawnSync("unzip", ["-qo", archive, "-d", targetDir], {
    stdio: "inherit",
  });
  if (unzip.status === 0) return;

  if (PLATFORM === "win32") {
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" }
    );
    if (ps.status === 0) return;
  }

  // macOS / some Linux: ditto
  if (PLATFORM === "darwin") {
    const ditto = spawnSync("ditto", ["-x", "-k", archive, targetDir], {
      stdio: "inherit",
    });
    if (ditto.status === 0) return;
  }

  throw new Error(
    `Could not extract ${archive}. Install unzip (Ubuntu: sudo apt install unzip) and retry.`
  );
}

/**
 * After extract, locate the app root (handles nested single-dir tarballs / .app bundles).
 * @param {string} extractRoot
 */
function locateAppRoot(extractRoot) {
  const bin = codeBinaryInApp(extractRoot, PLATFORM);
  if (isCodeBinary(bin, PLATFORM)) return extractRoot;

  const entries = fs.readdirSync(extractRoot, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const child = path.join(extractRoot, ent.name);
    if (PLATFORM === "darwin" && ent.name.endsWith(".app")) {
      if (isCodeBinary(codeBinaryInApp(child, PLATFORM), PLATFORM)) return child;
    }
    if (isCodeBinary(codeBinaryInApp(child, PLATFORM), PLATFORM)) return child;
  }

  // Deep search for Code.exe / bin/code one level deeper
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const child = path.join(extractRoot, ent.name);
    const nested = fs.readdirSync(child, { withFileTypes: true });
    for (const n of nested) {
      if (!n.isDirectory()) continue;
      const deep = path.join(child, n.name);
      if (isCodeBinary(codeBinaryInApp(deep, PLATFORM), PLATFORM)) return deep;
    }
  }

  throw new Error(`Unexpected VS Code archive layout under ${extractRoot}`);
}

function which(cmd) {
  const r = spawnSync(
    PLATFORM === "win32" ? "where" : "which",
    [cmd],
    { encoding: "utf8" }
  );
  if (r.status !== 0) return null;
  const line = (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line || null;
}

function findExisting() {
  /** @type {string[]} */
  const candidates = [];
  if (process.env.CODE_BIN) candidates.push(process.env.CODE_BIN);
  candidates.push(codeBinaryInApp(APP_DIR, PLATFORM));

  if (PLATFORM === "linux") {
    candidates.push(
      path.join(LEGACY_APP, "bin", "code"),
      "/tmp/vscode-extract/usr/share/code/bin/code",
      "/usr/share/code/bin/code",
      "/usr/bin/code",
      "/usr/share/code-oss/bin/code-oss",
      "/usr/bin/code-oss",
      "/usr/bin/codium",
      "/snap/bin/code"
    );
  } else if (PLATFORM === "darwin") {
    candidates.push(
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "/Applications/Code - OSS.app/Contents/Resources/app/bin/code",
      path.join(
        os.homedir(),
        "Applications",
        "Visual Studio Code.app",
        "Contents",
        "Resources",
        "app",
        "bin",
        "code"
      )
    );
  } else if (PLATFORM === "win32") {
    const local = process.env.LOCALAPPDATA || "";
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    candidates.push(
      path.join(local, "Programs", "Microsoft VS Code", "Code.exe"),
      path.join(pf, "Microsoft VS Code", "Code.exe"),
      path.join(pf, "Microsoft VS Code Insiders", "Code - Insiders.exe")
    );
  }

  for (const name of ["code", "code-oss", "codium"]) {
    const found = which(name);
    if (found) candidates.push(found);
  }

  for (const c of candidates) {
    if (isCodeBinary(c, PLATFORM)) {
      return resolveRealPath(c);
    }
  }
  return null;
}

function applyBranding(appDir) {
  const patch = path.join(REPO_ROOT, "scripts", "patch-binary-branding.mjs");
  const resources = resourcesAppDir(appDir, PLATFORM);
  if (!fs.existsSync(resources)) {
    log(`Skip branding: no resources/app at ${resources}`);
    return;
  }
  log("Applying Grok Code branding…");
  const r = spawnSync(process.execPath, [patch, appDir], { stdio: "inherit" });
  if (r.status !== 0) {
    log("Warning: branding patch failed (continuing).");
  }
}

async function downloadAndExtract() {
  const spec = vscodeDownloadSpec();
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(CACHE_ROOT, { recursive: true });

  const archive = path.join(
    DOWNLOAD_DIR,
    `vscode-${spec.quality}${spec.archiveExt}`
  );
  const extractTmp = path.join(DOWNLOAD_DIR, `extract-${process.pid}`);

  log(`Downloading VS Code (${spec.quality}, stable) for ${PLATFORM}…`);
  await download(spec.url, archive);

  log(`Extracting to ${APP_DIR} …`);
  fs.rmSync(extractTmp, { recursive: true, force: true });
  fs.mkdirSync(extractTmp, { recursive: true });
  extractArchive(archive, spec.archiveKind, extractTmp);

  const unpacked = locateAppRoot(extractTmp);
  fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(APP_DIR), { recursive: true });
  fs.renameSync(unpacked, APP_DIR);
  fs.rmSync(extractTmp, { recursive: true, force: true });

  fs.writeFileSync(
    path.join(CACHE_ROOT, "installed-at.txt"),
    new Date().toISOString() + "\n"
  );
  fs.writeFileSync(path.join(CACHE_ROOT, "source-url.txt"), spec.url + "\n");
  fs.writeFileSync(
    path.join(CACHE_ROOT, "platform.txt"),
    `${PLATFORM} ${spec.arch}\n`
  );

  const bin = codeBinaryInApp(APP_DIR, PLATFORM);
  if (PLATFORM !== "win32") {
    try {
      fs.chmodSync(bin, 0o755);
    } catch {
      /* ignore */
    }
  }

  log(`VS Code installed at ${APP_DIR}`);
  return bin;
}

async function main() {
  if (!FORCE) {
    const existing = findExisting();
    if (existing) {
      // Brand only our managed app tree
      const managed = codeBinaryInApp(APP_DIR, PLATFORM);
      if (
        existing === managed ||
        existing === resolveRealPath(managed) ||
        (PLATFORM === "linux" && existing.includes("vscode-extract"))
      ) {
        const appRoot =
          PLATFORM === "darwin"
            ? path.resolve(path.dirname(existing), "..", "..", "..", "..")
            : path.resolve(path.dirname(existing), "..");
        const css = path.join(
          resourcesAppDir(appRoot, PLATFORM),
          "out",
          "vs",
          "code",
          "electron-browser",
          "workbench",
          "grok-code.css"
        );
        if (fs.existsSync(resourcesAppDir(appRoot, PLATFORM)) && !fs.existsSync(css)) {
          applyBranding(appRoot);
        }
      }
      process.stdout.write(`${existing}\n`);
      return;
    }
  }

  if (FORCE) log("Forcing re-download of VS Code…");
  else log("No VS Code / Code - OSS binary found. Bootstrapping…");

  const bin = await downloadAndExtract();
  applyBranding(APP_DIR);

  if (!isCodeBinary(bin, PLATFORM)) {
    throw new Error(`Bootstrap failed: ${bin} missing`);
  }

  // Symlink legacy Linux path for older scripts
  if (PLATFORM === "linux" && !fs.existsSync(path.join(LEGACY_APP, "bin", "code"))) {
    try {
      fs.mkdirSync(path.dirname(LEGACY_APP), { recursive: true });
      fs.symlinkSync(APP_DIR, LEGACY_APP, "dir");
    } catch {
      /* ignore */
    }
  }

  process.stdout.write(`${bin}\n`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
