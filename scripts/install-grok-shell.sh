#!/usr/bin/env bash
# Install the system `grok` entrypoint so bare `grok` opens Grok Code + Grok Build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WRAPPER_SRC="$ROOT/scripts/grok-wrapper.sh"
INSTALL_DIR="${GROK_WRAPPER_DIR:-$HOME/.local/bin}"
INSTALL_PATH="$INSTALL_DIR/grok"
BASHRC="${HOME}/.bashrc"
MARKER_BEGIN="# >>> grok-code launcher >>>"
MARKER_END="# <<< grok-code launcher <<<"

if [[ ! -f "$WRAPPER_SRC" ]]; then
  echo "Missing wrapper: $WRAPPER_SRC" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
# Copy wrapper and bake absolute repo root so bare `grok` works without env.
cp "$WRAPPER_SRC" "$INSTALL_PATH"
python3 - "$INSTALL_PATH" "$ROOT" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
root = sys.argv[2]
text = path.read_text()
pin = (
    f'ROOT="${{GROK_CODE_ROOT:-{root}}}"\n'
    'if [[ ! -f "$ROOT/scripts/launch-grok-code.sh" ]]; then\n'
    '  ROOT="$(resolve_root || true)"\n'
    'fi'
)
old = 'ROOT="$(resolve_root || true)"'
if old not in text:
    raise SystemExit(f"pin target not found in {path}")
path.write_text(text.replace(old, pin, 1))
print(f"Pinned GROK_CODE_ROOT default → {root}")
PY
chmod +x "$INSTALL_PATH"

if [[ ! -x "$HOME/.grok/bin/grok" ]]; then
  echo "Warning: $HOME/.grok/bin/grok not found. Install Grok Build first." >&2
fi

# Point config MCP at this clone
MCP_ENTRY="$ROOT/vscode-mcp/mcp-server/dist/index.js"
if [[ -f "$MCP_ENTRY" && -f "$HOME/.grok/config.toml" ]]; then
  python3 - "$MCP_ENTRY" <<'PY'
import pathlib, re, sys
entry = sys.argv[1]
cfg = pathlib.Path.home() / ".grok" / "config.toml"
text = cfg.read_text()
parts = re.split(r'(?=^\[)', text, flags=re.M)
out = []
for p in parts:
    if p.startswith("[mcp_servers.grok-code]"):
        p = re.sub(
            r'args\s*=\s*\[[^\]]*\]',
            "args = [" + repr(entry) + "]",
            p,
            count=1,
        )
    out.append(p)
cfg.write_text("".join(out))
print(f"Updated ~/.grok/config.toml grok-code MCP → {entry}")
PY
fi

BLOCK=$(cat <<EOF
$MARKER_BEGIN
export GROK_CODE_ROOT=$(printf '%q' "$ROOT")
export GROK_REAL_BIN="\$HOME/.grok/bin/grok"
# Prefer ~/.local/bin so \`grok\` launches Grok Code (wrapper) over ~/.grok/bin
export PATH="$INSTALL_DIR:\$HOME/.grok/bin:\$PATH"
$MARKER_END
EOF
)

if [[ -f "$BASHRC" ]]; then
  python3 -c "
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
block = sys.argv[2]
text = path.read_text() if path.exists() else ''
text = re.sub(r'# >>> grok-code launcher >>>.*?# <<< grok-code launcher <<<\n?', '', text, flags=re.S)
if not text.endswith('\n'):
    text += '\n'
path.write_text(text + block + ('\n' if not block.endswith('\n') else ''))
print('Updated', path)
" "$BASHRC" "$BLOCK"
fi

APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APP_DIR"
ICON="$ROOT/vscode-mcp/grok-code-ui/media/icon-256.png"
cat >"$APP_DIR/grok-code.desktop" <<EOF
[Desktop Entry]
Name=Grok Code
Comment=Grok Code with embedded Grok Build agent
Exec=env GROK_CODE_OPEN_AGENT=1 $(printf '%q' "$ROOT/scripts/launch-grok-code.sh") %F
Icon=$(printf '%q' "$ICON")
Terminal=false
Type=Application
Categories=Development;IDE;
StartupWMClass=code
EOF

echo ""
echo "Installed:"
echo "  wrapper : $INSTALL_PATH"
echo "  real bin: $HOME/.grok/bin/grok"
echo "  repo    : $ROOT"
echo ""
echo "Usage:"
echo "  grok                 → Grok Code + embedded Grok Build (agent in-app)"
echo "  grok \"fix the bug\"   → same, with initial prompt"
echo "  grok --standalone    → classic Grok Build TUI only"
echo "  grok mcp / login / … → real CLI subcommands"
echo ""
echo "Reload shell:  source ~/.bashrc"
echo "Or open a new terminal, then type:  grok"
