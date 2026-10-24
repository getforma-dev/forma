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

# Round-2 native island entrants use a separate renderer/client build. The
# original static renderer and the server-only controls keep their source mode.
for rt in node bun deno; do
  put react-$rt server.island.$rt.mjs:server.mjs island-ready.mjs island-route.mjs island/react/Island.jsx:Island.jsx island/react/island-client.jsx:island-client.jsx island/react/island-server.jsx:island-server.jsx
done
for family in preact solid; do
  put $family-node server.island.node.mjs:server.mjs island-ready.mjs island-route.mjs island/$family/Island.jsx:Island.jsx island/$family/island-client.jsx:island-client.jsx island/$family/island-server.jsx:island-server.jsx
done
put svelte-node server.island.node.mjs:server.mjs island-ready.mjs island-route.mjs island/svelte/Island.svelte:Island.svelte island/svelte/island-client.mjs:island-client.mjs island/svelte/island-server.mjs:island-server.mjs
put vue-node server.island.node.mjs:server.mjs island-ready.mjs island-route.mjs island/vue/Island.vue:Island.vue island/vue/island-client.mjs:island-client.mjs island/vue/island-server.mjs:island-server.mjs
