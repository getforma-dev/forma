FROM node:22-bookworm-slim
LABEL grandprix=forma-264
WORKDIR /gp/signals
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY adapters ./adapters
COPY cars.mjs correctness.mjs benchmarks.mjs validation.mjs worker.mjs run.mjs ./
ENV NODE_ENV=production
# Results go to /out (mount the host's results/raw/signals there). Run with --cpus=1.
ENTRYPOINT ["node", "run.mjs"]
