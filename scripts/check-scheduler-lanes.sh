#!/usr/bin/env bash
# Private lane entrypoint under the unchanged Linux owner. No command copies.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$#" -eq 3 ] || exit 2
lane="$1"; started="$2"; scheduler_evidence="$3"
case "$lane" in a|b) ;; *) exit 2;; esac
check_mode=linux-overlap
step() { echo; echo "### $* ($(( $(date +%s) - started ))s)"; }
source scripts/check-stages.sh
plan="$(node scripts/check-scheduler-admission.mjs --plan "$lane")"
for stage_id in $plan; do
  forma_check_stage "$stage_id"
done
