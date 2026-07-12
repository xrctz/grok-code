#!/usr/bin/env node
/**
 * Test new workspace file and terminal tools in BridgeClient against mock-bridge.
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

async function runNewToolsSmoke() {
  const port = await freePort();
  const token = "test-token-new-tools";
  const mockPath = path.join(ROOT, "vscode-mcp", "scripts", "mock-bridge.mjs");
  const clientPath = path.join(ROOT, "vscode-mcp", "mcp-server", "dist", "client.js");

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
    const { BridgeClient } = await import(pathToFileURL(clientPath).href);
    const bridgeConfig = {
      host: "127.0.0.1",
      port,
      token,
      baseUrl,
    };
    const client = new BridgeClient(bridgeConfig);

    // 1. Test create-file
    const createRes = await client.post("/create-file", { path: "/tmp/new-file.txt", content: "hello new file" });
    assert(createRes && createRes.ok === true && createRes.path === "/tmp/new-file.txt", "POST /create-file works");

    // 1b. overwrite:false rejects existing
    let refused = false;
    try {
      await client.post("/create-file", { path: "/tmp/new-file.txt", content: "x", overwrite: false });
    } catch {
      refused = true;
    }
    assert(refused, "POST /create-file overwrite:false refuses existing");

    // 2. Test delete-file
    const deleteRes = await client.post("/delete-file", { path: "/tmp/new-file.txt" });
    assert(deleteRes && deleteRes.ok === true && deleteRes.path === "/tmp/new-file.txt", "POST /delete-file works");

    // 3. Test rename-file
    const renameRes = await client.post("/rename-file", { oldPath: "/tmp/a.txt", newPath: "/tmp/b.txt" });
    assert(renameRes && renameRes.ok === true && renameRes.oldPath === "/tmp/a.txt" && renameRes.newPath === "/tmp/b.txt", "POST /rename-file works");

    // 4. Test terminal/create
    const termCreateRes = await client.post("/terminal/create", { name: "test-term" });
    assert(termCreateRes && termCreateRes.ok === true && termCreateRes.name === "test-term", "POST /terminal/create works");

    // 5. Test terminal/send-text
    const termSendRes = await client.post("/terminal/send-text", { name: "test-term", text: "echo hello" });
    assert(termSendRes && termSendRes.ok === true && termSendRes.name === "test-term", "POST /terminal/send-text works");

    // 6. Test terminal/list
    const termListRes = await client.get("/terminal/list");
    assert(
      termListRes && termListRes.ok === true && termListRes.count >= 1 &&
        termListRes.terminals.some((t) => t.name === "test-term" || t.name === "bash"),
      "GET /terminal/list works"
    );

    // 7. Test terminal/output
    const termOut = await client.post("/terminal/output", { name: "test-term" });
    assert(termOut && termOut.ok === true && typeof termOut.output === "string", "POST /terminal/output works");

    // 8. Test terminal/close
    const termCloseRes = await client.post("/terminal/close", { name: "test-term" });
    assert(termCloseRes && termCloseRes.ok === true && termCloseRes.name === "test-term", "POST /terminal/close works");

    // 9. Content search
    const searchRes = await client.post("/search-text", { query: "greet" });
    assert(
      searchRes && searchRes.ok === true && searchRes.count >= 1 &&
        searchRes.matches.some((m) => /greet/.test(m.preview)),
      "POST /search-text finds content"
    );

    // 10. Shell exec with capture
    const shellRes = await client.post("/shell/exec", { command: "echo hi-from-test" });
    assert(
      shellRes && shellRes.ok === true && shellRes.exitCode === 0 &&
        String(shellRes.stdout || "").includes("mock-ok"),
      "POST /shell/exec returns stdout/exit"
    );

    // 11. Browser/tabs endpoints exist
    const tabs = await client.get("/tabs");
    assert(tabs && tabs.ok === true, "GET /tabs works");
    const browser = await client.get("/browser");
    assert(browser && browser.ok === true, "GET /browser works");

    // 12. Command denylist
    let blocked = false;
    try {
      await client.post("/command", { command: "workbench.action.quit" });
    } catch {
      blocked = true;
    }
    assert(blocked, "POST /command denylists quit");

  } finally {
    mock.kill("SIGTERM");
  }
}

try {
  await runNewToolsSmoke();
} catch (e) {
  failures.push(`New tools smoke test error: ${e.message || e}`);
  console.error("FAIL: New tools smoke test:", e);
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nAll new Grok Code tools checks passed successfully.");
