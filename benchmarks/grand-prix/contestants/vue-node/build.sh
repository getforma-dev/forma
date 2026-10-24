#!/bin/sh
# Production build: removes the previous output, runs the Vite SSR build, prints the time taken.
cd /gp/app || exit 1
rm -rf dist
s=$(date +%s%N)
npx vite build --logLevel warn || exit 1
GP_ISLAND_TARGET=server npx vite build --config vite.island.config.js --logLevel warn || exit 1
GP_ISLAND_TARGET=client npx vite build --config vite.island.config.js --logLevel warn || exit 1
e=$(date +%s%N)
echo "GP_BUILD_MS=$(( (e - s) / 1000000 ))"
