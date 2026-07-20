#!/usr/bin/env node
/**
 * Install the system `grok` entrypoint so bare `grok` opens Grok Code + Grok Build.
 * Ubuntu/Linux: ~/.local/bin/grok + ~/.bashrc PATH block + .desktop file
 * macOS: ~/.local/bin/grok + ~/.zshrc PATH block
 * Windows: %USERPROFILE%\\.local\\bin\\grok.cmd (+ instructions for PATH)
 *
 * Usage:
 *   npm run install:shell
 *   node scripts/install-grok-shell.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REPO_ROOT,
  defaultGrokRealBin,
  normalizePlatform,
  platformLabel,
  shellProfileCandidates,
} from "./lib/platform.mjs";

const PLATFORM = normalizePlatform();
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const INSTALL_DIR =
  process.env.GROK_WRAPPER_DIR || path.join(HOME, ".local", "bin");
const MARKER_BEGIN = "# >>> grok-code launcher >>>";
const MARKER_END = "# <<< grok-code launcher <<<";

fs.mkdirSync(INSTALL_DIR, { recursive: true });

function upsertProfileBlock(profilePath, block) {
  let text = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, "utf8") : "";
  const re = /# >>> grok-code launcher >>>[\s\S]*?# <<< grok-code launcher <<<\n?/;
  text = text.replace(re, "");
  if (!text.endsWith("\n")) text += "\n";
  text += block + (block.endsWith("\n") ? "" : "\n");
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, text);
  console.log("Updated", profilePath);
}

function writeUnixWrapper() {
  const installPath = path.join(INSTALL_DIR, "grok");
  const wrapperSrc = path.join(REPO_ROOT, "scripts", "grok-wrapper.sh");
  if (!fs.existsSync(wrapperSrc)) {
    throw new Error(`Missing wrapper: ${wrapperSrc}`);
  }
  let text = fs.readFileSync(wrapperSrc, "utf8");
  const pin = `ROOT="\${GROK_CODE_ROOT:-${REPO_ROOT}}"
if [[ ! -f "$ROOT/scripts/launch-grok-code.sh" && ! -f "$ROOT/scripts/launch-grok-code.mjs" ]]; then
  ROOT="$(resolve_root || true)"
fi`;
  const old = 'ROOT="$(resolve_root || true)"';
  if (!text.includes(old)) {
    throw new Error(`pin target not found in ${wrapperSrc}`);
  }
  text = text.replace(old, pin);
  fs.writeFileSync(installPath, text, { mode: 0o755 });
  try {
    fs.chmodSync(installPath, 0o755);
  } catch {
    /* ignore */
  }
  console.log(`Pinned GROK_CODE_ROOT default → ${REPO_ROOT}`);
  return installPath;
}

function writeWindowsWrapper() {
  const installPath = path.join(INSTALL_DIR, "grok.cmd");
  const body = `@echo off
REM GROK_CODE_LAUNCHER_WRAPPER
set "GROK_CODE_ROOT=${REPO_ROOT.replace(/%/g, "%%")}"
set "GROK_REAL_BIN=%GROK_REAL_BIN%"
if "%GROK_REAL_BIN%"=="" set "GROK_REAL_BIN=%USERPROFILE%\\.grok\\bin\\grok.exe"
set "GROK_CODE_OPEN_AGENT=1"
set "GROK_CODE_CWD=%CD%"
if /I "%~1"=="--standalone" (
  shift
  "%GROK_REAL_BIN%" %*
  exit /b %ERRORLEVEL%
)
node "%GROK_CODE_ROOT%\\scripts\\launch-grok-code.mjs" %*
`;
  fs.writeFileSync(installPath, body);
  return installPath;
}

