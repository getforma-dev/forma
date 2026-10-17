#!/usr/bin/env bash
# Private R17 body, sourced in a subshell by the already-Bash check command.
# Standalone core npm scripts retain their portable npm/Node/npx command chains.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../packages/core"
forma_check_build_package "$PWD" dist/formajs-runtime.global.js
node -e "require('fs').copyFileSync('dist/formajs-runtime.global.js','e2e/fixtures/formajs-runtime.global.js')"
npx playwright test "$@"
