#!/usr/bin/env bash
# Thin wrapper — real logic lives in patch-binary-branding.mjs (Win/macOS/Linux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/patch-binary-branding.mjs" "$@"
