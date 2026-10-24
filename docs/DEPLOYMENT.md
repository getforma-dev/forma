# Building and deploying a Forma server

Build the frontend before the Rust release binary. For the minimal native SSR
template, run `npm ci && npm run build:ssr` in `admin/`, then
`cargo build --release --locked` at the project root. The dashboard uses
`npm run build` for its explicit Browser routes. Commit both lockfiles.

The scaffold's GitHub Actions workflow caches npm downloads and Rust dependency
artifacts with `Swatinem/rust-cache`. Its cache key includes the Rust compiler,
Cargo manifests and lockfile, but does not include page source. Only the default
branch saves the cache; pull requests can read its existing cache. The frontend
build always runs, followed by Cargo's dependency validation and app-crate build.
The cache accelerates a build; it is never the deployable artifact.

Release builds use rust-embed: a page-only change changes the app crate's embedded
inputs and requires its recompilation and relinking. A warm dependency cache
avoids a cold dependency compile. Timing depends on the application and runner;
`cargo build --release --locked --timings` records the actual work. Deploy the
resulting binary atomically, together with any application-owned external data.
Development already rereads pages from disk and does not need this release cache
strategy to avoid rebuilding on page edits (FORMA-166).

## Release FMIR loaded from disk: deferred

FORMA-262 evaluated loading release FMIR and assets from a directory on startup.
It could avoid relinking after a page-only edit, but a directory is a second
release artifact. Matching only a build ID is insufficient if the files can be
changed after validation. A supported mode would need an authenticated manifest
covering every module and asset, immutable bytes pinned after validation, an
atomic versioned-directory swap, and refusal of missing, corrupt or skewed files
before opening the listener. Rolling back must select a matching binary and
asset set together. It must also meet the existing N8 startup and size gates.

Decision: defer the mode. Keep the single embedded artifact as the supported
release default and ship CI dependency caching now. There is no new disk-loading
API or production behavior in this change. A future implementation requires its
own design and qualification ticket; debug-mode loading is not a production
integrity contract.

The cold/warm workflow measures the immutable published 3.0.0 templates, downloaded
and checked against the coordinated registry checksums by the existing published
scaffold verifier. Source template locks are unsealed seeds and cannot be built
with `--locked` directly. Candidate packaging and the shipped workflow inventory
remain covered by their separate CI lanes. Each measurement records the baseline
version and the commit containing the cache setup; this is cache evidence, not a
claim about the performance of unpublished framework changes.
