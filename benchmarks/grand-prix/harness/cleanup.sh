#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec node harness/cleanup.mjs "$@"
