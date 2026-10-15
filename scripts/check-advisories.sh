#!/usr/bin/env bash
# SR4/L-38: a failed audit OR an unreadable advisory source fails the gate.
# A manifest argument checks a release's unpacked crate and its recorded lock.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
if [ "$#" -eq 0 ]; then
  npm audit --omit=dev
  for template in minimal dashboard; do
    (cd "packages/create-app/templates/$template/admin" && npm audit --omit=dev)
  done
fi
manifest=${1:-$root/Cargo.toml}
# Do not accept an old cached advisory DB after a network failure.
cargo deny --locked --manifest-path "$manifest" fetch db
cargo deny --locked --manifest-path "$manifest" check advisories
