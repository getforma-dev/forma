#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node e2e/skew/build-app.mjs
cargo build --locked --manifest-path e2e/Cargo.toml -p forma-e2e-skew
