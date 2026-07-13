#!/usr/bin/env node
/**
 * Exercise browser frame freshness through the real bridge HTTP routes.
 * A small VS Code API stub keeps this integration test headless.
 */
import { createServer } from "node:net";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const failures = [];

function assert(condition, message) {
  if (condition) {
    console.log("OK  :", message);
  } else {
    failures.push(message);
    console.error("FAIL:", message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close(() => resolve(address.port));
    });
  });
}

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-screenshot-test-"));
  const fakeChrome = path.join(tempDir, "fake-chrome");
  fs.writeFileSync(
    fakeChrome,
    `#!/usr/bin/env node
const fs = require("node:fs");
const arg = process.argv.find((value) => value.startsWith("--screenshot="));
if (!arg) process.exit(2);
fs.writeFileSync(arg.slice("--screenshot=".length), Buffer.alloc(96, 7));
`
  );
  fs.chmodSync(fakeChrome, 0o755);

  const vscodeStub = {
    version: "test",
    workspace: {
      name: "screenshot-test",
      workspaceFolders: [
        { name: "fixture", index: 0, uri: { fsPath: tempDir } },
      ],
    },
    window: {
      activeTextEditor: undefined,
      visibleTextEditors: [],
      tabGroups: { all: [] },
    },
  };

  const require = createRequire(import.meta.url);
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") return vscodeStub;
    return originalLoad.call(this, request, parent, isMain);
  };

  let BridgeServer;
  try {
    ({ BridgeServer } = require(
      path.join(ROOT, "vscode-mcp", "extension", "out", "bridge.js")
    ));
  } finally {
    Module._load = originalLoad;
  }

  const token = "screenshot-test-token";
  const port = await freePort();
  const bridge = new BridgeServer({ host: "127.0.0.1", port, token });
  const baseUrl = `http://127.0.0.1:${port}`;
  const previousChromePath = process.env.CHROME_PATH;
  process.env.CHROME_PATH = fakeChrome;

  async function request(route, method = "GET", body) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`${method} ${route} failed: ${JSON.stringify(payload)}`);
    }
    return payload;
  }

  async function postFrame(source) {
    return request("/browser/frame", "POST", {
      image: Buffer.alloc(64, 1).toString("base64"),
      source,
    });
  }

  try {
    await bridge.start();

    await postFrame("long-lived-frame");
    await delay(2700);
    const longLived = await request("/browser/screenshot", "POST", {
      maxAgeMs: 10_000,
      url: "http://example.test/",
    });
    assert(
      longLived.source === "long-lived-frame" &&
        longLived.maxAgeMs === 10_000,
      "POST maxAgeMs can retain a frame older than the default window"
    );

    await postFrame("post-zero-frame");
    await delay(20);
    const postZero = await request("/browser/screenshot", "POST", {
      maxAgeMs: 0,
      url: "http://example.test/",
    });
    assert(
      postZero.source === "chrome-headless" && postZero.maxAgeMs === 0,
      "POST maxAgeMs=0 requires a fresh capture"
    );

    await postFrame("query-zero-frame");
    await delay(20);
    const queryZero = await request(
      "/browser/screenshot?maxAgeMs=0&url=http%3A%2F%2Fexample.test%2F"
    );
    assert(
      queryZero.source === "chrome-headless" && queryZero.maxAgeMs === 0,
      "GET maxAgeMs=0 requires a fresh capture"
    );

    await postFrame("default-window-frame");
    await delay(20);
    const defaultWindow = await request("/browser/screenshot", "POST", {});
    assert(
      defaultWindow.source === "default-window-frame" &&
        defaultWindow.maxAgeMs === 2500,
      "omitting maxAgeMs preserves the default cache window"
    );

    await postFrame("invalid-window-frame");
    await delay(20);
    const invalidWindow = await request(
      "/browser/screenshot?maxAgeMs=not-a-number"
    );
    assert(
      invalidWindow.source === "invalid-window-frame" &&
        invalidWindow.maxAgeMs === 2500,
      "invalid maxAgeMs safely uses the default cache window"
    );
  } finally {
    bridge.stop();
    if (previousChromePath === undefined) {
      delete process.env.CHROME_PATH;
    } else {
      process.env.CHROME_PATH = previousChromePath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.error("FAIL: browser screenshot integration test:", error);
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}

console.log("\nAll browser screenshot freshness checks passed.");
