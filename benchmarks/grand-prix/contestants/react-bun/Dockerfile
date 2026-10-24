FROM oven/bun:1-slim AS build
WORKDIR /gp/app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN mv build.sh /gp/build.sh && chmod +x /gp/build.sh && /gp/build.sh

FROM oven/bun:1-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /gp/app/dist/ ./
USER bun
EXPOSE 3000
CMD ["bun", "server.js"]
