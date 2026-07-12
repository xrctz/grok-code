#!/usr/bin/env bash
# Ensure a VS Code binary exists for Grok Code, download if missing, apply branding.
# Prints the absolute path of the `code` binary on stdout (last line).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_ROOT="${GROK_CODE_CACHE:-$HOME/.local/share/grok-code}"
APP_DIR="${GROK_CODE_APP:-$CACHE_ROOT/app}"
DOWNLOAD_DIR="${GROK_CODE_DOWNLOAD_DIR:-$CACHE_ROOT/download}"
# Legacy path used by earlier versions of this playground
LEGACY_APP="/tmp/vscode-extract/usr/share/code"

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) VSCODE_ARCH="x64" ;;
  aarch64|arm64) VSCODE_ARCH="arm64" ;;
  armv7l|armhf) VSCODE_ARCH="armhf" ;;
  *)
    echo "Unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

is_code_bin() {
  local p="${1:-}"
  [[ -n "$p" && -f "$p" && -x "$p" ]]
}

find_existing() {
  local candidates=(
    "${CODE_BIN:-}"
    "$APP_DIR/bin/code"
    "$LEGACY_APP/bin/code"
    "/tmp/vscode-extract/usr/share/code/bin/code"
    "/usr/share/code/bin/code"
    "/usr/bin/code"
    "/usr/share/code-oss/bin/code-oss"
    "/usr/bin/code-oss"
    "/usr/bin/codium"
    "/snap/bin/code"
  )

  # Also honour PATH lookups without treating Cursor as VS Code.
  if command -v code >/dev/null 2>&1; then
    candidates+=("$(command -v code)")
  fi
  if command -v code-oss >/dev/null 2>&1; then
    candidates+=("$(command -v code-oss)")
  fi
  if command -v codium >/dev/null 2>&1; then
    candidates+=("$(command -v codium)")
  fi

  local c
  for c in "${candidates[@]}"; do
    if is_code_bin "$c"; then
      # Resolve symlinks for a stable path
      if command -v readlink >/dev/null 2>&1; then
        readlink -f "$c" 2>/dev/null || echo "$c"
      else
        echo "$c"
      fi
      return 0
    fi
  done
  return 1
}

download_and_extract() {
  mkdir -p "$DOWNLOAD_DIR" "$CACHE_ROOT"

  local url="https://update.code.visualstudio.com/latest/linux-${VSCODE_ARCH}/stable"
  local tarball="$DOWNLOAD_DIR/vscode-linux-${VSCODE_ARCH}.tar.gz"
  local extract_tmp="$DOWNLOAD_DIR/extract-$$"

  echo "Downloading VS Code (linux-${VSCODE_ARCH}, stable)..." >&2
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --retry-delay 2 -o "$tarball" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$tarball" "$url"
  else
    echo "Need curl or wget to download VS Code." >&2
    exit 1
  fi

  echo "Extracting to $APP_DIR ..." >&2
  rm -rf "$extract_tmp"
  mkdir -p "$extract_tmp"
  tar -xzf "$tarball" -C "$extract_tmp"

  # Tarball unpacks to a single top-level dir (e.g. VSCode-linux-x64)
  local unpacked
  unpacked="$(find "$extract_tmp" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  if [[ -z "$unpacked" || ! -f "$unpacked/bin/code" ]]; then
    echo "Unexpected VS Code tarball layout under $extract_tmp" >&2
    ls -la "$extract_tmp" >&2 || true
    exit 1
  fi

  rm -rf "$APP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  mv "$unpacked" "$APP_DIR"
  rm -rf "$extract_tmp"

  # Optional: keep a small stamp so we know which build we have
  date -u +"%Y-%m-%dT%H:%M:%SZ" >"$CACHE_ROOT/installed-at.txt" || true
  echo "$url" >"$CACHE_ROOT/source-url.txt" || true

  if [[ ! -x "$APP_DIR/bin/code" ]]; then
    chmod +x "$APP_DIR/bin/code" 2>/dev/null || true
  fi

  echo "VS Code installed at $APP_DIR" >&2
}

apply_branding() {
  local app="$1"
  local patch="$ROOT/scripts/patch-binary-branding.sh"
  if [[ -x "$patch" || -f "$patch" ]]; then
    if [[ -d "$app/resources/app" ]]; then
      echo "Applying Grok Code branding..." >&2
      bash "$patch" "$app" || echo "Warning: branding patch failed (continuing)." >&2
    fi
  fi
}

main() {
  local force="${1:-}"
  local bin=""

  if [[ "$force" != "--force" ]] && bin="$(find_existing)"; then
    # Brand only our managed app tree (not system installs)
    if [[ "$bin" == "$APP_DIR/bin/code" || "$bin" == "$LEGACY_APP/bin/code" ]]; then
      local app_root
      app_root="$(cd "$(dirname "$bin")/.." && pwd)"
      if [[ -d "$app_root/resources/app" ]] && [[ ! -f "$app_root/resources/app/out/vs/code/electron-browser/workbench/grok-code.css" ]]; then
        apply_branding "$app_root"
      fi
    fi
    echo "$bin"
    return 0
  fi

  if [[ "$force" == "--force" ]]; then
    echo "Forcing re-download of VS Code..." >&2
  else
    echo "No VS Code / Code - OSS binary found. Bootstrapping..." >&2
  fi

  download_and_extract
  apply_branding "$APP_DIR"

  if ! is_code_bin "$APP_DIR/bin/code"; then
    echo "Bootstrap failed: $APP_DIR/bin/code missing or not executable" >&2
    exit 1
  fi

  # Symlink legacy path for scripts that still expect /tmp/vscode-extract
  if [[ ! -e "$LEGACY_APP/bin/code" ]]; then
    mkdir -p "$(dirname "$LEGACY_APP")"
    ln -sfn "$APP_DIR" "$LEGACY_APP" 2>/dev/null || true
  fi

  echo "$APP_DIR/bin/code"
}

main "${1:-}"
