# syntax=docker/dockerfile:1
FROM rust:1-slim-bookworm AS build
# Node 22 beside the Rust toolchain, copied from the pinned Node base image.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /app
ENV NODE_ENV=production
# Dependencies first (lockfiles), so the timed builds measure compilation, not downloads.
COPY admin/package.json admin/package-lock.json admin/.npmrc admin/
RUN cd admin && NODE_ENV=development npm ci
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo fetch --locked && rm -rf src
COPY admin/build.ts admin/tsconfig.json admin/
COPY admin/src admin/src
COPY src src
RUN mkdir -p /gp
COPY <<'EOS' /gp/build.sh
#!/bin/sh
# FMIR compile: delete the previous production output, run the strict SSR build, print the time.
set -e
cd /app/admin
rm -rf dist .dist.forma-*
s=$(date +%s%N)
npm run build:ssr
e=$(date +%s%N)
echo "GP_BUILD_MS=$(( (e - s) / 1000000 ))"
EOS
COPY <<'EOS' /gp/build-rust.sh
#!/bin/sh
# Rust compile: from an empty target directory, release profile (needs admin/dist from build.sh).
set -e
cd /app
rm -rf target
s=$(date +%s%N)
cargo build --release --locked --offline
e=$(date +%s%N)
echo "GP_RUST_BUILD_MS=$(( (e - s) / 1000000 ))"
EOS
RUN chmod +x /gp/*.sh && /gp/build.sh && /gp/build-rust.sh

FROM debian:bookworm-slim AS runtime
COPY --from=build /app/target/release/grandprix-forma /usr/local/bin/grandprix
ENV RUST_LOG=warn
EXPOSE 3000
CMD ["grandprix"]