function updateGrokToml() {
  const mcpEntry = path.join(
    REPO_ROOT,
    "vscode-mcp",
    "mcp-server",
    "dist",
    "index.js"
  );
  const cfg = path.join(HOME, ".grok", "config.toml");
  if (!fs.existsSync(mcpEntry) || !fs.existsSync(cfg)) return;
  let text = fs.readFileSync(cfg, "utf8");
  const parts = text.split(/(?=^\[)/m);
  const out = parts.map((p) => {
    if (p.startsWith("[mcp_servers.grok-code]")) {
      return p.replace(/args\s*=\s*\[[^\]]*\]/, `args = [${JSON.stringify(mcpEntry)}]`);
    }
    return p;
  });
  fs.writeFileSync(cfg, out.join(""));
  console.log(`Updated ~/.grok/config.toml grok-code MCP → ${mcpEntry}`);
}

function writeDesktopFile() {
  if (PLATFORM !== "linux") return;
  const appDir = process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, "applications")
    : path.join(HOME, ".local", "share", "applications");
  fs.mkdirSync(appDir, { recursive: true });
  const icon = path.join(
    REPO_ROOT,
    "vscode-mcp",
    "grok-code-ui",
    "media",
    "icon-256.png"
  );
  const launch = path.join(REPO_ROOT, "scripts", "launch-grok-code.sh");
  const desktop = `[Desktop Entry]
Name=Grok Code
Comment=Grok Code with embedded Grok Build agent
Exec=env GROK_CODE_OPEN_AGENT=1 ${shellQuote(launch)} %F
Icon=${shellQuote(icon)}
Terminal=false
Type=Application
Categories=Development;IDE;
StartupWMClass=code
`;
  fs.writeFileSync(path.join(appDir, "grok-code.desktop"), desktop);
}

/** @param {string} s */
function shellQuote(s) {
  if (/^[A-Za-z0-9_./:-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const realBin = defaultGrokRealBin();
if (!fs.existsSync(realBin)) {
  console.warn(`Warning: ${realBin} not found. Install Grok Build first.`);
}

const installPath =
  PLATFORM === "win32" ? writeWindowsWrapper() : writeUnixWrapper();

updateGrokToml();

if (PLATFORM !== "win32") {
  const block = `${MARKER_BEGIN}
export GROK_CODE_ROOT=${JSON.stringify(REPO_ROOT)}
export GROK_REAL_BIN="$HOME/.grok/bin/grok"
# Prefer ~/.local/bin so \`grok\` launches Grok Code (wrapper) over ~/.grok/bin
export PATH="${INSTALL_DIR}:$HOME/.grok/bin:$PATH"
${MARKER_END}
`;
  const profiles = shellProfileCandidates();
  // Ubuntu: update the first existing profile (usually ~/.bashrc); always create .bashrc if none exist
  const existing = profiles.filter((p) => fs.existsSync(p));
  const targets = existing.length ? [existing[0]] : [profiles[0]];
  // On macOS also update .zshrc if both bash and zsh exist and we picked bash — prefer first existing
  for (const p of targets) {
    if (p) upsertProfileBlock(p, block);
  }
  writeDesktopFile();
}

console.log("");
console.log(`Installed for ${platformLabel()}:`);
console.log(`  wrapper : ${installPath}`);
console.log(`  real bin: ${realBin}`);
console.log(`  repo    : ${REPO_ROOT}`);
console.log("");
console.log("Usage:");
console.log("  grok                 → Grok Code + embedded Grok Build (agent in-app)");
console.log('  grok "fix the bug"   → same, with initial prompt');
console.log("  grok --standalone    → classic Grok Build TUI only");
console.log("");
if (PLATFORM === "win32") {
  console.log(`Add to PATH:  ${INSTALL_DIR}`);
  console.log("  (System Properties → Environment Variables → User PATH)");
  console.log("Or from PowerShell:");
  console.log(
    `  [Environment]::SetEnvironmentVariable("Path", $env:Path + ";${INSTALL_DIR}", "User")`
  );
} else if (PLATFORM === "darwin") {
  console.log("Reload shell:  source ~/.zshrc");
} else {
  console.log("Reload shell:  source ~/.bashrc");
}
console.log("Or open a new terminal, then type:  grok");
