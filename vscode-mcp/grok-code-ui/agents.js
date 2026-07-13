/**
 * Grok Code — AI agent registry.
 *
 * Pure module (no `vscode` dependency) so it can be unit-tested directly with
 * Node. It defines the terminal-launchable coding agents Grok Code supports and
 * the logic for detecting which of them are installed on the current machine.
 *
 * Grok Build is the primary/default agent. The others are popular third-party
 * CLI coding agents that Grok Code makes available automatically when present,
 * so users who prefer Codex / Gemini / OpenCode / Aider can use them too.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * @typedef {Object} AgentDef
 * @property {string} id            Stable identifier.
 * @property {string} label         Display name.
 * @property {string} bin           Executable name to look for on PATH.
 * @property {string[]} [binEnv]    Env vars that may override the binary path.
 * @property {string[]} [args]      Default launch arguments.
 * @property {string} accent        UI accent key (css class suffix).
 * @property {string} desc          Short description.
 * @property {string} [install]     Install hint shown when the binary is missing.
 * @property {string} [command]     Dedicated VS Code command id (built-ins only).
 * @property {boolean} [builtin]    True for Grok Build / Claude Code.
 * @property {string} [url]         Homepage / docs.
 */

/** @type {AgentDef[]} */
const AGENTS = [
  {
    id: "grok",
    label: "Grok Build",
    bin: "grok",
    binEnv: ["GROK_REAL_BIN", "GROK_BIN"],
    accent: "grok",
    desc: "xAI Grok — the default agent (can auto-open on startup).",
    command: "grokCode.openGrokTerminal",
    builtin: true,
    url: "https://x.ai",
  },
  {
    id: "claude",
    label: "Claude Code",
    bin: "claude",
    binEnv: ["CLAUDE_BIN"],
    accent: "claude",
    desc: "Anthropic Claude Code CLI (button launch, no auto-boot).",
    command: "grokCode.openClaudeTerminal",
    builtin: true,
    install: "npm install -g @anthropic-ai/claude-code",
    url: "https://www.anthropic.com",
  },
  {
    id: "codex",
    label: "Codex (ChatGPT)",
    bin: "codex",
    binEnv: ["CODEX_BIN"],
    args: [],
    accent: "codex",
    desc: "OpenAI Codex CLI — the ChatGPT coding agent.",
    command: "grokCode.openCodexTerminal",
    install: "npm install -g @openai/codex",
    url: "https://github.com/openai/codex",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    bin: "gemini",
    binEnv: ["GEMINI_BIN"],
    args: [],
    accent: "gemini",
    desc: "Google Gemini CLI coding agent.",
    command: "grokCode.openGeminiTerminal",
    install: "npm install -g @google/gemini-cli",
    url: "https://github.com/google-gemini/gemini-cli",
  },
  {
    id: "opencode",
    label: "OpenCode",
    bin: "opencode",
    binEnv: ["OPENCODE_BIN"],
    args: [],
    accent: "opencode",
    desc: "OpenCode — open-source terminal coding agent.",
    command: "grokCode.openOpenCodeTerminal",
    install: "npm install -g opencode-ai   (or: curl -fsSL https://opencode.ai/install | bash)",
    url: "https://opencode.ai",
  },
  {
    id: "aider",
    label: "Aider",
    bin: "aider",
    binEnv: ["AIDER_BIN"],
    args: [],
    accent: "aider",
    desc: "Aider — AI pair programming in your terminal.",
    command: "grokCode.openAiderTerminal",
    install: "pipx install aider-chat   (or: python -m pip install aider-chat)",
    url: "https://aider.chat",
  },
];

/** @param {AgentDef} agent */
function isExecutableFile(p) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Extra directories to probe in addition to PATH (common per-user install dirs
 * that GUI-launched apps frequently miss because they don't source a shell rc).
 * @param {NodeJS.ProcessEnv} [env]
 */
function extraBinDirs(env = process.env) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".deno", "bin"),
    path.join(home, ".grok", "bin"),
    "/usr/local/bin",
    "/usr/bin",
    "/opt/homebrew/bin",
  ];
}

/**
 * Resolve an agent's binary to an absolute path, or null if not found.
 * Honours the agent's override env vars first, then scans extra dirs + PATH.
 * @param {AgentDef} agent
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
function findAgentBinary(agent, env = process.env) {
  for (const key of agent.binEnv || []) {
    const val = env[key];
    if (val && isExecutableFile(val)) {
      return val;
    }
  }
  const pathDirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  const dirs = [...extraBinDirs(env), ...pathDirs];
  const names =
    process.platform === "win32"
      ? [agent.bin, `${agent.bin}.cmd`, `${agent.bin}.exe`]
      : [agent.bin];
  const seen = new Set();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * List every agent with its detected availability + resolved binary path.
 * @param {NodeJS.ProcessEnv} [env]
 */
function listAgents(env = process.env) {
  return AGENTS.map((agent) => {
    const binary = findAgentBinary(agent, env);
    return {
      id: agent.id,
      label: agent.label,
      accent: agent.accent,
      desc: agent.desc,
      install: agent.install || null,
      command: agent.command || null,
      builtin: !!agent.builtin,
      url: agent.url || null,
      available: !!binary,
      binary,
    };
  });
}

/** @param {string} id */
function getAgent(id) {
  return AGENTS.find((a) => a.id === id);
}

module.exports = {
  AGENTS,
  findAgentBinary,
  listAgents,
  getAgent,
  extraBinDirs,
};
