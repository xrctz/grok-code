# Grok Code UI

Full custom product shell for **Grok Code** (v0.5.1):

- **Grok Code Void** default theme + custom file icons
- **Home Stage** with left nav rail, AI video, particles, typing demo
- **Grok Command** sidebar — bridge status, **Open Grok Build**, **Open Claude Code**
- Embedded **Grok Build** terminal + optional **Claude Code** terminal (button only, no auto-boot)
- Upstream VS Code chrome hidden via layout + `grok-code.css`

## Themes

| Theme | Look |
|-------|------|
| **Grok Code Void** | Pure black void (default) |
| **Grok Code Dark** | Near-black surfaces, violet accent (`#8B5CF6`) |

## Icons

**Grok Code Icons** — violet/cyan minimal file & folder glyphs (replaces Seti).

## Commands

- **Grok Code: Open Home Stage** — cinematic home with nav rail + motion
- **Grok Code: Open Grok Build Terminal** — embedded Grok agent (may auto-open)
- **Grok Code: Open Claude Code Terminal** — your `launch-claude.sh` custom Claude (button only)
- **Grok Code: Apply Full Layout** — void theme + custom chrome defaults
- **Grok Code: About**

## Install

```bash
npm run package:ui
code --install-extension vscode-mcp/grok-code-ui/grok-code-ui-0.5.1.vsix
```
