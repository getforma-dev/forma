FROM node:22-bookworm-slim AS build
WORKDIR /gp/app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN mv build.sh /gp/build.sh && chmod +x /gp/build.sh && /gp/build.sh

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /gp/app/dist/ ./
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
