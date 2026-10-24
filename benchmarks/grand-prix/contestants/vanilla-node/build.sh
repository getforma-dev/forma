#!/bin/sh
# Production build: vanilla has no toolchain, so the "build" copies the sources to dist/.
cd /gp/app || exit 1
rm -rf dist
s=$(date +%s%N)
mkdir dist && cp src/*.mjs dist/
e=$(date +%s%N)
echo "GP_BUILD_MS=$(( (e - s) / 1000000 ))"
