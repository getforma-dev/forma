#!/usr/bin/env bash
# Compatibility entrypoint; the merged repository has one release implementation.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
exec bash "$root/scripts/release-artifacts.sh" "$@"
