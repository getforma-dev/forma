#!/usr/bin/env bash
set -euo pipefail

# Build the preview-frame e2e lane (FORMA-175): pack @getforma/core from
# packages/core as npm publishes it, install the tarball into the fixture
# application (e2e/frame/app) as an application installs it, build that
# application with THIS repository's @getforma/build (`previewFrame: true`, and
# without it), and build the Rust server (e2e/frame/server) that embeds the
# output and serves forma-server's `PageResponse::frame` from it, for
# e2e/frame/frame.spec.ts.
#
# Since the repository merge (FORMA-113) everything the lane needs is in this
# tree: FormaJS is packages/core, the crates are crates/. The two variables may
# still name other checkouts.
#
#   FORMAJS_DIR  FormaJS checkout, already built (e2e/sync-fixtures.sh builds
#                it); its dist must hold formajs-frame.global.js (core 2.1.0,
#                FORMA-128). Default: packages/core.
#   FORMA_DIR    forma checkout (forma-server's frame.rs, FORMA-125).
#                Default: this repository.
#
# Needs Node, npm and cargo. Every step fails loudly; nothing is skipped.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FORMAJS_DIR="${FORMAJS_DIR:-$REPO_DIR/packages/core}"
FORMA_DIR="${FORMA_DIR:-$REPO_DIR}"

for dir_var in FORMAJS_DIR FORMA_DIR; do
  if [ ! -d "${!dir_var}" ]; then
    echo "Error: $dir_var not found at ${!dir_var}" >&2
    exit 1
  fi
done
FORMAJS_DIR="$(cd "$FORMAJS_DIR" && pwd)"
FORMA_DIR="$(cd "$FORMA_DIR" && pwd)"

if [ ! -f "$FORMAJS_DIR/dist/formajs-frame.global.js" ]; then
  echo "Error: $FORMAJS_DIR/dist/formajs-frame.global.js not found; build FormaJS first (e2e/sync-fixtures.sh does), from a checkout with the frame runtime (FORMA-128)" >&2
  exit 1
fi
if [ ! -f "$FORMA_DIR/crates/forma-server/src/frame.rs" ]; then
  echo "Error: $FORMA_DIR/crates/forma-server/src/frame.rs not found; FORMA_DIR must hold forma-server with the preview frame (FORMA-125)" >&2
  exit 1
fi
if [ "$FORMA_DIR" != "$REPO_DIR" ]; then
  echo "Error: server/Cargo.toml depends on this repository's forma-server by path; FORMA_DIR=$FORMA_DIR is another tree" >&2
  exit 1
fi

echo "FormaJS: $FORMAJS_DIR ($(git -C "$FORMAJS_DIR" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"
echo "forma:   $FORMA_DIR ($(git -C "$FORMA_DIR" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"

OUT="$SCRIPT_DIR/out"
rm -rf "$OUT" "$SCRIPT_DIR/app/node_modules"
mkdir -p "$OUT/pack"

# The packed tarball, as npm publishes core: its `files` decide what an
# application receives, so a frame runtime left out of the package fails here.
(cd "$FORMAJS_DIR" && npm pack --ignore-scripts --silent --pack-destination "$OUT/pack" > /dev/null)
TARBALL="$(ls "$OUT"/pack/getforma-core-*.tgz)"
# Core's dependencies from the fixture's lockfile (npm ci: exactly the
# versions and integrity it records), then core itself from the tarball,
# saved nowhere: a lockfile entry for the tarball would let npm ci install a
# cached copy of an earlier core under the same integrity (checked:
# build-app.mjs fails if core needs a dependency the lockfile does not pin).
npm ci --prefix "$SCRIPT_DIR/app" --ignore-scripts --no-audit --no-fund > /dev/null
npm install --prefix "$SCRIPT_DIR/app" --no-save --no-package-lock --ignore-scripts --no-audit --no-fund "$TARBALL" > /dev/null
echo "core:    $(node -p "require('$SCRIPT_DIR/app/node_modules/@getforma/core/package.json').version") from $(basename "$TARBALL")"

# The build package under test is this working tree's.
(cd "$REPO_DIR" && npm run build -w packages/compiler -w packages/build > /dev/null)

node "$SCRIPT_DIR/build-app.mjs"

# server/Cargo.toml depends on this repository's forma-server by path, inside
# the e2e workspace (e2e/Cargo.toml), whose Cargo.lock is the only pin of the
# dependencies this lane compiles. The server embeds the output at compile
# time, so it is rebuilt after build-app.mjs: cargo sees the embedded folder's
# files change. --locked: when the crates add or change a dependency this fails
# loudly; refresh the lock by running
#   cargo generate-lockfile --manifest-path e2e/Cargo.toml
# and commit e2e/Cargo.lock.
cargo build --quiet --locked --manifest-path "$SCRIPT_DIR/server/Cargo.toml"

echo "✓ preview-frame e2e lane built: $OUT, $SCRIPT_DIR/../target/debug/forma-e2e-frame"
