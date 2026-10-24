FROM denoland/deno:debian AS build
WORKDIR /gp/app
COPY deno.json deno.lock ./
COPY src src
RUN deno cache --frozen src/server.mjs

COPY . .
RUN mv build.sh /gp/build.sh && chmod +x /gp/build.sh && /gp/build.sh

FROM denoland/deno:debian
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /gp/app/dist/ ./
COPY start.sh ./start.sh
USER deno
EXPOSE 3000
ENTRYPOINT ["sh", "/app/start.sh"]
