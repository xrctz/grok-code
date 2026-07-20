#!/usr/bin/env bash
# Thin wrapper — real logic lives in ensure-vscode-binary.mjs (Win/macOS/Linux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/ensure-vscode-binary.mjs" "$@"
