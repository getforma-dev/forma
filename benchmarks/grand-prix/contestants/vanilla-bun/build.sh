#!/bin/sh
# Production build: removes the previous output, bundles with `bun build --production`, prints the time.
cd /gp/app || exit 1
rm -rf dist
s=$(date +%s%N)
bun build src/server.mjs --target=bun --production --outdir dist || exit 1
e=$(date +%s%N)
echo "GP_BUILD_MS=$(( (e - s) / 1000000 ))"
