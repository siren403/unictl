#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

mkdir -p "$REPO_ROOT/dist"
cd "$REPO_ROOT"
bun build ./packages/cli/src/cli.ts --outfile ./dist/unictl.js --target bun

echo "Built ./dist/unictl.js"
