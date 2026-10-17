#!/usr/bin/env bash
set -euo pipefail

# Build the SSR e2e site: compile each case with THIS repository's compiler and
# build package, render it with forma's Rust walker and page template, and leave
# the result in e2e/ssr/out/site/ for e2e/ssr/serve.mjs.
#
# Since the repository merge (FORMA-113) everything the lane needs is in this
# tree: FormaJS is packages/core, the crates are crates/. The two variables may
# still name other checkouts.
#
#   FORMAJS_DIR  FormaJS checkout, already built (e2e/sync-fixtures.sh builds it).
#                Default: packages/core.
#   FORMA_DIR    forma checkout (forma-ir, forma-server). Default: this repository.
#
# FORMA_SSR_PROFILE may be debug (default) or release. Three-engine product
# qualification uses release: the server intentionally emits an endpoint-less
# Trusted Types report-only header in debug, which WebKit logs as a configuration error.
# Needs Node and cargo. Every step fails loudly; nothing is skipped.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

if [ ! -f "$FORMAJS_DIR/dist/index.js" ]; then
  echo "Error: $FORMAJS_DIR/dist/index.js not found; build FormaJS first (e2e/sync-fixtures.sh does)" >&2
  exit 1
fi
for crate in forma-ir forma-server; do
  if [ ! -f "$FORMA_DIR/crates/$crate/Cargo.toml" ]; then
    echo "Error: $FORMA_DIR/crates/$crate/Cargo.toml not found; FORMA_DIR must hold forma's crates" >&2
    exit 1
  fi
done
if [ "$FORMA_DIR" != "$REPO_DIR" ]; then
  echo "Error: render/Cargo.toml depends on this repository's crates by path; FORMA_DIR=$FORMA_DIR is another tree" >&2
  exit 1
fi

PROFILE_ARGS=()
case "${FORMA_SSR_PROFILE:-debug}" in
  debug) ;;
  release) PROFILE_ARGS+=(--release) ;;
  *) echo "Error: FORMA_SSR_PROFILE must be debug or release" >&2; exit 1 ;;
esac

echo "FormaJS: $FORMAJS_DIR ($(git -C "$FORMAJS_DIR" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"
echo "forma:   $FORMA_DIR ($(git -C "$FORMA_DIR" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"

# The cases import '@getforma/core'; resolve it to the FormaJS checkout under test.
mkdir -p "$SCRIPT_DIR/node_modules/@getforma"
ln -sfn "$FORMAJS_DIR" "$SCRIPT_DIR/node_modules/@getforma/core"

# The compiler and build package under test are this working tree's.
if declare -F forma_check_build_package > /dev/null; then
  forma_check_build_package "$REPO_DIR/packages/compiler" dist/index.js dist/index.d.ts
  forma_check_build_package "$REPO_DIR/packages/build" dist/index.js dist/index.d.ts
else
  (cd "$REPO_DIR" && npm run build -w packages/compiler -w packages/build > /dev/null)
fi

node "$SCRIPT_DIR/build-cases.mjs"

# render/Cargo.toml depends on this repository's crates by path, inside the e2e
# workspace (e2e/Cargo.toml), whose Cargo.lock is the only pin of the
# dependencies this lane compiles. --locked: when the crates add or change a
# dependency this fails loudly; refresh the lock by running
#   cargo generate-lockfile --manifest-path e2e/Cargo.toml
# and commit e2e/Cargo.lock.
# Bash 3.2 (macOS) treats an empty array expansion as unset under nounset.
# Preserve zero debug arguments and exactly one release argument on both shells.
cargo run --quiet --locked ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} --manifest-path "$SCRIPT_DIR/render/Cargo.toml" -- \
  "$SCRIPT_DIR/cases" "$SCRIPT_DIR/out/build" "$SCRIPT_DIR/out/site"

echo "✓ SSR e2e site built in $SCRIPT_DIR/out/site/"
