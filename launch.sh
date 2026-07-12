#!/usr/bin/env bash
# Quick launcher for Grok Code (+ embedded Grok Build agent).
# Usage:
#   ./launch.sh
#   ./launch.sh /path/to/folder
#   GROK_CODE_OPEN_AGENT=0 ./launch.sh   # IDE only, no auto Grok Build terminal
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Open Grok Build inside the app by default (same as bare `grok`)
export GROK_CODE_OPEN_AGENT="${GROK_CODE_OPEN_AGENT:-1}"
export GROK_CODE_ROOT="${GROK_CODE_ROOT:-$ROOT}"
export GROK_REAL_BIN="${GROK_REAL_BIN:-$HOME/.grok/bin/grok}"
export GROK_CODE_CWD="${GROK_CODE_CWD:-$(pwd)}"

exec "$ROOT/scripts/launch-grok-code.sh" "$@"
