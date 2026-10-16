# FORMA-144 final template source and dependency qualification

Base: `dbf3f987a2e3ec4df2613b85b68613fff5d861b0`. This records the
final-slice source changes and local dependency checks. Current packed P17,
Linux/Windows scaffold CI, independent review and release qualification remain
required; these logs do not mark the ticket complete.

The original changed files are preserved under
[`docs/archive/forma-144-final-before`](../../archive/forma-144-final-before/manifest.json)
with their base commit, lengths and SHA-256 hashes. This directory's manifest
authenticates the raw logs, exact original/corrected audits and registry observations.

## Dependency result

The original root/workspace manifests and lockfile were extracted from that
exact base into an isolated audit directory. `npm audit --package-lock-only
--ignore-scripts --json` reports 11 findings there and zero in the corrected
workspace graph. All four test runners now use Vitest 4.1.12 (range
`^4.1.11`); coverage uses the same version. Root runner and happy-dom
dependencies make the hoisted runner's environment resolution explicit.
Compatible transitive fixes include compression 1.8.2 under serve 14.2.6.
The existing esbuild/rollup overrides remain; tsup stays 8.5.1.

The complete path/version delta records 765 → 350 lock entries, including
removal of stale duplicate runner and bundler graphs. The corrected workspace
has one esbuild, 0.28.1. This does not describe the separate template locks:
their two authenticated esbuild resolutions are deliberately retained.
The dashboard still reports four high findings in its documented Tailwind
watcher chain; registry observation confirms CLI 4.3.3 still pins watcher
2.5.1. Its existing advisory/deployment documentation remains applicable.

All installs used scripts off. The corrected signature check verifies 292
registry signatures and 61 attestations. No forced major dependency upgrade
or template external-lock rewrite was used to clear the root audit.

## Validation and preserved failures

- All four workspace builds passed. Compiler 1,543 and build 363 tests passed
  with `--maxWorkers=2`. The first core run failed before running tests because
  its hoisted runner could not resolve happy-dom; that complete failure is
  retained in `workspaces-first.log`. Explicit root environment dependencies
  corrected this, and all 3,254 core tests passed in `core-corrected.log`.
- Create-app's 153 structural tests passed. Its 18 opt-in packed/native cases
  were explicitly skipped in this local command; final packed evidence is
  still required. All five existing core package-size gates passed unchanged.
- Nine focused range/seed checks passed. The expanded staging test initially
  assumed dashboard directly depends on forma-ir, causing three failures; it
  now asserts minimal's exact two direct Forma dependencies and dashboard's
  exact server dependency. All 11 corrected staging/seed tests pass, covering
  development, beta and stable versions, unchanged typed Rust sources, exact
  candidate lock hashes, corruption refusal and restoration on callback failure.
- The new upgrade guide's relative links resolve to preserved originals,
  current template sources and the compiler/server documentation.

Stable shipped requirements are caret ranges while prerelease requirements
and source seeds stay exact. Exact candidate version/hash validation happens
before P17 substitutes local archive references. The minimal counter/static
page and explicit Browser dashboard still require their actual packed browser
checks; source staging tests cannot substitute for those controls.
