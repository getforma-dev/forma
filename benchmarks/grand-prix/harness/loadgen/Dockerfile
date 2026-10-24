FROM debian:bookworm-slim
ARG OHA_VERSION=v1.16.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/oha https://github.com/hatoo/oha/releases/download/${OHA_VERSION}/oha-linux-arm64 \
 && chmod +x /usr/local/bin/oha && oha --version
LABEL grandprix=forma-254
CMD ["sleep", "infinity"]
