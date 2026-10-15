#!/usr/bin/env bash
# Compatibility entrypoint; the merged repository has one release implementation.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
exec bash "$root/scripts/test-release-artifacts.sh" "$@"
