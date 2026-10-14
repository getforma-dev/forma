#!/usr/bin/env bash
# After `cargo publish`: does crates.io serve the crate this release recorded?
# (SR43, FORMA-134.)
#
#   check-published-crate.sh <crate> <version> <recorded-sha256>
#
# Reads the version's checksum from crates.io's API, which crates.io serves from
# its database (the sparse index sits behind a CDN that may cache a file for
# 600 s), and polls until the version shows. Three outcomes:
#   exit 0  "serves the recorded crate"        the checksum equals the record
#   exit 1  "differs from the recorded crate"  it does not: the version shipped
#           with other bytes than the ones verified, and must be yanked
#   exit 0  "not visible yet" (a warning)      no checksum after the last poll;
#           not a mismatch: compare by hand later
# CHECK_ATTEMPTS (default 30) and CHECK_INTERVAL in seconds (default 30) bound
# the wait: 15 minutes. Tested by scripts/test-check-published-crate.sh.
set -euo pipefail

crate=${1:?usage: check-published-crate.sh <crate> <version> <recorded-sha256>}
version=${2:?usage: check-published-crate.sh <crate> <version> <recorded-sha256>}
want=${3:-}
attempts=${CHECK_ATTEMPTS:-30}
interval=${CHECK_INTERVAL:-30}
url="https://crates.io/api/v1/crates/$crate/$version"
versions_page="https://crates.io/crates/$crate/versions"

if [[ ! $want =~ ^[0-9a-f]{64}$ ]]; then
  echo "::error title=no recorded checksum for $crate $version::the record gave '$want', not a SHA-256"
  exit 1
fi

got=""
i=1
while [ "$i" -le "$attempts" ]; do
  body=$(curl -fsS --max-time 20 -H 'User-Agent: getforma-release-ci (github.com/getforma-dev/forma)' "$url" 2>/dev/null) || body=""
  got=$(printf '%s' "$body" | jq -r '.version.checksum // empty' 2>/dev/null) || got=""
  if [[ $got =~ ^[0-9a-f]{64}$ ]]; then
    break
  fi
  got=""
  echo "attempt $i of $attempts: crates.io does not show $crate $version yet"
  if [ "$i" -lt "$attempts" ]; then
    sleep "$interval"
  fi
  i=$((i + 1))
done

if [ -z "$got" ]; then
  echo "::warning title=$crate $version not visible yet::crates.io's API did not show $crate $version after $attempts attempts. This is not a mismatch and nothing needs yanking. Compare by hand later: curl -s -H 'User-Agent: you' $url | jq -r .version.checksum must print $want."
  exit 0
fi

if [ "$got" != "$want" ]; then
  echo "::error title=$crate $version on crates.io differs from the recorded crate::crates.io's checksum is $got, the record's $want: the version shipped with other bytes than the ones verified. Yank it on crates.io's web page, $versions_page, signed in as the crate's owner (the trusted-publishing token cannot yank, and the account keeps no API token), then release a new version."
  exit 1
fi

echo "crates.io serves $crate $version with the recorded sha256 $want"
