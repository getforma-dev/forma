#!/usr/bin/env bash
# SR30: command-line policy takes precedence over machine/user npm config.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "${1:-$root}"
[ -f package-lock.json ] || { echo 'A committed package-lock.json is required.' >&2; exit 1; }
npm ci --ignore-scripts --no-audit
