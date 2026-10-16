# Maintaining source templates

Both templates use the current typed Pages API. Minimal declares a numeric
count in TypeScript and Rust, binds its home and empty-props About handles,
and finalizes before listening. Only Counter is registered for activation;
About has no islands and its native build publishes no JavaScript.
Dashboard explicitly remains browser-rendered. Preserve the PageResponse
boundary, strict compiler diagnostics, worker-off default, consumer MSRV and
scripts-off npm policy when changing either template.

## Source lock seeds and sealed packages

`template-lock-seeds.json` identifies exactly `minimal` and `dashboard` at the
coordinated source version. Their source locks retain all external registry
checksums. Only the known Forma runtime package entries omit checksums: a
commit cannot include the checksum of the archive containing that commit.
The marker is outside the distributed `templates/` tree and is never packed.

Use `scripts/release-set.mjs version <version>` from the repository root to
prepare development, alpha, beta or stable versions. It validates both seeds
before producing changes, keeps exact internal requirements coordinated and
preserves external records. Do not delete locks or resolve a fresh graph to
make an unpublished candidate install.

The release packer creates all six runtime archives, reads their actual
metadata and hashes, and seals both template locks before packing create-app.
It never substitutes Rust source. All ten source files restore on success or
failure. Packed/installed lock validation remains strict: missing hashes,
mixed versions and mismatched internal metadata refuse before installation.
External runtime additions, when needed, come from the reviewed workspace
lock rather than a fresh registry resolution.

The candidate scaffold gate consumes the actual seven-archive set. A direct
copy of a source seed is not an installable unpublished candidate. Published
consumer projects receive sealed locks and use `npm ci` / `cargo --locked`.

Verified by: `tests/templates.test.ts` > "keeps direct npm resolutions and authenticates candidate runtime copies against the workspace lock"
The repository's `scripts/template-lock-seeds.test.mjs` and
`scripts/release-template-source.test.mjs` cover preparation, hash boundaries,
unchanged Rust source and restoration. Historical template guidance is in
[the migration archive](../../../docs/archive/2026-10-15-template-slice1/README.md).

## Slice 1 qualification

The historical FORMA-165 gate required one physical esbuild copy. Slice 1
preserves the old external resolution `node_modules/esbuild@0.28.2` and the
current recorded build closure at
`node_modules/@getforma/build/node_modules/esbuild@0.28.1`. The minimal lock
also records an optional compiler-local 0.28.1 peer copy; npm may omit it when
the top-level peer already satisfies the compiler. This changes the earlier
single-copy guarantee. The scaffold gate requires every installed copy to
match a recorded location/version and every required recorded copy to exist;
its report records the actual inventory and optional omissions. No external
pin is upgraded to force deduplication. Final stable deduplication remains a
slice 3 decision, alongside the remaining template/release cleanup.

## Slice 2 source and qualification

Home passes its declared count to a unary Counter with component-local state.
The native handler starts at7; an explicit Browser build starts at0. The
compiler removes the authenticated native page mount and injects Counter's
exact schema/binding metadata. About's empty-props page has no registered
islands; its native manifest retains its IR and stylesheet with empty JS.
Dashboard remains explicitly Browser.

The combined source mount is a compile-time native selector, not a permitted
whole-page SSR hydration call. Do not wrap it in an SSR runtime conditional,
use its return, or add a second root: unsupported entry shapes refuse.

The actual emitted source tests are in `tests/template-islands.test.ts`.
Final slice2 acceptance additionally requires the integrated strict adopter,
actual packed handler7 → activation → increment8/reset0, zero adoption writes
and a real static navigation with no script/worker requests. Preserve slice1's
raw-HTTP-only reports as historical evidence; they do not prove these claims.
