#!/usr/bin/env bash
# Tests for scripts/check-published-crate.sh (SR43, FORMA-134): after a
# publish, a checksum that differs from the record fails, and a version that is
# not visible yet only warns. The network boundary is replaced: a stand-in
# `curl` first in PATH fails a set number of times, then prints a set body, and
# logs the URL it was asked for. Run: bash scripts/test-check-published-crate.sh
set -uo pipefail
export LC_ALL=C

here=$(cd "$(dirname "$0")" && pwd)
tool="$here/check-published-crate.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"
cat > "$work/bin/curl" <<'EOF'
#!/usr/bin/env bash
# Stand-in for curl: the last argument is the URL.
for last; do :; done
echo "$last" >> "$FAKE_DIR/urls"
calls=$(( $(cat "$FAKE_DIR/calls" 2>/dev/null || echo 0) + 1 ))
echo "$calls" > "$FAKE_DIR/calls"
if [ "$calls" -le "$FAKE_FAILURES" ]; then
  echo "curl: (22) The requested URL returned error: 404" >&2
  exit 22
fi
printf '%s' "$FAKE_BODY"
EOF
chmod +x "$work/bin/curl"

RECORD=a74a75a8ddfb8696f1e782e54b2163b7aafdb06100e51486b2ed760d997c5d55
OTHER=c46254a0bf215f83b8a1ece1081b3aa0329f85a8908095f1aa98e4d192718655
passed=0
failed=0
out=""
status=0

# run <failures before the body> <body> <args...>
run() {
  local failures=$1 body=$2
  shift 2
  rm -f "$work/calls" "$work/urls"
  out=$(PATH="$work/bin:$PATH" FAKE_DIR="$work" FAKE_FAILURES="$failures" FAKE_BODY="$body" \
    CHECK_ATTEMPTS=4 CHECK_INTERVAL=0 bash "$tool" "$@" 2>&1)
  status=$?
}
ok() { passed=$((passed + 1)); echo "ok - $1"; }
not_ok() { failed=$((failed + 1)); echo "not ok - $1"; echo "  status $status, output: $out"; }
expect() { # <name> <status> <substring> [<absent substring>]
  if [ "$status" -eq "$2" ] && [[ $out == *"$3"* ]] && { [ -z "${4:-}" ] || [[ $out != *"$4"* ]]; }; then
    ok "$1"
  else
    not_ok "$1"
  fi
}

body() { printf '{"version":{"num":"0.2.1","checksum":"%s"}}' "$1"; }

run 0 "$(body $RECORD)" forma-ir 0.2.1 "$RECORD"
expect "the recorded checksum passes" 0 "crates.io serves forma-ir 0.2.1 with the recorded sha256 $RECORD" "::warning"
if [ "$(cat "$work/urls")" = "https://crates.io/api/v1/crates/forma-ir/0.2.1" ]; then
  ok "it reads the version from crates.io's API"
else
  not_ok "it reads the version from crates.io's API"
fi

run 0 "$(body $OTHER)" forma-ir 0.2.1 "$RECORD"
expect "a checksum that differs from the record fails" 1 "differs from the recorded crate" "not visible yet"
expect "the failure points to crates.io's web page to yank" 1 "https://crates.io/crates/forma-ir/versions"
if [[ $out != *"cargo yank"* ]]; then ok "the failure does not offer cargo yank"; else not_ok "the failure does not offer cargo yank"; fi

run 2 "$(body $RECORD)" forma-ir 0.2.1 "$RECORD"
expect "a version that shows on the third poll passes" 0 "with the recorded sha256" "::warning"
if [ "$(cat "$work/calls")" = 3 ]; then ok "it polls until the version shows"; else not_ok "it polls until the version shows"; fi

run 4 "$(body $OTHER)" forma-ir 0.2.1 "$RECORD"
expect "a version not visible after the last poll only warns" 0 "forma-ir 0.2.1 not visible yet" "differs"
if [ "$(cat "$work/calls")" = 4 ]; then ok "it stops after CHECK_ATTEMPTS polls"; else not_ok "it stops after CHECK_ATTEMPTS polls"; fi

run 0 '{"errors":[{"detail":"crate forma-ir does not have a version 0.2.1"}]}' forma-ir 0.2.1 "$RECORD"
expect "an answer with no checksum counts as not visible, not as a mismatch" 0 "not visible yet" "differs"

run 0 "$(body 'not-a-checksum')" forma-ir 0.2.1 "$RECORD"
expect "a malformed checksum counts as not visible, not as a match" 0 "not visible yet" "serves"

run 0 "$(body $RECORD)" forma-ir 0.2.1 ""
expect "a missing recorded checksum fails" 1 "not a SHA-256"

echo "check-published-crate: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
