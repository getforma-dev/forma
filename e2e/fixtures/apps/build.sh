#!/usr/bin/env bash
set -euo pipefail

# Build the fixture applications (FORMA-188) from THIS working tree: link the
# three libraries into node_modules, build every app with @getforma/build in
# strict mode (any diagnostic above a note fails), then build the Rust servers
# that embed the output. e2e/fixtures/apps/apps.spec.ts starts the servers.
#
# P17 does the same against the packed set (scripts/release-fixture-apps.mjs):
# the sources, apps.json and lib/ are the same files; only whose `build` runs differs.
#
# Needs Node, npm packages built (npm run build) and cargo. Nothing is skipped.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

for pkg in core compiler build; do
  if [ ! -f "$REPO_DIR/packages/$pkg/dist/index.js" ]; then
    echo "Error: packages/$pkg/dist is missing; run \`npm run build\` first" >&2
    exit 1
  fi
done

mkdir -p "$SCRIPT_DIR/node_modules/@getforma"
for pkg in core compiler build; do
  ln -sfn "$REPO_DIR/packages/$pkg" "$SCRIPT_DIR/node_modules/@getforma/$pkg"
done

node "$SCRIPT_DIR/build.mjs"

# --locked: the e2e workspace's Cargo.lock is the only pin of what this lane
# compiles; refresh it with `cargo generate-lockfile --manifest-path e2e/Cargo.toml`
# when a dependency changes, and commit it.
cargo build --quiet --locked --manifest-path "$SCRIPT_DIR/Cargo.toml"

echo "✓ fixture applications built in $SCRIPT_DIR/out/"
