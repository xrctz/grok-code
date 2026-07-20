# Contributing to Grok Code

Thanks for helping improve **Grok Code** — the open-source VS Code shell with a Grok-first MCP bridge.

## What to work on

Most contributions should touch **first-party Grok code**, not the full `vscode-src/` tree:

| Area | Path | Good for |
|------|------|----------|
| MCP bridge extension | `vscode-mcp/extension/` | Editor APIs, HTTP routes, auth |
| MCP server | `vscode-mcp/mcp-server/` | Tool definitions, client wiring |
| UI pack | `vscode-mcp/grok-code-ui/` | Themes, Home Stage, layout |
| Launcher & branding | `scripts/` | Binary bootstrap, defaults, smoke tests |
| Product identity | `vscode-src/product.json` | Name, icons, Copilot stripping |

Avoid large edits under `vscode-src/src/` unless you are intentionally syncing with upstream Code - OSS.

## Development setup

Requires **Node.js 20+**. The same commands work on **Ubuntu**, **macOS**, and **Windows**.

```bash
git clone <your-fork-url>
cd grok-code

# Install subpackage deps + build TypeScript
npm run install:all

# Run structural + MCP smoke tests (no VS Code UI required)
npm test

# Print Grok MCP config with correct absolute paths
npm run print-mcp-config

# Package VSIX extensions
npm run package

# Launch Grok Code (downloads/brands the correct OS binary on first run)
npm run launch -- "/path/to/folder"
```

On Windows you can also use `.\launch.ps1`. On Ubuntu, `./launch.sh` and `npm run install:shell` set up the bare `grok` command and a desktop entry.
## Pull requests

1. Branch from `main` using a descriptive name.
2. Keep changes focused — one feature or fix per PR.
3. Run `npm test` before opening the PR.
4. Update docs when you change behavior, tool names, or setup steps.
5. Do not commit `.vscode-mcp.env` or bridge tokens.

## Reporting issues

Use the GitHub issue templates for bugs and feature requests. Include:

- OS and how you launched Grok Code (`npm run launch`, VSIX, from-source)
- Bridge extension version and whether the bridge status bar shows connected
- Steps to reproduce and expected vs actual behavior

## License

By contributing, you agree that your contributions are licensed under the MIT License (see `vscode-mcp/LICENSE`).
