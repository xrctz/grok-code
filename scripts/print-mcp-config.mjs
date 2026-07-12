#!/usr/bin/env node
/**
 * Print Grok MCP config snippets with absolute paths for this repo clone.
 * Usage: npm run print-mcp-config
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(root, 'vscode-mcp', 'mcp-server', 'dist', 'index.js');

console.log(`Grok Code MCP server entry:\n  ${serverEntry}\n`);
console.log('Add to ~/.grok/config.toml:\n');
console.log(`[mcp_servers.grok-code]
command = "node"
args = [${JSON.stringify(serverEntry)}]
enabled = true
startup_timeout_sec = 15
tool_timeout_sec = 120

[mcp_servers.grok-code.env]
VSCODE_MCP_HOST = "127.0.0.1"
VSCODE_MCP_PORT = "7331"
# VSCODE_MCP_TOKEN = "paste-from-command-palette"
`);
console.log('Or via Grok CLI:\n');
console.log(
  `grok mcp add grok-code -- node ${JSON.stringify(serverEntry)}\n`
);
console.log(
  'Tip: set GROK_CODE_ROOT in your shell profile so the bridge extension can auto-discover the MCP server.'
);
console.log(`export GROK_CODE_ROOT=${JSON.stringify(root)}`);
