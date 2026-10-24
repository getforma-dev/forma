#!/bin/bash
# Usage: _build-smoke.sh <car>   builds gp/<car> and gp/<car>-build, smoke-tests, writes SMOKE.md.
car=$1
cd "$(dirname "$0")" || exit 1
LOG=/tmp/gpwork/$car; mkdir -p "$LOG"
free_gib=$(df -g ~ | awk 'NR==2{print $4}')
[ "$free_gib" -lt 4 ] && { echo "DISK LOW ${free_gib}GiB" ; exit 2; }
B="docker buildx build --builder gp254 --load --label grandprix=forma-254"
$B -t gp/$car $car >$LOG/build.log 2>&1 || { echo "BUILD FAIL $car"; tail -20 $LOG/build.log; exit 1; }
$B --target build -t gp/$car-build $car >$LOG/build-target.log 2>&1 || { echo "BUILD-TARGET FAIL $car"; tail -20 $LOG/build-target.log; exit 1; }
size() { docker image inspect "$1" --format '{{.Size}}' | awk '{printf "%.1f MB", $1/1000000}'; }
RS=$(size gp/$car); BS=$(size gp/$car-build)
out=smoke-$car.out; : > $LOG/$out
run_smoke() { # workers
  local w=$1 name=gp-smoke-$car-$1
  docker rm -f $name >/dev/null 2>&1
  docker run -d --name $name --label grandprix=forma-254 --cpus=1 --memory=1g -e GP_WORKERS=$w -p 127.0.0.1::3000 gp/$car >/dev/null || { echo "run failed"; return 1; }
  local port=$(docker port $name 3000/tcp | head -1 | sed 's/.*://')
  for i in $(seq 1 60); do curl -fs http://127.0.0.1:$port/health >/dev/null 2>&1 && break; sleep 0.5; done
  node _smoke.mjs http://127.0.0.1:$port; local rc=$?
  echo "procs: $(docker top $name 2>/dev/null | tail -n +2 | wc -l)"
  docker logs $name 2>&1 | tail -5
  docker rm -f $name >/dev/null 2>&1
  return $rc
}
{ echo "## GP_WORKERS=1"; run_smoke 1; r1=$?; echo "## GP_WORKERS=4"; run_smoke 4; r4=$?; } >$LOG/$out 2>&1
BMS=$(docker run --rm --label grandprix=forma-254 --cpus=4 gp/$car-build /gp/build.sh 2>&1 | grep GP_BUILD_MS)
{
echo "# $car smoke"
echo
echo "- Runtime image gp/$car: $RS; build image gp/$car-build: $BS"
echo "- Sample build time (one run, --cpus=4, not scored): $BMS"
echo "- Date: $(date +%F)"
echo
echo '```'; cat $LOG/$out; echo '```'
} > $car/SMOKE.md
cat $LOG/$out | grep -E "PASS|FAIL|procs"
echo "$car size runtime=$RS build=$BS $BMS"
