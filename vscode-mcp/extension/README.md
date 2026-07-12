# Grok Code bridge (extension)

Companion extension for the **Grok Code** MCP server. Starts a localhost HTTP bridge so Grok can control this editor window.

Wire protocol is unchanged (port `7331`, `VSCODE_MCP_*` env, tool names) so existing layouts keep working.

**Version:** 0.1.4

## Install

```bash
code --install-extension vscode-mcp-bridge-0.1.4.vsix
# or via the Grok Code launcher (installs latest VSIX automatically)
```

## Commands

- **Grok Code: Start Bridge**
- **Grok Code: Stop Bridge**
- **Grok Code: Copy Bridge Token**
- **Grok Code: Bridge Status**

On start, writes `.vscode-mcp.env` into:

- the workspace root (if a folder is open)
- `~/.grok-code-app/.vscode-mcp.env` (always)
- `~/.vscode-mcp.env` (always)

Optional: set `vscodeMcpBridge.autoRegisterMcp` to also register the MCP server in `~/.grok/config.toml`.

Status bar shows **Grok Code** when the bridge is live.

## Highlights (0.1.4)

- Content search (`/search-text`) and shell exec with capture (`/shell/exec`)
- Terminal output buffers + trash-aware deletes
- Command denylist, request body size limits, authenticated frame ingest
- No hardcoded Claude MCP paths
