#!/usr/bin/env bash
# Resolve without a single committed dependency entry, then compile at the claim.
# https://doc.rust-lang.org/cargo/reference/config.html#resolverincompatible-rust-versions
set -euo pipefail
crate=${1:?usage: check-msrv-fresh.sh crate rust-version}
floor=${2:?usage: check-msrv-fresh.sh crate rust-version}
case "$crate" in forma-ir|forma-ir-derive|forma-server) ;; *) exit 2 ;; esac
[[ "$floor" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || exit 2
repo=$(git rev-parse --show-toplevel)
cd "$repo"
declared=$(sed -n 's/^rust-version *= *"\([^"]*\)".*/\1/p' "crates/$crate/Cargo.toml")
[[ "$declared" == "$floor" ]] || { echo 'MSRV argument differs from manifest' >&2; exit 1; }
# The snapshot must contain the source actually being checked.
git diff --exit-code HEAD -- Cargo.toml Cargo.lock crates e2e
scratch=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/forma-msrv-${crate}.XXXXXX")
echo "Fresh MSRV evidence: $scratch"
original=$(shasum -a 256 Cargo.lock)
git archive HEAD | tar -x -C "$scratch"
printf '%s\n' "$(git rev-parse HEAD)" > "$scratch/source-commit.txt"
cd "$scratch"
# No package entries survive. Seeding only the format permits old Cargo to
# consume stable's fresh result; never rewrite a resolved lock's format number.
printf 'version = 3\n' > Cargo.lock
export CARGO_BUILD_JOBS=3
CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo +stable generate-lockfile 2>&1 | tee resolve.log
grep -qx 'version = 3' Cargo.lock || { echo 'fresh resolver changed the old-Cargo lock format' >&2; exit 1; }
cargo "+$floor" check -p "$crate" --all-targets --locked 2>&1 | tee check.log
if [[ "$crate" == forma-server ]]; then
  cargo "+$floor" check -p "$crate" --all-targets --all-features --locked 2>&1 | tee check-all-features.log
fi
cd "$repo"
[[ "$(shasum -a 256 Cargo.lock)" == "$original" ]] || { echo 'candidate lock changed during fresh MSRV check' >&2; exit 1; }
echo "Fresh dependency resolve and Rust $floor check passed for $crate; candidate lock unchanged."
