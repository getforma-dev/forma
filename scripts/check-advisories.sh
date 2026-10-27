#!/usr/bin/env bash
# SR4/L-38: a failed audit OR an unreadable advisory source fails the gate.
# A manifest argument checks a release's unpacked crate and its recorded lock.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
if [ "$#" -eq 0 ]; then
  npm audit --omit=dev
  # The selected release line owns its starter inventory. A missing required
  # native-router directory must fail, while historical 3.0/3.1 stays two-template.
  templates=$(node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { npmPackagesForVersion } from './scripts/release-package-inventory.mjs';
import { templatesForPackages } from './scripts/template-lock-seeds.mjs';
const version = JSON.parse(readFileSync('packages/core/package.json', 'utf8')).version;
const packages = npmPackagesForVersion(version).map(name => ({ registry: 'npm', name: `@getforma/${name}` }));
console.log(templatesForPackages(packages).join(' '));
NODE
  )
  for template in $templates; do
    (cd "packages/create-app/templates/$template/admin" && npm audit --omit=dev)
  done
fi
manifest=${1:-$root/Cargo.toml}
# Do not accept an old cached advisory DB after a network failure.
cargo deny --locked --manifest-path "$manifest" fetch db
cargo deny --locked --manifest-path "$manifest" check advisories
