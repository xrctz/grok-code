# VS Code Open Source + Custom MCP

Yes — **VS Code is open source**. Microsoft develops it in the public [microsoft/vscode](https://github.com/microsoft/vscode) repo under the MIT license as **Code - OSS**. The branded “Visual Studio Code” builds on the Microsoft website add proprietary bits (Marketplace, telemetry branding, some extensions).

This workspace is a playground that:

1. **Downloads the real source** → `vscode-src/`
2. **Edits product branding** → **Grok Code** in `product.json`
3. **Skins the full workbench** → `vscode-mcp/grok-code-ui/` (theme + layout)
4. **Ships a custom MCP** → `vscode-mcp/` so AI agents (Grok) can drive the editor live

## Layout

```
.
├── README.md / package.json  ← you are here · npm run build|test|launch
├── launch.sh                 ← thin launcher
├── scripts/                  ← ensure binary, launch, branding, smoke tests
├── vscode-src/               ← Code - OSS (~1.129) + product.json rebrand
└── vscode-mcp/               ← bridge · MCP server · UI pack
    ├── extension/            ← HTTP bridge :7331 (v0.1.4)
    ├── grok-code-ui/         ← themes + Home Stage + Bridge panel (v0.3.1)
    ├── mcp-server/           ← MCP tools for Grok (v0.1.2)
    └── scripts/mock-bridge.mjs
```

## What we built (the fun part)

### Grok Code product shell
Custom identity, not stock VS Code:

- **Grok Code Dark / Void** themes + top activity bar layout
- **Home Stage** webview with AI-generated art + looping video
- Patched product name, icons, letterpress, workbench CSS
- Launcher: `./scripts/launch-grok-code.sh`

### MCP Bridge
Open files, read selections, apply edits, run commands, surface diagnostics — all from Grok through the Model Context Protocol.

See **[vscode-mcp/README.md](./vscode-mcp/README.md)** and **[vscode-src/GROK_CODE_NOTES.md](./vscode-src/GROK_CODE_NOTES.md)**.

Contributing? See **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

### No Copilot (Grok-only)

GitHub Copilot is **not** part of this product:

- `vscode-src/product.json` — no Copilot trust / auto-update enablement
- `scripts/launch-grok-code.sh` — hard `--disable-extension` for Copilot IDs + seeds profile
- `scripts/default-user-settings.json` — Copilot completions / chat agents off
- AI control path is **vscode-mcp** (bridge + MCP tools), not Copilot

```bash
# First-time setup (install deps in vscode-mcp subpackages)
npm run install:all

# Build bridge + MCP server, run smoke tests
npm test

# First-time (or after cache wipe): download VS Code + apply Grok branding
npm run ensure-binary

# Launch Grok Code (auto-bootstraps binary; installs latest VSIX)
npm run launch -- "/path/to/folder"
# or: ./launch.sh "/path/to/folder"
```

The launcher:

1. Uses `CODE_BIN` if set
2. Looks for a managed install in `~/.local/share/grok-code/app`
3. Falls back to system `code` / `code-oss` / `codium`
4. Downloads the official Linux VS Code tarball and brands it if nothing is found
5. Installs the **latest** `vscode-mcp-bridge-*.vsix` and `grok-code-ui-*.vsix`

Override paths with `GROK_CODE_APP`, `GROK_CODE_CACHE`, or `CODE_BIN`. Re-download with `./scripts/ensure-vscode-binary.sh --force`.

Agent control is via **MCP tools** (see `vscode-mcp/README.md`) — in-editor “Grok Chat” is a **Bridge status panel**; talk to Grok in the TUI and use `vscode_*` tools.

### Smoke test without VS Code UI

```bash
# terminal 1 — fake editor bridge
cd "vscode-mcp"
VSCODE_MCP_TOKEN=dev-token-123 node scripts/mock-bridge.mjs

# terminal 2 — exercise the MCP client layer
export VSCODE_MCP_TOKEN=dev-token-123
node -e "
import('./mcp-server/dist/client.js').then(async ({ BridgeClient, loadBridgeConfig }) => {
  const c = new BridgeClient(loadBridgeConfig());
  console.log(await c.health());
  console.log(await c.get('/status'));
  console.log(await c.post('/show-message', { message: 'Hello from Grok MCP!', type: 'info' }));
});
"
```

## Building full Grok Code from source

Compiling Code - OSS end-to-end needs Electron download + full compile (tens of minutes, multi-GB). When you want that:

```bash
cd vscode-src
npm install          # long
npm run compile      # long
./scripts/code.sh    # launch Grok Code
```

Follow Microsoft’s guide: https://github.com/microsoft/vscode/wiki/How-to-Contribute

The MCP extension works with **any** VS Code binary — you do not need a from-source build to use the bridge.

## License

- `vscode-src`: MIT (Microsoft / contributors)
- `vscode-mcp`: MIT
