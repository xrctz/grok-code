#!/usr/bin/env bash
# Launch Grok Code (VS Code binary / OSS shell) with Copilot hard-disabled.
# When GROK_CODE_OPEN_AGENT=1 (set by the bare `grok` wrapper), the UI extension
# embeds Grok Build in the integrated terminal so the agent can drive the app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_DATA="${GROK_CODE_USER_DATA:-$HOME/.grok-code-app}"
EXT_DIR="${GROK_CODE_EXT_DIR:-$USER_DATA/extensions}"
SETTINGS_DIR="$USER_DATA/User"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"
DEFAULT_SETTINGS="$ROOT/scripts/default-user-settings.json"
ENSURE="$ROOT/scripts/ensure-vscode-binary.sh"

# Make MCP auto-discovery + shell wrappers resolve this clone
export GROK_CODE_ROOT="${GROK_CODE_ROOT:-$ROOT}"
export GROK_REAL_BIN="${GROK_REAL_BIN:-$HOME/.grok/bin/grok}"

# Pick newest matching VSIX by version-ish sort of filename
latest_vsix() {
  local dir="$1"
  local pattern="$2"
  local found=""
  # shellcheck disable=SC2086
  found="$(ls -1 "$dir"/$pattern 2>/dev/null | sort -V | tail -n1 || true)"
  if [[ -n "$found" && -f "$found" ]]; then
    echo "$found"
  fi
}

# Resolve CODE_BIN: explicit env → ensure script (detect / download).
resolve_code_bin() {
  if [[ -n "${CODE_BIN:-}" && ( -x "$CODE_BIN" || -f "$CODE_BIN" ) ]]; then
    echo "$CODE_BIN"
    return 0
  fi
  if [[ -x "$ENSURE" || -f "$ENSURE" ]]; then
    bash "$ENSURE"
    return 0
  fi
  local legacy="/tmp/vscode-extract/usr/share/code/bin/code"
  if [[ -x "$legacy" || -f "$legacy" ]]; then
    echo "$legacy"
    return 0
  fi
  return 1
}

mkdir -p "$USER_DATA" "$EXT_DIR" "$SETTINGS_DIR"

# Seed / merge Grok defaults so Copilot stays off even on a fresh profile.
if [[ -f "$DEFAULT_SETTINGS" ]]; then
  if [[ ! -f "$SETTINGS_FILE" ]]; then
    cp "$DEFAULT_SETTINGS" "$SETTINGS_FILE"
  else
    # Merge defaults under existing user keys (user wins); force Copilot-off keys.
    DEFAULT_SETTINGS="$DEFAULT_SETTINGS" SETTINGS_FILE="$SETTINGS_FILE" python3 - <<'PY'
import json, os
from pathlib import Path
defaults = json.loads(Path(os.environ["DEFAULT_SETTINGS"]).read_text())
path = Path(os.environ["SETTINGS_FILE"])
try:
    current = json.loads(path.read_text())
except Exception:
    current = {}
if not isinstance(current, dict):
    current = {}
# Keys that must stay off for Grok Code (override user re-enable)
FORCE_OFF = {
    "chat.commandCenter.enabled": False,
    "chat.agent.enabled": False,
    "chat.agent.maxRequests": 0,
    "chat.detectParticipant.enabled": False,
    "chat.experimental.tools.enabled": False,
    "github.copilot.enable": {"*": False},
    "github.copilot.editor.enableAutoCompletions": False,
    "github.copilot.nextEditSuggestions.enabled": False,
    "github.copilot.chat.agent.autoFix": False,
    "github.copilot.chat.claudeAgent.enabled": False,
    "github.copilot.chat.backgroundAgent.enabled": False,
    "github.copilot.chat.cloudAgent.enabled": False,
    "github.copilot.chat.reviewAgent.enabled": False,
    "github.copilot.chat.exploreAgent.enabled": False,
    # Keep Grok Code Browser interactive (toasts pause it)
    "notifications.doNotDisturbMode": True,
    "simpleBrowser.focusLockIndicator.enabled": False,
    # Embed Grok Build so the agent can work in-app
    "grokCode.openGrokTerminalOnStartup": True,
    "grokCode.alwaysApproveAgent": True,
}
# Empty string token in defaults should not wipe a real token
if defaults.get("vscodeMcpBridge.token") == "":
    defaults.pop("vscodeMcpBridge.token", None)
