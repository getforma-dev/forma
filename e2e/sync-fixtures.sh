#!/usr/bin/env bash
set -euo pipefail

# Sync FormaJS builds into E2E test fixtures.
# Called automatically by `npm run test:e2e` — no manual copy needed.
#
# Since the repository merge (FORMA-113) FormaJS is packages/core of this
# repository; FORMAJS_DIR may still name another checkout.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
FORMAJS_DIR="${FORMAJS_DIR:-$(cd "$SCRIPT_DIR/../packages/core" && pwd)}"

if [ ! -d "$FORMAJS_DIR" ]; then
  echo "Error: FormaJS directory not found at $FORMAJS_DIR"
  echo "Set FORMAJS_DIR environment variable to the formajs checkout path."
  exit 1
fi

echo "Building FormaJS..."
# Quiet on success, the whole output on failure: a silent exit 1 here once
# left the lane running against the stale bundles git used to track
# (2026-10-15, FORMA-105).
BUILD_LOG="$(mktemp -t forma-core-build.XXXXXX)"
if ! (cd "$FORMAJS_DIR" && npm run build) > "$BUILD_LOG" 2>&1; then
  echo "Error: FormaJS build failed in $FORMAJS_DIR; its output:" >&2
  cat "$BUILD_LOG" >&2
  rm -f "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"

echo "Copying fixtures..."
RUNTIME_BUNDLE="$FORMAJS_DIR/dist/formajs-runtime.global.js"
ESM_BUNDLE="$FORMAJS_DIR/dist/forma.esm.js"
# Resolve from the selected package: npm may hoist the declared dependency to
# the workspace root, while an external FORMAJS_DIR can keep its own install.
ESBUILD_BIN="$(node -e 'console.log(require.resolve("esbuild/bin/esbuild", { paths: [process.argv[1]] }))' "$FORMAJS_DIR")"

for required_file in "$RUNTIME_BUNDLE" "$ESM_BUNDLE" "$ESBUILD_BIN"; do
  if [ ! -f "$required_file" ]; then
    echo "Error: required FormaJS build input not found at $required_file"
    exit 1
  fi
done

cp "$RUNTIME_BUNDLE" "$FIXTURES_DIR/formajs-runtime.global.js"
"$ESBUILD_BIN" "$ESM_BUNDLE" \
  --bundle --format=iife --global-name=FormaJS --target=es2022 \
  --outfile="$FIXTURES_DIR/formajs.global.js"

node -e "
  const source = require('fs').readFileSync('$FIXTURES_DIR/formajs.global.js', 'utf8');
  if (!/var FormaJS\\s*=/.test(source)) {
    console.error('Error: rebuilt formajs.global.js does not define the FormaJS global.');
    process.exit(1);
  }
"

echo "✓ E2E fixtures synced from $FORMAJS_DIR/dist/"
