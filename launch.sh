#!/usr/bin/env bash
# Quick launcher for Grok Code (+ embedded Grok Build agent).
# Works on Ubuntu/Linux and macOS (requires Node 20+).
# Usage:
#   ./launch.sh
#   ./launch.sh /path/to/folder
#   GROK_CODE_OPEN_AGENT=0 ./launch.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export GROK_CODE_OPEN_AGENT="${GROK_CODE_OPEN_AGENT:-1}"
export GROK_CODE_ROOT="${GROK_CODE_ROOT:-$ROOT}"
export GROK_REAL_BIN="${GROK_REAL_BIN:-$HOME/.grok/bin/grok}"
export GROK_CODE_CWD="${GROK_CODE_CWD:-$(pwd)}"

exec node "$ROOT/scripts/launch-grok-code.mjs" "$@"
