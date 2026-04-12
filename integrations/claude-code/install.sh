#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${1:-$(pwd)}"

mkdir -p "$TARGET_DIR/.claude/agents" "$TARGET_DIR/.claude/rules"
cp "$SCRIPT_DIR/.claude/agents/"*.md "$TARGET_DIR/.claude/agents/"
cp "$SCRIPT_DIR/.claude/rules/"*.md "$TARGET_DIR/.claude/rules/"

echo "Installed unictl Claude Code support into $TARGET_DIR/.claude"
