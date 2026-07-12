#!/usr/bin/env bash
# Launch Claude Code CLI with the free giveaway API provider pre-configured.
# Runs with bypass permissions enabled (no permission prompts).
#
# Used by Grok Code's "Open Claude Code" button (integrated terminal — not auto-boot).
# Bridge env (VSCODE_MCP_*) is inherited when launched from the Grok Code UI pack.

export PATH="${HOME}/.npm-global/bin:${HOME}/.local/bin:${PATH}"
export ANTHROPIC_BASE_URL="https://claude-code-cli.vibecode-claude.online"
export ANTHROPIC_API_KEY="cap_768d12e7607cc03193a7795c8e24da6a05bc33aa4661c64d"
export ANTHROPIC_AUTH_TOKEN="cap_768d12e7607cc03193a7795c8e24da6a05bc33aa4661c64d"

# Start in this folder (or pass a project dir as the first argument)
PROJECT_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
cd "$PROJECT_DIR" || exit 1

# Optional: load bridge token from Grok Code workspace env if not already set
if [[ -z "${VSCODE_MCP_TOKEN:-}" ]]; then
  for envfile in \
    "${PROJECT_DIR}/.vscode-mcp.env" \
    "${HOME}/.grok-code-app/.vscode-mcp.env" \
    "${HOME}/.vscode-mcp.env"
  do
    if [[ -f "$envfile" ]]; then
      # shellcheck disable=SC1090
      set -a
      # shellcheck disable=SC1090
      source "$envfile" 2>/dev/null || true
      set +a
      break
    fi
  done
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI not found on PATH."
  echo "Install with: npm install -g @anthropic-ai/claude-code"
  echo
  read -r -p "Press Enter to close..."
  exit 1
fi

echo "Claude Code  ·  $(claude --version 2>/dev/null)"
echo "Project:      $PROJECT_DIR"
echo "Base URL:     $ANTHROPIC_BASE_URL"
echo "Permissions:  bypassPermissions (all checks skipped)"
if [[ -n "${VSCODE_MCP_URL:-}" || -n "${VSCODE_MCP_PORT:-}" ]]; then
  echo "Grok bridge:  ${VSCODE_MCP_URL:-http://${VSCODE_MCP_HOST:-127.0.0.1}:${VSCODE_MCP_PORT:-7331}}"
fi
echo
# --dangerously-skip-permissions: actually bypass checks
# --permission-mode bypassPermissions: set session mode to bypass
exec claude \
  --dangerously-skip-permissions \
  --permission-mode bypassPermissions
