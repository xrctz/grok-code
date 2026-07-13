# Grok Code ↔ MCP Bridge

Control a live **Grok Code** window from **Grok** (or any MCP client) using a custom two-piece integration. Same layout & wire protocol as before — rebranded.

```
┌─────────────┐   stdio MCP    ┌──────────────────┐   HTTP :7331   ┌─────────────────────┐
│  Grok / AI  │ ─────────────► │  grok-code       │ ─────────────► │  Grok Code bridge   │
│  (client)   │                │  MCP server      │                │  (editor APIs)      │
└─────────────┘                └──────────────────┘                └─────────────────────┘
```

Also in this workspace:

| Path | What it is |
|------|------------|
| `../vscode-src/` | Official **Code - OSS** source (Microsoft/vscode), lightly rebranded to **Grok Code** |
| `extension/` | VS Code extension that hosts the localhost bridge |
| `mcp-server/` | MCP server Grok talks to |

## Grok Code UI pack

See `grok-code-ui/` for the full product shell (themes, Home Stage with AI video, branding).

## Why two pieces?

MCP servers usually run as separate processes. VS Code’s rich APIs (`vscode.window`, workspace edits, diagnostics…) only exist **inside** an extension host. So:

1. The **extension** binds a tiny HTTP API to `127.0.0.1` and talks to the editor.
2. The **MCP server** is a thin client that turns those endpoints into MCP tools.

## Quick start

### 1. Build the extension

```bash
cd vscode-mcp/extension
npm install
npm run compile
```

### 2. Install the extension into VS Code

**Option A — Extension Development Host (easiest while hacking):**

1. Open the `vscode-mcp/extension` folder in VS Code.
2. Press `F5` (Run Extension).
3. A new window opens with the bridge active.

**Option B — Install into your daily VS Code:**

```bash
cd vscode-mcp/extension
npx @vscode/vsce package --no-dependencies --allow-missing-repository
code --install-extension vscode-mcp-bridge-0.1.5.vsix
```

### 3. Build the MCP server

```bash
cd vscode-mcp/mcp-server
npm install
npm run build
```

### 4. Point Grok at it

From the repo root, print a ready-to-paste config with absolute paths:

```bash
npm run print-mcp-config
```

Or add to `~/.grok/config.toml` manually (replace `<REPO_ROOT>` with your clone path):

```toml
[mcp_servers.grok-code]
command = "node"
args = ["<REPO_ROOT>/vscode-mcp/mcp-server/dist/index.js"]
enabled = true
startup_timeout_sec = 15
tool_timeout_sec = 120

[mcp_servers.grok-code.env]
VSCODE_MCP_HOST = "127.0.0.1"
VSCODE_MCP_PORT = "7331"
# Token is optional here — the extension also writes .vscode-mcp.env in the workspace
# VSCODE_MCP_TOKEN = "paste-from-command-palette"
```

Or via Grok CLI (use the path from `npm run print-mcp-config`):

```bash
grok mcp add grok-code -- node "<REPO_ROOT>/vscode-mcp/mcp-server/dist/index.js"
```

Set `GROK_CODE_ROOT` to your clone so the bridge extension can auto-discover the MCP server:

```bash
export GROK_CODE_ROOT="<REPO_ROOT>"
```

Restart Grok (or reload MCP). Open Grok Code with the bridge running, then ask Grok to use `vscode_ping` (tool names unchanged).

## MCP tools

| Tool | Purpose |
|------|---------|
| `vscode_ping` | Connectivity + health |
| `vscode_status` | App / workspace / active file |
| `vscode_workspace` | Open folders |
| `vscode_list_editors` | Visible editors & tabs |
| `vscode_tabs` | All tabs including browser/webviews |
| `vscode_get_selection` | Current selection text |
| `vscode_get_document` | Full file contents |
| `vscode_read_lines` | Read a 1-based line range (cheap paging of large files) |
| `vscode_get_diagnostics` | Errors & warnings |
| `vscode_search_files` | Workspace filename/glob search |
| `vscode_search_text` | **Content** search (path/line/preview) |
| `vscode_open_file` | Open + jump to line |
| `vscode_insert_text` | Type at cursor |
| `vscode_replace_selection` | Replace selection |
| `vscode_edit` | Multi-range workspace edits |
| `vscode_save` | Save file / all |
| `vscode_create_file` / `vscode_delete_file` / `vscode_rename_file` | Workspace file ops |
| `vscode_run_command` | Run a command id (denylist for quit/reload/etc.) |
| `vscode_show_message` | Status bar / optional toast |
| `vscode_reveal_line` | Scroll cursor into view |
| `vscode_browser` / `vscode_browser_open` / `vscode_browser_screenshot` | Built-in browser; screenshots accept `maxAgeMs` (`2500` default, `0` forces fresh) |
| `vscode_notifications_clear` | Clear toasts (unpause browser) |
| `vscode_terminal_*` | create / send-text / list / close / **output** |
| `vscode_shell_exec` | Run shell with **stdout/stderr/exitCode** (agent loops) |

Bridge extension **0.1.5** · MCP server **0.1.3** · UI pack **0.6.0** (embedded Grok Build + optional Claude Code terminal button + Home Stage mascot).

## Auth

- Bridge listens on **localhost only**.
- Every non-health request needs `Authorization: Bearer <token>` or `X-MCP-Token` (including browser frame ingest).
- On start, the extension writes `.vscode-mcp.env` in the workspace root **and** `~/.grok-code-app/.vscode-mcp.env` (works with no folder open).
- Command palette: **Grok Code: Copy Bridge Token**.
- Do not commit `.vscode-mcp.env`.
- Set `VSCODE_MCP_TIMEOUT_MS` (default `60000`) to cap how long the MCP client waits on a single bridge request before aborting — prevents a hung editor from blocking the agent.

## Settings (Grok Code)

| Setting | Default | Meaning |
|---------|---------|---------|
| `vscodeMcpBridge.port` | `7331` | HTTP port (key name kept for compatibility) |
| `vscodeMcpBridge.host` | `127.0.0.1` | Bind address |
| `vscodeMcpBridge.autoStart` | `true` | Start on launch |
| `vscodeMcpBridge.token` | `""` | Fixed token (empty = random per workspace) |
| `vscodeMcpBridge.autoRegisterMcp` | `false` | Write MCP entries into `~/.grok/config.toml` / Claude config |
| `vscodeMcpBridge.mcpServerPath` | `""` | Path to `mcp-server/dist/index.js` for auto-register |

## Fun source edit: Grok Code

`vscode-src/product.json` was rebranded from **Code - OSS** → **Grok Code** (`applicationName: grok-code`). Building the full desktop app from source is heavy (Node deps + Electron + compile); see Microsoft’s [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute). The MCP bridge works with **any** VS Code / Insiders / Code OSS binary once the extension is installed.

## Security notes

- Do **not** bind the bridge to `0.0.0.0` on untrusted networks.
- Treat the token like a local password; don’t commit `.vscode-mcp.env`.
- `vscode_run_command` and `vscode_shell_exec` are powerful — only enable this MCP for trusted sessions.
- Request bodies are capped (8MB). Dangerous command ids are denylisted. `shell/exec` applies a light safety filter.
- Bridge tokens are **not** injected into webviews; use the Copy Token command.

## License

- VS Code source (`vscode-src`): MIT (Microsoft).
- This MCP + extension: MIT — build whatever you want on top.
