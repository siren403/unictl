#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NATIVE_DIR="$REPO_ROOT/native/unictl_native"
PLUGIN_DIR="$REPO_ROOT/packages/upm/com.unictl.editor/Plugins/macOS"

cd "$NATIVE_DIR"
cargo build --release

mkdir -p "$PLUGIN_DIR"
cp target/release/libunictl_native.dylib "$PLUGIN_DIR/unictl_native.bundle"
codesign -s - -f "$PLUGIN_DIR/unictl_native.bundle"

echo "Built and signed: $PLUGIN_DIR/unictl_native.bundle"