merged = {**defaults, **current, **FORCE_OFF}
path.write_text(json.dumps(merged, indent=2) + "\n")
PY
  fi
fi

if ! CODE_BIN="$(resolve_code_bin)"; then
  echo "Grok Code binary not found." >&2
  echo "Run:  ./scripts/ensure-vscode-binary.sh" >&2
  echo "Or set CODE_BIN to a VS Code / Code - OSS binary." >&2
  exit 1
fi

if [[ ! -x "$CODE_BIN" && ! -f "$CODE_BIN" ]]; then
  echo "Grok Code binary not found at: $CODE_BIN" >&2
  echo "Run:  ./scripts/ensure-vscode-binary.sh" >&2
  echo "Or set CODE_BIN to a VS Code / Code - OSS binary." >&2
  exit 1
fi

echo "Using Grok Code binary: $CODE_BIN" >&2

BRIDGE_VSIX="$(latest_vsix "$ROOT/vscode-mcp/extension" "vscode-mcp-bridge-*.vsix")"
UI_VSIX="$(latest_vsix "$ROOT/vscode-mcp/grok-code-ui" "grok-code-ui-*.vsix")"

# Auto-install/update our packaged Grok Code extensions
if [[ -n "$BRIDGE_VSIX" ]]; then
  echo "Installing Grok Code Bridge extension ($(basename "$BRIDGE_VSIX"))..."
  "$CODE_BIN" --extensions-dir "$EXT_DIR" --install-extension "$BRIDGE_VSIX" >/dev/null
else
  echo "Warning: no vscode-mcp-bridge-*.vsix found under vscode-mcp/extension/" >&2
fi
if [[ -n "$UI_VSIX" ]]; then
  echo "Installing Grok Code UI extension ($(basename "$UI_VSIX"))..."
  "$CODE_BIN" --extensions-dir "$EXT_DIR" --install-extension "$UI_VSIX" >/dev/null
else
  echo "Warning: no grok-code-ui-*.vsix found under vscode-mcp/grok-code-ui/" >&2
fi

# Export for the Electron process (extension reads these). Avoid `env VAR=`
# with empty values — they can confuse arg parsing with paths that have spaces.
export GROK_CODE_ROOT
export GROK_REAL_BIN
export GROK_CODE_OPEN_AGENT="${GROK_CODE_OPEN_AGENT:-1}"
export GROK_CODE_CWD="${GROK_CODE_CWD:-$(pwd)}"
if [[ -n "${GROK_CODE_AGENT_PROMPT_FILE:-}" ]]; then
  export GROK_CODE_AGENT_PROMPT_FILE
else
  unset GROK_CODE_AGENT_PROMPT_FILE || true
fi

if [[ "$GROK_CODE_OPEN_AGENT" == "1" || "$GROK_CODE_OPEN_AGENT" == "true" ]]; then
  echo "Grok Build will open inside Grok Code (agent can drive the app via MCP)." >&2
fi

# Default workspace = current dir when no path args were given
ARGS=("$@")
if [[ ${#ARGS[@]} -eq 0 && -n "${GROK_CODE_CWD:-}" && -d "${GROK_CODE_CWD}" ]]; then
  ARGS=("$GROK_CODE_CWD")
fi

exec "$CODE_BIN" \
  --user-data-dir "$USER_DATA" \
  --extensions-dir "$EXT_DIR" \
  --disable-workspace-trust \
  --disable-extension GitHub.copilot \
  --disable-extension GitHub.copilot-chat \
  --disable-extension GitHub.copilot-chat-cf \
  --no-sandbox \
  --disable-gpu-sandbox \
  "${ARGS[@]}"
