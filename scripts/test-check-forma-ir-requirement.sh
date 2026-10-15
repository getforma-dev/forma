#!/usr/bin/env bash
# Tests for scripts/check-forma-ir-requirement.sh (A2 audit F8, FORMA-180):
# the check passes on this tree and fails on a scratch copy of its manifests
# whose forma-server names another forma-ir version, normal or dev. The copy
# holds the real manifests and empty sources, so `cargo metadata --no-deps`
# reads it without a build. Run: bash scripts/test-check-forma-ir-requirement.sh
set -uo pipefail
export LC_ALL=C

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
tool="$here/check-forma-ir-requirement.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

passed=0
failed=0
out=""
status=0

run() { out=$(bash "$tool" "$@" 2>&1); status=$?; }
ok() { passed=$((passed + 1)); echo "ok - $1"; }
not_ok() { failed=$((failed + 1)); echo "not ok - $1"; echo "  status $status, output: $out"; }
expect_pass() { # <name> <substring>
  if [ "$status" -eq 0 ] && [[ $out == *"$2"* ]]; then ok "$1"; else not_ok "$1"; fi
}
expect_fail() { # <name> <substring>
  if [ "$status" -eq 1 ] && [[ $out == *"$2"* ]]; then ok "$1"; else not_ok "$1"; fi
}

# A scratch workspace: this tree's manifests, empty sources, no target.
fresh() {
  rm -rf "$work/ws"
  mkdir -p "$work/ws"
  cp "$root/Cargo.toml" "$work/ws/Cargo.toml"
  # Cargo loads every workspace member, including the derive placeholder,
  # before returning metadata for the two crates whose requirements we test.
  for crate in forma-ir forma-ir-derive forma-server; do
    mkdir -p "$work/ws/crates/$crate/src"
    cp "$root/crates/$crate/Cargo.toml" "$work/ws/crates/$crate/Cargo.toml"
    : > "$work/ws/crates/$crate/src/lib.rs"
  done
}

# Rewrite one of forma-server's two `forma-ir = { version = "…"` lines: the
# first is the normal dependency, the second the dev-dependency.
set_requirement() { # <ordinal 1|2> <version>
  awk -v n="$1" -v v="$2" '
    /^forma-ir = \{ version = "/ { seen++; if (seen == n) sub(/version = "[^"]*"/, "version = \"" v "\"") }
    { print }
  ' "$work/ws/crates/forma-server/Cargo.toml" > "$work/ws/server.toml"
  mv "$work/ws/server.toml" "$work/ws/crates/forma-server/Cargo.toml"
}

ir_version=$(cargo metadata --no-deps --format-version 1 --manifest-path "$root/Cargo.toml" \
  | jq -r '.packages[] | select(.name == "forma-ir") | .version')

run "$root/Cargo.toml"
expect_pass "this tree's requirement equals forma-ir's version" "ok: forma-server's normal and dev requirements start at forma-ir's version $ir_version"

fresh
run "$work/ws/Cargo.toml"
expect_pass "the scratch copy of this tree passes" "ok: forma-server's normal and dev requirements start at forma-ir's version $ir_version"

fresh
set_requirement 1 "=$ir_version"
set_requirement 2 "=$ir_version"
run "$work/ws/Cargo.toml"
expect_pass "exact requirements at the shared version pass" "ok: forma-server's normal and dev requirements start at forma-ir's version $ir_version"

fresh
set_requirement 1 "=9.9.8"
run "$work/ws/Cargo.toml"
expect_fail "an exact requirement for another version fails" "normal forma-ir requirement is =9.9.8, not ^$ir_version or =$ir_version"

fresh
set_requirement 1 ">=$ir_version"
run "$work/ws/Cargo.toml"
expect_fail "an unbounded requirement remains rejected" "normal forma-ir requirement is >=$ir_version, not ^$ir_version or =$ir_version"

fresh
set_requirement 1 "0.2.1"
run "$work/ws/Cargo.toml"
expect_fail "a normal requirement one patch behind fails" "normal forma-ir requirement is ^0.2.1, not ^$ir_version"

fresh
set_requirement 1 "0.2.0"
run "$work/ws/Cargo.toml"
expect_fail "the 0.2.0 requirement 0.2.2 carried until FORMA-138 fails" "normal forma-ir requirement is ^0.2.0, not ^$ir_version"

fresh
set_requirement 2 "0.2.1"
run "$work/ws/Cargo.toml"
expect_fail "a dev requirement one patch behind fails alone" "dev forma-ir requirement is ^0.2.1, not ^$ir_version"
if [[ $out != *"normal forma-ir requirement is"* ]]; then
  ok "the normal requirement, unchanged, is not reported"
else
  not_ok "the normal requirement, unchanged, is not reported"
fi

fresh
set_requirement 1 "0.3.0"
set_requirement 2 "0.3.0"
run "$work/ws/Cargo.toml"
expect_fail "a requirement ahead of forma-ir's version fails" "normal forma-ir requirement is ^0.3.0, not ^$ir_version"

# forma-ir bumped alone: the requirement that was equal is now behind.
fresh
sed 's/^version = "[^"]*"/version = "9.9.9"/' "$work/ws/Cargo.toml" > "$work/ws/root.toml" && mv "$work/ws/root.toml" "$work/ws/Cargo.toml"
run "$work/ws/Cargo.toml"
expect_fail "a workspace version bump without the requirement fails" "not ^9.9.9 or =9.9.9 (forma-ir's version)"

run "$work/does-not-exist/Cargo.toml"
if [ "$status" -eq 2 ] && [[ $out == *"is not a file"* ]]; then ok "a missing manifest is its own error"; else not_ok "a missing manifest is its own error"; fi

echo "check-forma-ir-requirement: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
