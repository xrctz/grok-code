#!/usr/bin/env node
/**
 * Launch Grok Code on Windows, macOS, or Linux/Ubuntu.
 * Resolves/downloads the VS Code binary, installs Grok VSIX extensions,
 * seeds Copilot-off settings, and execs the editor.
 *
 * Usage:
 *   node scripts/launch-grok-code.mjs [folder…]
 *   npm run launch -- .
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  defaultGrokRealBin,
  defaultUserDataDir,
  electronLaunchFlags,
  normalizePlatform,
} from "./lib/platform.mjs";

const PLATFORM = normalizePlatform();
const USER_DATA = defaultUserDataDir();
const EXT_DIR = process.env.GROK_CODE_EXT_DIR || path.join(USER_DATA, "extensions");
const SETTINGS_DIR = path.join(USER_DATA, "User");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");
const DEFAULT_SETTINGS = path.join(REPO_ROOT, "scripts", "default-user-settings.json");
const ENSURE = path.join(REPO_ROOT, "scripts", "ensure-vscode-binary.mjs");

process.env.GROK_CODE_ROOT = process.env.GROK_CODE_ROOT || REPO_ROOT;
process.env.GROK_REAL_BIN = process.env.GROK_REAL_BIN || defaultGrokRealBin();

function latestVsix(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".vsix"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) return null;
  return path.join(dir, files[files.length - 1]);
}

function resolveCodeBin() {
  if (process.env.CODE_BIN && fs.existsSync(process.env.CODE_BIN)) {
    return process.env.CODE_BIN;
  }
  const r = spawnSync(process.execPath, [ENSURE], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (r.status !== 0) {
    throw new Error("Failed to resolve VS Code binary via ensure-vscode-binary.mjs");
  }
  const lines = (r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bin = lines[lines.length - 1];
  if (!bin || !fs.existsSync(bin)) {
    throw new Error("ensure-vscode-binary.mjs did not print a valid binary path");
  }
  return bin;
}

function seedSettings() {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.mkdirSync(EXT_DIR, { recursive: true });
  if (!fs.existsSync(DEFAULT_SETTINGS)) return;

  const defaults = JSON.parse(fs.readFileSync(DEFAULT_SETTINGS, "utf8"));
  let current = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      current = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    } catch {
      current = {};
    }
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    current = {};
  }

  const FORCE_OFF = {
    "chat.commandCenter.enabled": false,
    "chat.agent.enabled": false,
    "chat.agent.maxRequests": 0,
    "chat.detectParticipant.enabled": false,
    "chat.experimental.tools.enabled": false,
    "github.copilot.enable": { "*": false },
    "github.copilot.editor.enableAutoCompletions": false,
    "github.copilot.nextEditSuggestions.enabled": false,
    "github.copilot.chat.agent.autoFix": false,
    "github.copilot.chat.claudeAgent.enabled": false,
    "github.copilot.chat.backgroundAgent.enabled": false,
    "github.copilot.chat.cloudAgent.enabled": false,
    "github.copilot.chat.reviewAgent.enabled": false,
    "github.copilot.chat.exploreAgent.enabled": false,
    "notifications.doNotDisturbMode": true,
    "simpleBrowser.focusLockIndicator.enabled": false,
    "grokCode.openGrokTerminalOnStartup": true,
    "grokCode.alwaysApproveAgent": true,
  };

  if (defaults["vscodeMcpBridge.token"] === "") {
    delete defaults["vscodeMcpBridge.token"];
  }

  const merged = { ...defaults, ...current, ...FORCE_OFF };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2) + "\n");
}

function installExtension(codeBin, vsix) {
  console.error(`Installing ${path.basename(vsix)}…`);
  const r = spawnSync(
    codeBin,
    ["--extensions-dir", EXT_DIR, "--install-extension", vsix],
    { stdio: "inherit" }
  );
  if (r.status !== 0) {
    console.error(`Warning: failed to install ${vsix}`);
  }
}

function main() {
  seedSettings();

  let codeBin;
  try {
    codeBin = resolveCodeBin();
  } catch (err) {
    console.error(err.message || err);
    console.error("Run:  npm run ensure-binary");
    console.error("Or set CODE_BIN to a VS Code / Code - OSS binary.");
    process.exit(1);
  }

  console.error(`Using Grok Code binary: ${codeBin}`);

  const bridgeVsix = latestVsix(
    path.join(REPO_ROOT, "vscode-mcp", "extension"),
    "vscode-mcp-bridge-"
  );
  const uiVsix = latestVsix(
    path.join(REPO_ROOT, "vscode-mcp", "grok-code-ui"),
    "grok-code-ui-"
  );
  if (bridgeVsix) installExtension(codeBin, bridgeVsix);
  else console.error("Warning: no vscode-mcp-bridge-*.vsix found");
  if (uiVsix) installExtension(codeBin, uiVsix);
  else console.error("Warning: no grok-code-ui-*.vsix found");

  process.env.GROK_CODE_OPEN_AGENT = process.env.GROK_CODE_OPEN_AGENT || "1";
  process.env.GROK_CODE_CWD = process.env.GROK_CODE_CWD || process.cwd();
  if (!process.env.GROK_CODE_AGENT_PROMPT_FILE) {
    delete process.env.GROK_CODE_AGENT_PROMPT_FILE;
  }

  if (
    process.env.GROK_CODE_OPEN_AGENT === "1" ||
    process.env.GROK_CODE_OPEN_AGENT === "true"
  ) {
    console.error(
      "Grok Build will open inside Grok Code (agent can drive the app via MCP)."
    );
  }

  let args = process.argv.slice(2);
  if (args.length === 0 && process.env.GROK_CODE_CWD && fs.existsSync(process.env.GROK_CODE_CWD)) {
    args = [process.env.GROK_CODE_CWD];
  }

  const electronFlags = electronLaunchFlags(PLATFORM);
  const launchArgs = [
    "--user-data-dir",
    USER_DATA,
    "--extensions-dir",
    EXT_DIR,
    "--disable-workspace-trust",
    "--disable-extension",
    "GitHub.copilot",
    "--disable-extension",
    "GitHub.copilot-chat",
    "--disable-extension",
    "GitHub.copilot-chat-cf",
    ...electronFlags,
    ...args,
  ];

  const child = spawn(codeBin, launchArgs, {
    stdio: "inherit",
    env: process.env,
    windowsHide: false,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

main();
