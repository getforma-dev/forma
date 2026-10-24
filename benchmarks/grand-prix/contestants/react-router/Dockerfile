FROM node:22-bookworm-slim AS build
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN mkdir -p /gp && printf '%s\n' '#!/bin/sh' 'cd /app' 'rm -rf build .react-router' 's=$(date +%s%3N)' 'npx react-router build || exit 1' 'e=$(date +%s%3N)' 'echo GP_BUILD_MS=$((e-s))' > /gp/build.sh && chmod +x /gp/build.sh && /gp/build.sh

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
USER node
EXPOSE 3000
CMD ["npx", "react-router-serve", "./build/server/index.js"]
