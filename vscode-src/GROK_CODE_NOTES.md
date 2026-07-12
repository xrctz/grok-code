# Grok Code — full custom product shell

This is no longer a light rename of Code - OSS. The playground ships a **Grok Code** product surface:

## Layers

| Layer | What |
|-------|------|
| `product.json` (source + extracted binary) | App name **Grok Code**, `grok-code` ids, stripped marketing URLs |
| Binary chrome | Injected `grok-code.css` into workbench.html, custom letterpress SVGs, replaced `code.png` / pixmaps |
| `vscode-mcp/grok-code-ui/` | Full UI pack v0.4.0 — void theme, custom icons, Home Stage, **Grok Command** panel |
| `vscode-mcp/extension/` | MCP bridge (Grok drives the live editor) |
| `scripts/launch-grok-code.sh` | Launcher → `~/.grok-code-app` profile; auto-resolves binary |
| `scripts/ensure-vscode-binary.sh` | Downloads VS Code tarball → `~/.local/share/grok-code/app`, brands it |
| Desktop entry | `~/.local/share/applications/grok-code.desktop` |

## AI-generated brand media

Under `vscode-mcp/grok-code-ui/media/`:

- App icon set (32–512px) from generated mark
- Splash / hero stills
- `welcome/core-orbit.mp4` and `welcome/splash-editor.mp4` — cinematic loops
- Custom **GROK CODE** letterpress SVGs (exact text via code)

## Commands

- **Grok Code: Open Home Stage**
- **Grok Code: Apply Full Layout**
- **Grok Code: About**

## Launch

```bash
# One-time (or after cache wipe): download + brand VS Code
./scripts/ensure-vscode-binary.sh

./scripts/launch-grok-code.sh "/path/to/folder"
```

Managed binary: `~/.local/share/grok-code/app` (not `/tmp` — survives reboots).  
Profile data: `~/.grok-code-app` (not `.vscode`).
## Copilot removal (Grok-only product)

Grok Code intentionally does **not** enable GitHub Copilot:

| Surface | Action |
|---------|--------|
| `product.json` | `trustedExtensionAuthAccess` and `builtInExtensionsEnabledWithAutoUpdates` no longer list `GitHub.copilot*` |
| `scripts/launch-grok-code.sh` | Always passes `--disable-extension` for `GitHub.copilot`, `GitHub.copilot-chat`, `GitHub.copilot-chat-cf` |
| `scripts/default-user-settings.json` | Seeds profile with Copilot completions/agents and chat agent command-center **off** (launcher re-forces on each start) |
| `package.json` scripts | Default `compile` / `watch` do **not** build Copilot; use `compile-copilot:upstream` only if needed |
| Extracted binary | Built-in copilot extension folder renamed/disabled when present; product trust/auto-update stripped |

AI driving the editor is via **vscode-mcp** (bridge + MCP server), not Copilot.

Verify with: `node scripts/test-grok-code-no-copilot.mjs`

## Honest limits

We rebrand and reskin a VS Code-compatible binary (or source tree). Full compile-from-source of Electron OSS is still optional and heavy. Residual upstream chat plumbing / copilot strings may remain in-tree as inert code; the product surface does not trust, auto-update, or launch-enable Copilot.

## Upstream

Prefer small diffs on `product.json` + keep `GROK_CODE_NOTES.md` when rebasing `vscode-src`.
