## [Unreleased]

### The repository merge (FORMA-113)

formajs, forma-tools and create-forma-app were merged into this repository
with their histories: `@getforma/core` is `packages/core`, `@getforma/compiler`
and `@getforma/build` are `packages/compiler` and `packages/build`,
`@getforma/create-app` is `packages/create-app`, beside the crates in
`crates/`. Their tags carry the prefixes `formajs/`, `forma-tools/` and
`create-forma-app/`. A root npm workspace and the root Cargo workspace (now
with `forma-ir-derive`, whose published 0.0.0 placeholder is its source) are
built and tested by one command, `npm run check`, which one CI workflow runs.
Package names and versions did not change; nothing here is a release.

