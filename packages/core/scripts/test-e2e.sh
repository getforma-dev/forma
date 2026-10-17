#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# R17 sources this in a subshell after its fresh core build. Ordinary npm
# commands start a new shell without this private, unexported build state.
if declare -F forma_check_build_package > /dev/null; then
  forma_check_build_package "$PWD" dist/formajs-runtime.global.js
else
  npm run build
fi
node -e "require('fs').copyFileSync('dist/formajs-runtime.global.js','e2e/fixtures/formajs-runtime.global.js')"
npx playwright test "$@"
