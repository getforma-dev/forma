#!/usr/bin/env bash
# forma-server's `forma-ir` requirement, normal and dev, must equal forma-ir's
# version (A2 audit F8, FORMA-180).
#
# In this workspace `[patch.crates-io]` resolves forma-ir from the tree, so a
# requirement looser than the tree's version (`"0.2.0"` when the tree is 0.2.2,
# as 0.2.2 shipped until FORMA-138) builds and tests green here and in the
# release workflow's `verify` job, which builds the packed crate against the
# published forma-ir it names: nothing in CI sees that a consumer's lock may
# hold an older forma-ir that lacks what forma-server calls. Reads the
# manifests through `cargo metadata`, which resolves `version.workspace = true`;
# grep on the crate manifest would see that literal. Prints the three versions;
# exits 1 if they are not one. Verified by: scripts/test-check-forma-ir-requirement.sh
# FORMA-112 replaces this with the one-version rule at the merge.
#
#   bash scripts/check-forma-ir-requirement.sh [path/to/Cargo.toml]
set -euo pipefail

manifest="${1:-Cargo.toml}"
if [ ! -f "$manifest" ]; then
  echo "::error::check-forma-ir-requirement: $manifest is not a file" >&2
  exit 2
fi

metadata=$(cargo metadata --no-deps --format-version 1 --manifest-path "$manifest")

ir_version=$(jq -r '.packages[] | select(.name == "forma-ir") | .version' <<< "$metadata")
if [ -z "$ir_version" ]; then
  echo "::error::check-forma-ir-requirement: no package forma-ir in $manifest" >&2
  exit 2
fi

# `.req` is the requirement as cargo normalised it: `"0.2.2"` reads `^0.2.2`.
requirement() { # <kind: normal|dev>
  jq -r --arg kind "$1" '
    [.packages[] | select(.name == "forma-server") | .dependencies[]
     | select(.name == "forma-ir" and .kind == (if $kind == "normal" then null else $kind end))
     | .req] | join(" ")' <<< "$metadata"
}
normal_req=$(requirement normal)
dev_req=$(requirement dev)

echo "forma-ir version:                        $ir_version"
echo "forma-server's forma-ir requirement:     ${normal_req:-(none)}"
echo "forma-server's dev forma-ir requirement: ${dev_req:-(none)}"

failed=0
for pair in "normal:$normal_req" "dev:$dev_req"; do
  kind=${pair%%:*}
  req=${pair#*:}
  if [ "$req" != "^$ir_version" ]; then
    echo "::error::forma-server's $kind forma-ir requirement is ${req:-missing}, not ^$ir_version (forma-ir's version); set \`forma-ir = { version = \"$ir_version\", ... }\` in crates/forma-server/Cargo.toml, normal and dev" >&2
    failed=1
  fi
done
if [ "$failed" -eq 0 ]; then
  echo "ok: forma-server requires forma-ir ^$ir_version, normal and dev, which is forma-ir's version"
fi
exit "$failed"
