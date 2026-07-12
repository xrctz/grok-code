#!/usr/bin/env bash
# End-to-end smoke test against mock bridge (no real VS Code required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export VSCODE_MCP_TOKEN="${VSCODE_MCP_TOKEN:-dev-token-123}"
export VSCODE_MCP_HOST="${VSCODE_MCP_HOST:-127.0.0.1}"
export VSCODE_MCP_PORT="${VSCODE_MCP_PORT:-7331}"

# Start mock if nothing is listening
if ! curl -sf "http://${VSCODE_MCP_HOST}:${VSCODE_MCP_PORT}/health" >/dev/null 2>&1; then
  echo "Starting mock bridge..."
  node "$ROOT/scripts/mock-bridge.mjs" &
  MOCK_PID=$!
  trap 'kill $MOCK_PID 2>/dev/null || true' EXIT
  for i in $(seq 1 20); do
    curl -sf "http://${VSCODE_MCP_HOST}:${VSCODE_MCP_PORT}/health" >/dev/null 2>&1 && break
    sleep 0.1
  done
fi

cd "$ROOT/mcp-server"
node --input-type=module <<'EOF'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const transport = new StdioClientTransport({
  command: "node",
  args: [path.resolve("dist/index.js")],
  env: process.env
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`✓ listed ${tools.length} tools`);
const ping = await client.callTool({ name: "vscode_ping", arguments: {} });
const text = ping.content?.[0]?.text || "";
if (!text.includes('"connected": true')) throw new Error("ping failed: " + text);
console.log("✓ vscode_ping connected");
await client.callTool({
  name: "vscode_show_message",
  arguments: { message: "smoke-test ok", type: "info" }
});
console.log("✓ vscode_show_message");
await client.close();
console.log("All smoke checks passed.");
EOF
