#!/bin/sh
# GP_WORKERS above 1: `deno serve --parallel` with DENO_JOBS set to that count; otherwise one thread.
if [ "${GP_WORKERS:-1}" -gt 1 ]; then
  export DENO_JOBS="$GP_WORKERS"
  exec deno serve --parallel --host 0.0.0.0 --port 3000 --allow-net --allow-env --allow-read=/app server.js
fi
exec deno serve --host 0.0.0.0 --port 3000 --allow-net --allow-env --allow-read=/app server.js
