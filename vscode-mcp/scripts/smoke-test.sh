#!/usr/bin/env bash
# Thin wrapper — prefer the Node smoke test (Windows / macOS / Linux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/smoke-test.mjs"
