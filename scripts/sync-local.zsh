#!/bin/zsh
set -eu
export GIT_TERMINAL_PROMPT=0
repo="${AGENTS_KIT_REPO:-$HOME/agents_kit}"
exec "$repo/scripts/agents-kit" sync --json
