#!/usr/bin/env node
/**
 * Durable structural + MCP smoke tests for Grok Code (no Copilot product surface).
 * Drives real shipped artifacts: product.json, launch-grok-code.mjs,
 * default-user-settings.json, and BridgeClient against mock-bridge.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const failures = [];

function assert(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.error("FAIL:", msg);
  } else {
    console.log("OK  :", msg);
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// --- 1. product.json: no Copilot enablement / trust / auto-update ---
const productPath = path.join(ROOT, "vscode-src", "product.json");
const product = readJson(productPath);
assert(product.nameShort === "Grok Code", "product.nameShort is Grok Code");
assert(product.nameLong === "Grok Code", "product.nameLong is Grok Code");
assert(product.applicationName === "grok-code", "product.applicationName is grok-code");

const trust = product.trustedExtensionAuthAccess ?? {};
const trustStr = JSON.stringify(trust);
assert(
  !/GitHub\.copilot/i.test(trustStr),
  "product.trustedExtensionAuthAccess has no GitHub.copilot*"
);

const autoUp = product.builtInExtensionsEnabledWithAutoUpdates ?? [];
assert(
  Array.isArray(autoUp) && !autoUp.some((id) => /copilot/i.test(String(id))),
  "product.builtInExtensionsEnabledWithAutoUpdates has no copilot IDs"
);

// --- 2. launcher hard-disables Copilot extensions ---
const launcherPath = path.join(ROOT, "scripts", "launch-grok-code.mjs");
const launcher = fs.readFileSync(launcherPath, "utf8");
for (const id of [
  "GitHub.copilot",
  "GitHub.copilot-chat",
  "GitHub.copilot-chat-cf",
]) {
  assert(
    launcher.includes(id),
    `launcher disables ${id}`
  );
}
assert(
  launcher.includes("default-user-settings.json"),
  "launcher seeds default-user-settings.json"
);
assert(
  launcher.includes("electronLaunchFlags") || launcher.includes("--no-sandbox"),
  "launcher uses platform-aware Electron flags"
);
assert(fs.existsSync(launcherPath), "launch-grok-code.mjs exists");
const shimPath = path.join(ROOT, "scripts", "launch-grok-code.sh");
assert(
  fs.existsSync(shimPath) && (fs.statSync(shimPath).mode & 0o111),
  "launch-grok-code.sh thin wrapper is executable"
);

// --- 3. default settings keep Copilot / agent chat off ---
const defaultsPath = path.join(ROOT, "scripts", "default-user-settings.json");
const defaults = readJson(defaultsPath);
assert(defaults["chat.agent.enabled"] === false, "defaults: chat.agent.enabled false");
assert(
  defaults["chat.commandCenter.enabled"] === false,
  "defaults: chat.commandCenter.enabled false"
);
assert(
  defaults["github.copilot.enable"]?.["*"] === false,
  "defaults: github.copilot.enable * false"
);
assert(
  defaults["github.copilot.editor.enableAutoCompletions"] === false,
  "defaults: copilot autoCompletions false"
);
assert(
  defaults["github.copilot.nextEditSuggestions.enabled"] === false,
  "defaults: nextEditSuggestions false"
);

// --- 4. package.json compile path does not require compile-copilot ---
const pkg = readJson(path.join(ROOT, "vscode-src", "package.json"));
assert(
  !String(pkg.scripts.compile).includes("compile-copilot"),
  "npm run compile does not require compile-copilot"
);
assert(
  !String(pkg.scripts.watch).includes("watch-copilot"),
  "npm run watch does not require watch-copilot"
);

// --- 5. BridgeClient health/status against mock bridge (twice) ---
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function runBridgeSmoke() {
  const port = await freePort();
  const token = "test-token-grok-code";
  const mockPath = path.join(ROOT, "vscode-mcp", "scripts", "mock-bridge.mjs");
  const clientPath = path.join(ROOT, "vscode-mcp", "mcp-server", "dist", "client.js");
  assert(fs.existsSync(mockPath), "mock-bridge.mjs exists");
  assert(fs.existsSync(clientPath), "mcp-server dist/client.js exists");

  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    VSCODE_MCP_HOST: "127.0.0.1",
    VSCODE_MCP_PORT: String(port),
    VSCODE_MCP_TOKEN: token,
    VSCODE_MCP_URL: baseUrl,
  };

  const mock = spawn(process.execPath, [mockPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const waitReady = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mock bridge timeout")), 8000);
    mock.on("error", reject);
    mock.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(t);
        reject(new Error(`mock exited early: ${code}`));
      }
    });
    const start = Date.now();
    (async function poll() {
      while (Date.now() - start < 7000) {
        try {
          const r = await fetch(`${baseUrl}/health`);
          if (r.ok) {
            clearTimeout(t);
            resolve();
            return;
          }
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      clearTimeout(t);
      reject(new Error("mock health never became ready"));
    })();
  });

  try {
    await waitReady;
    // Import shipped client; pass explicit config so .vscode-mcp.env cannot redirect us.
    const { BridgeClient } = await import(pathToFileURL(clientPath).href);
    const bridgeConfig = {
      host: "127.0.0.1",
      port,
      token,
      baseUrl,
    };

    for (let run = 1; run <= 2; run++) {
      const client = new BridgeClient(bridgeConfig);
      const health = await client.health();
      assert(
        health &&
          health.ok === true &&
          (health.service === "vscode-mcp-bridge" ||
            String(health.version || "").includes("mock") ||
            health.vscode === "mock"),
        `BridgeClient.health run ${run} OK from mock (got ${JSON.stringify(health)})`
      );
      const status = await client.get("/status");
      assert(
        status && typeof status === "object" && status.ok === true,
        `BridgeClient.get(/status) run ${run} ok body`
      );
      assert(
        status.vscode === "mock" || status.appName === "Mock VS Code",
        `BridgeClient status run ${run} is mock bridge (not live editor)`
      );
      console.log(`    run ${run} health:`, JSON.stringify(health));
      console.log(`    run ${run} status keys:`, Object.keys(status).join(","));
    }
  } finally {
    mock.kill("SIGTERM");
  }
}

try {
  await runBridgeSmoke();
} catch (e) {
  failures.push(`MCP bridge smoke: ${e.message || e}`);
  console.error("FAIL: MCP bridge smoke:", e);
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nAll Grok Code no-Copilot checks passed.");
