#!/bin/sh
# Copies the shared rendering sources from _shared/ into each car's src/ (a Docker build context
# cannot reach outside its car folder). _shared/ is the single source of truth: edit there, rerun.
cd "$(dirname "$0")" || exit 1
S=_shared
put() { car=$1; shift; mkdir -p "$car/src"; for f in "$@"; do src=${f%%:*}; dst=${f#*:}; cp "$S/$src" "$car/src/$dst"; done; }
base="dataset.mjs rows.mjs"
for rt in node bun deno; do
  put react-$rt dataset.mjs rows.mjs page.jsx render.react.mjs:render.mjs server.$rt.mjs:server.mjs
  put vanilla-$rt dataset.mjs rows.mjs page.vanilla.mjs render.vanilla.mjs:render.mjs server.$rt.mjs:server.mjs
done
put preact-node dataset.mjs rows.mjs preact/page.jsx:page.jsx render.react.mjs:render.mjs server.node.mjs:server.mjs
put solid-node dataset.mjs rows.mjs solid/page.jsx:page.jsx render.react.mjs:render.mjs server.node.mjs:server.mjs
put svelte-node dataset.mjs rows.mjs svelte/Page.svelte:Page.svelte svelte/render.mjs:render.mjs server.node.mjs:server.mjs
put vue-node dataset.mjs rows.mjs vue/Page.vue:Page.vue vue/render.mjs:render.mjs server.node.mjs:server.mjs
