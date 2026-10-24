#!/bin/sh
# Production build: removes the previous output, bundles with `deno bundle` (minified), prints the time.
cd /gp/app || exit 1
rm -rf dist
s=$(date +%s%N)
deno bundle --minify --platform deno --output dist/server.js src/server.mjs || exit 1
e=$(date +%s%N)
echo "GP_BUILD_MS=$(( (e - s) / 1000000 ))"
