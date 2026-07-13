# AGENTS.md

## Cursor Cloud specific instructions

**Product:** Grok Code — a rebranded VS Code / Code-OSS editor with an embedded MCP
bridge. An AI agent drives the editor through `vscode_*` MCP tools:
`agent → MCP server (stdio) → bridge extension (HTTP :7331) → editor`.
See `README.md` and `vscode-mcp/README.md` for the full overview and tool reference.

### Layout / what to touch
- `vscode-mcp/extension/` — bridge extension (HTTP API on `127.0.0.1:7331`).
- `vscode-mcp/mcp-server/` — MCP server (translates MCP tools → bridge HTTP).
- `vscode-mcp/grok-code-ui/` — UI pack (themes, Home Stage, agent terminals).
- `scripts/` — launcher, branding, binary bootstrap, structural tests.
- `vscode-src/` — vendored Code-OSS; avoid editing (heavy multi-GB from-source build, not needed).

### Standard commands (already documented in `package.json` / `README.md`)
- Install + build: `npm run install:all`
- Build only: `npm run build` (compiles the bridge + MCP server via `tsc`)
- Tests (build + structural + MCP smoke): `npm test`
- Package VSIX extensions: `npm run package`
- Launch the editor GUI: `npm run launch -- <folder>`

Lint/typecheck: there is no dedicated lint script. Type-checking is done by the
TypeScript compiler — `npm run build` (or `npm run typecheck --prefix vscode-mcp/mcp-server`).

### Non-obvious caveats
- **Committed artifacts:** `node_modules/`, compiled `out/`/`dist/`, and the built
  `*.vsix` files are all committed. A fresh checkout builds/tests/launches without a
  network install. `npm install` rewrites `package-lock.json` version fields to match
  `package.json` (harmless working-tree noise); don't commit that churn.
- **VS Code binary is not in the repo.** Before launching the GUI, run
  `npm run ensure-binary` once. It downloads (~276 MB) and Grok-brands a stable VS Code
  build into `~/.local/share/grok-code/app`. It is idempotent (skips if present) and is
  intentionally kept out of the startup update script because it is a large network
  download. Tests, build, and lint do NOT need it.
- **Headless GUI:** A display is available at `DISPLAY=:1`. Launch with
  `DISPLAY=:1 npm run launch -- <folder>`. Pass `--no-sandbox` is already handled by the
  launcher.
- **Grok CLI is optional.** The embedded "Grok Build" agent terminal expects
  `~/.grok/bin/grok`, which is not installed here. Set `GROK_CODE_OPEN_AGENT=0` when
  launching to skip the auto-opened agent terminal and avoid noise. You do NOT need the
  Grok/Claude CLIs to exercise the core MCP path.
- **Bridge auth token:** the bridge reads `vscodeMcpBridge.token` from the editor's user
  settings (`~/.grok-code-app/User/settings.json`); if empty it generates a random
  per-workspace token. To drive the live editor from an MCP client, set a known token
  (e.g. `dev-token-123`) in that settings file and pass the same value via
  `VSCODE_MCP_TOKEN` to the MCP server. Verify the live bridge with
  `curl -s http://127.0.0.1:7331/health`.
- **Headless MCP testing without the GUI:** `npm run test:mcp` runs the MCP server
  against `vscode-mcp/scripts/mock-bridge.mjs` (default token `dev-token-123`), so the
  full agent→server path can be validated with no editor window.
- **Copilot is intentionally disabled** throughout; do not try to re-enable it.
