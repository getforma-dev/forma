#!/bin/sh
# Production build: removes the previous output, bundles with `deno bundle` (minified), prints the time.
cd /gp/app || exit 1
rm -rf dist
s=$(date +%s%N)
deno bundle --minify --platform deno --frozen --output dist/server.js src/server.mjs || exit 1
deno bundle --minify --platform deno --frozen --output dist/island-server.mjs src/island-server.jsx || exit 1
deno bundle --minify --platform browser --frozen --output dist/island-client.js src/island-client.jsx || exit 1
e=$(date +%s%N)
echo "GP_BUILD_MS=$(( (e - s) / 1000000 ))"
