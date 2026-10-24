# The contract every car meets

Read `PROTOCOL.md` first. Builders build and smoke-test only; no timed run happens until the race
director starts the race on a quiet machine.

## Docker rules (all crews)

- Build only with the race's builder and label every image:
  `docker buildx build --builder gp254 --load --label grandprix=forma-254 -t gp/<car> contestants/<car>`.
  The pit-stop image is the same Dockerfile's `build` stage: add `--target build -t gp/<car>-build`.
- Every container you start carries `--label grandprix=forma-254` and is removed when you are done
  (`docker rm -f`). Leave nothing running.
- Before any `docker buildx build` or `npm install`, check the host's free disk (`df -h ~`); below
  4 GiB, stop and report. Never prune, remove or touch images, containers, volumes or builders the
  race did not create (`results/docker-before.md` lists what was there before).
- Base images: `node:22-bookworm-slim`, `oven/bun:1-slim`, `denoland/deno:2` (or `:debian`),
  `rust:1-slim-bookworm` for Rust build stages, `debian:bookworm-slim` for Rust runtimes. Pin
  dependencies with lockfiles.

## Server cars (`contestants/<car>/`)

- A multi-stage `Dockerfile`: stage `build` holds the toolchain and sources and has
  `/gp/build.sh`, which deletes the previous production output, runs the production build and ends
  by printing `GP_BUILD_MS=<milliseconds>`; the final stage is the production runtime only.
- The server listens on `0.0.0.0:3000`; `GET /health` returns 200 `ok`; `GET /ssr?rows=N` renders
  `shared/PAGE-SPEC.md` from `shared/dataset.mjs` (or its exact port), per request, no caching.
- `GP_WORKERS` (default 1) is the class switch: plain Node servers fork that many `node:cluster`
  workers, Bun starts that many `reusePort` servers, Deno uses `deno serve --parallel` when it is
  above 1 (Deno reads the core count itself; record what it does). Frameworks that ship one
  production process (Next.js, React Router, Astro) and Forma's Rust server ignore it.
- Production mode everywhere (`NODE_ENV=production`, release builds).
- Smoke test before you report: run the image with `--cpus=1 --memory=1g`, check `/health`, and
  check `/ssr?rows=100` and `/ssr?rows=1000` against `expected(n)` in `shared/dataset.mjs` (exact
  row count of `<tr data-id=`, every `mustContain` string). Record the result and the image size in
  `contestants/<car>/SMOKE.md`.

## Client cars (`client-race/apps/<car>/`): see `client-race/SPEC.md`

## Signals adapters (`signals-race/adapters/<car>.mjs`): see `signals-race/SPEC.md`
