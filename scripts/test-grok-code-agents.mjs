#!/usr/bin/env node
/**
 * Structural tests for Grok Code multi-agent terminal support.
 * Exercises the pure agents.js registry/detection and asserts the UI extension
 * (extension.js, package.json, sidebar.html) is wired to it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const UI = path.join(ROOT, "vscode-mcp", "grok-code-ui");
const failures = [];

function assert(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.error("FAIL:", msg);
  } else {
    console.log("OK  :", msg);
  }
}

// --- 1. Registry shape ---
const agentsMod = require(path.join(UI, "agents.js"));
const { AGENTS, findAgentBinary, listAgents, getAgent, extraBinDirs } = agentsMod;

const expectedIds = ["grok", "claude", "codex", "gemini", "opencode", "aider"];
for (const id of expectedIds) {
  assert(
    AGENTS.some((a) => a.id === id),
    `registry includes agent "${id}"`
  );
}
assert(
  AGENTS.every((a) => a.id && a.label && a.bin && a.accent && a.desc),
  "every agent has id/label/bin/accent/desc"
);
assert(
  getAgent("codex") && getAgent("codex").install.includes("@openai/codex"),
  "codex has an install hint"
);

// Platform-aware extra bin dirs
assert(
  extraBinDirs({ HOME: "/home/u" }, "linux").includes("/snap/bin"),
  "linux extraBinDirs includes /snap/bin"
);
assert(
  extraBinDirs({ HOME: "/Users/u" }, "darwin").includes("/opt/homebrew/bin"),
  "darwin extraBinDirs includes Homebrew"
);
assert(
  extraBinDirs(
    {
      USERPROFILE: "C:\\Users\\u",
      APPDATA: "C:\\Users\\u\\AppData\\Roaming",
    },
    "win32"
  ).some((d) => d.includes("npm")),
  "win32 extraBinDirs includes npm"
);

// --- 2. Binary detection via env override ---
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-agents-"));
const fakeBin = path.join(tmpDir, "codex");
fs.writeFileSync(fakeBin, "#!/bin/sh\necho hi\n", { mode: 0o755 });

const foundViaEnv = findAgentBinary(getAgent("codex"), {
  CODEX_BIN: fakeBin,
  PATH: "",
});
assert(foundViaEnv === fakeBin, "findAgentBinary honours the override env var");

const foundViaPath = findAgentBinary(getAgent("codex"), { PATH: tmpDir });
assert(foundViaPath === fakeBin, "findAgentBinary finds a binary on PATH");

const notFound = findAgentBinary(
  { id: "nope", bin: "definitely-not-a-real-binary-xyz", binEnv: [] },
  { PATH: tmpDir }
);
assert(notFound === null, "findAgentBinary returns null when missing");

// --- 3. listAgents availability ---
const listed = listAgents({ CODEX_BIN: fakeBin, PATH: "" });
const codexEntry = listed.find((a) => a.id === "codex");
assert(
  codexEntry && codexEntry.available === true && codexEntry.binary === fakeBin,
  "listAgents reports installed agent as available"
);
const aiderEntry = listed.find((a) => a.id === "aider");
assert(
  aiderEntry && aiderEntry.available === false && aiderEntry.install,
  "listAgents reports missing agent as unavailable with install hint"
);

fs.rmSync(tmpDir, { recursive: true, force: true });

// --- 4. package.json contributes the commands ---
const pkg = JSON.parse(
  fs.readFileSync(path.join(UI, "package.json"), "utf8")
);
const cmdIds = new Set((pkg.contributes?.commands || []).map((c) => c.command));
for (const cmd of [
  "grokCode.openAgent",
  "grokCode.openCodexTerminal",
  "grokCode.openGeminiTerminal",
  "grokCode.openOpenCodeTerminal",
  "grokCode.openAiderTerminal",
]) {
  assert(cmdIds.has(cmd), `package.json contributes ${cmd}`);
}

// --- 5. extension.js wiring ---
const ext = fs.readFileSync(path.join(UI, "extension.js"), "utf8");
assert(
  /require\(["']\.\/agents["']\)/.test(ext),
  "extension.js requires the agents module"
);
assert(
  ext.includes("grokCode.openAgent") && ext.includes("openAgentPicker"),
  "extension.js registers the agent picker"
);
assert(
  ext.includes("openAgentTerminal"),
  "extension.js defines the generic agent launcher"
);

// --- 6. sidebar renders the agent list ---
const sidebar = fs.readFileSync(
  path.join(UI, "welcome", "sidebar.html"),
  "utf8"
);
assert(
  sidebar.includes("agentList") && sidebar.includes("renderAgents"),
  "sidebar.html renders the AI Agents list"
);

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nAll Grok Code agent checks passed.");
