#!/bin/sh
# The protocol's Docker hygiene. Removes only: containers/images/networks/volumes labelled
# grandprix=forma-254, the gp254 builder (and its cache), and pulled base images that are absent
# from results/docker-before.md (only the contract's base images and the builder's own image).
# Records free disk before and after in results/cleanup.json (the report reads it).
# Usage: harness/cleanup.sh [--dry-run]
cd "$(dirname "$0")/.." || exit 1
DRY=0; [ "$1" = "--dry-run" ] && DRY=1
run() { echo "+ $*"; [ $DRY = 1 ] || "$@"; }
free() { df -h ~ | awk 'NR==2{print $4}'; }
BEFORE_RACE=$(sed -n 's/^Host free disk: *//p' results/docker-before.md | head -1)
BEFORE=$(free)

# 1. containers with the label
IDS=$(docker ps -aq --filter label=grandprix=forma-254)
[ -n "$IDS" ] && run docker rm -f $IDS
# 2. networks with the label
NETS=$(docker network ls -q --filter label=grandprix=forma-254)
[ -n "$NETS" ] && run docker network rm $NETS
# 3. images with the label (the car, -build and loadgen images; includes gp/signals)
IMGS=$(docker image ls -q --filter label=grandprix=forma-254 | sort -u)
[ -n "$IMGS" ] && run docker rmi -f $IMGS
# images gp/* that lost their label are still ours by name
for I in $(docker image ls --format '{{.Repository}}:{{.Tag}}' | grep '^gp/'); do run docker rmi -f "$I"; done
# 4. volumes with the label
VOLS=$(docker volume ls -q --filter label=grandprix=forma-254)
[ -n "$VOLS" ] && run docker volume rm $VOLS
# 5. the builder and its cache
if docker buildx ls | grep -q '^gp254'; then
  run docker buildx prune --builder gp254 -af
  run docker buildx rm gp254
fi
# 6. base images absent from docker-before.md (whitelist: the contract's bases and the builder image)
for I in $(docker image ls --format '{{.Repository}}:{{.Tag}}'); do
  case "$I" in
    node:22-bookworm-slim|oven/bun:1-slim|denoland/deno:2|denoland/deno:2.*|denoland/deno:debian|rust:1-slim-bookworm|debian:bookworm-slim|moby/buildkit:buildx-stable-1)
      if grep -q -F -- "- $I " results/docker-before.md; then echo "keep $I (was there before)"; else run docker rmi -f "$I"; fi ;;
  esac
done
# dangling layers left by the removals
[ $DRY = 1 ] || docker image prune -f --filter label=grandprix=forma-254 >/dev/null 2>&1
AFTER=$(free)
echo "free disk: before the race $BEFORE_RACE, before cleanup $BEFORE, after cleanup $AFTER"
if [ $DRY = 0 ]; then
  printf '{"diskBefore":"%s","diskBeforeCleanup":"%s","diskAfterCleanup":"%s","at":"%s"}\n' "$BEFORE_RACE" "$BEFORE" "$AFTER" "$(date -u +%FT%TZ)" > results/cleanup.json
  echo "left: containers $(docker ps -aq --filter label=grandprix=forma-254 | wc -l | tr -d ' '), images $(docker image ls -q --filter label=grandprix=forma-254 | wc -l | tr -d ' ')"
fi
