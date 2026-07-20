#!/usr/bin/env node
/**
 * End-to-end MCP smoke test against mock bridge (no real VS Code required).
 * Cross-platform (Windows / macOS / Linux) — used by `npm run test:mcp`.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MCP_SERVER = path.join(ROOT, "mcp-server");

process.env.VSCODE_MCP_TOKEN = process.env.VSCODE_MCP_TOKEN || "dev-token-123";
process.env.VSCODE_MCP_HOST = process.env.VSCODE_MCP_HOST || "127.0.0.1";
process.env.VSCODE_MCP_PORT = process.env.VSCODE_MCP_PORT || "7331";

const host = process.env.VSCODE_MCP_HOST;
const port = process.env.VSCODE_MCP_PORT;

/** @type {import('node:child_process').ChildProcess | null} */
let mockProc = null;

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await healthCheck()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function cleanup() {
  if (mockProc && !mockProc.killed) {
    try {
      mockProc.kill();
    } catch {
      /* ignore */
    }
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

async function ensureMock() {
  if (await healthCheck()) return;
  console.log("Starting mock bridge...");
  mockProc = spawn(
    process.execPath,
    [path.join(ROOT, "scripts", "mock-bridge.mjs")],
    { stdio: "ignore", env: process.env }
  );
  if (!(await waitForHealth())) {
    throw new Error("Mock bridge failed to become healthy");
  }
}

async function main() {
  await ensureMock();

  const require = createRequire(path.join(MCP_SERVER, "package.json"));
  const { Client } = await import(
    pathToFileURL(
      require.resolve("@modelcontextprotocol/sdk/client/index.js")
    ).href
  );
  const { StdioClientTransport } = await import(
    pathToFileURL(
      require.resolve("@modelcontextprotocol/sdk/client/stdio.js")
    ).href
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(MCP_SERVER, "dist", "index.js")],
    env: { ...process.env },
  });
  const client = new Client({ name: "smoke", version: "0.0.1" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`✓ listed ${tools.length} tools`);
  const ping = await client.callTool({ name: "vscode_ping", arguments: {} });
  const text = ping.content?.[0]?.text || "";
  if (!text.includes('"connected": true')) {
    throw new Error("ping failed: " + text);
  }
  console.log("✓ vscode_ping connected");
  await client.callTool({
    name: "vscode_show_message",
    arguments: { message: "smoke-test ok", type: "info" },
  });
  console.log("✓ vscode_show_message");
  await client.close();
  console.log("All smoke checks passed.");
  cleanup();
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
