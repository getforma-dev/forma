FROM node:22-bookworm-slim AS build
ENV NODE_ENV=production ASTRO_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN mkdir -p /gp && printf '%s\n' '#!/bin/sh' 'cd /app' 'rm -rf dist .astro' 's=$(date +%s%3N)' 'npx astro build || exit 1' 'e=$(date +%s%3N)' 'echo GP_BUILD_MS=$((e-s))' > /gp/build.sh && chmod +x /gp/build.sh && /gp/build.sh

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "./dist/server/entry.mjs"]
