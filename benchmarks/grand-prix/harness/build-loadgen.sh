#!/bin/sh
# Builds gp/loadgen (oha, arm64) with the race's builder and label.
cd "$(dirname "$0")/.." || exit 1
FREE=$(df -g ~ | awk 'NR==2{print $4}'); [ "$FREE" -lt 4 ] && { echo "free disk below 4 GiB, stop"; exit 1; }
docker buildx build --builder gp254 --platform linux/arm64 --load --label grandprix=forma-254 -t gp/loadgen harness/loadgen
