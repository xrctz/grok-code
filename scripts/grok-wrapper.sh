#!/usr/bin/env bash
# GROK_CODE_LAUNCHER_WRAPPER
# Bare `grok` → open Grok Code with embedded Grok Build (agent drives the app).
# Subcommands, --standalone, and already-embedded sessions use the real binary.
set -euo pipefail

REAL_GROK="${GROK_REAL_BIN:-$HOME/.grok/bin/grok}"
if [[ ! -x "$REAL_GROK" && ! -f "$REAL_GROK" ]]; then
  # Fallback if real binary moved
  for c in /usr/local/bin/grok /usr/bin/grok; do
    if [[ -x "$c" ]]; then REAL_GROK="$c"; break; fi
  done
fi

# Resolve Grok Code repo root (GROK_CODE_ROOT → known clones → common Desktop paths)
resolve_root() {
  local candidates=(
    "${GROK_CODE_ROOT:-}"
    "$HOME/Desktop/Grok Code (Open Source)"
    "$HOME/Desktop/Grok Code"
    "$HOME/src/grok-code"
    "$HOME/grok-code"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -n "$c" && -f "$c/scripts/launch-grok-code.sh" ]]; then
      echo "$c"
      return 0
    fi
  done
  # When this file still lives in the repo scripts/ dir
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$here/launch-grok-code.sh" ]]; then
    cd "$here/.." && pwd
    return 0
  fi
  return 1
}
ROOT="$(resolve_root || true)"

LAUNCHER="${ROOT:+$ROOT/scripts/launch-grok-code.sh}"

# Already inside Grok Code terminal, or forced standalone TUI
if [[ -n "${GROK_CODE_EMBEDDED:-}" || -n "${GROK_STANDALONE:-}" ]]; then
  exec "$REAL_GROK" "$@"
fi

# Explicit escape hatch: grok --standalone [args…]
if [[ "${1:-}" == "--standalone" ]]; then
  shift
  exec "$REAL_GROK" "$@"
fi

# CLI subcommands / help / version must hit the real binary
SUBCMDS='agent|completions|dashboard|export|help|import|inspect|leader|login|logout|mcp|memory|models|plugin|sessions|setup|trace|update|version|v|worktree|wrap'
if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help|-v|--version)
      exec "$REAL_GROK" "$@"
      ;;
  esac
  if [[ "$1" =~ ^($SUBCMDS)$ ]]; then
    exec "$REAL_GROK" "$@"
  fi
fi

# Non-interactive (piped / scripted) → real binary headless-friendly path
if [[ ! -t 0 || ! -t 1 ]]; then
  exec "$REAL_GROK" "$@"
fi

# No Grok Code install available → fall back to real TUI
if [[ -z "${LAUNCHER:-}" || ! -f "$LAUNCHER" ]]; then
  exec "$REAL_GROK" "$@"
fi

# Bare `grok` or `grok "prompt…"` → Grok Code + embedded Grok Build
export GROK_CODE_ROOT="$ROOT"
export GROK_REAL_BIN="$REAL_GROK"
export GROK_CODE_OPEN_AGENT=1
export GROK_CODE_CWD="$(pwd)"

PROMPT_FILE=""
if [[ $# -gt 0 ]]; then
  # Optional initial prompt for the embedded session
  PROMPT_FILE="$(mktemp "${TMPDIR:-/tmp}/grok-code-prompt.XXXXXX")"
  # Join remaining args as the initial prompt text
  printf '%s' "$*" >"$PROMPT_FILE"
  export GROK_CODE_AGENT_PROMPT_FILE="$PROMPT_FILE"
fi

echo "Opening Grok Code with embedded Grok Build…" >&2
echo "  (use: grok --standalone   for the classic terminal-only TUI)" >&2

# If no folder args, open current working directory as the workspace
exec bash "$LAUNCHER" "$GROK_CODE_CWD"
