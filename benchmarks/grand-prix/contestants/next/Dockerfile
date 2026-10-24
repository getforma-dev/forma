FROM node:22-bookworm-slim AS build
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN mkdir -p /gp && printf '%s\n' '#!/bin/sh' 'cd /app' 'rm -rf .next' 's=$(date +%s%3N)' 'npx next build || exit 1' 'e=$(date +%s%3N)' 'echo GP_BUILD_MS=$((e-s))' > /gp/build.sh && chmod +x /gp/build.sh && /gp/build.sh

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
