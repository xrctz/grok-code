#!/usr/bin/env bash
# Thin wrapper — real logic lives in launch-grok-code.mjs (Win/macOS/Linux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/launch-grok-code.mjs" "$@"
