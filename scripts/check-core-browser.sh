#!/usr/bin/env bash
# Private R17 body, sourced in a subshell by the already-Bash check command.
# Standalone core npm scripts retain their portable npm/Node/npx command chains.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../packages/core"
forma_check_prepare_core_browser
npx playwright test "$@"
