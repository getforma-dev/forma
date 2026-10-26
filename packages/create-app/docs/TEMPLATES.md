# Maintaining source templates

All three templates use the current typed Pages API. Minimal declares a numeric
count in TypeScript and Rust, binds its home and empty-props About handles,
and finalizes before listening. Only Counter is registered for activation;
About has no islands and its native build publishes no JavaScript.
Dashboard explicitly remains browser-rendered. Native-router opts into typed native navigation with a persistent shell and two route owners. Preserve the PageResponse
boundary, strict compiler diagnostics, worker-off default, consumer MSRV and
scripts-off npm policy when changing a template.

## Source lock seeds and sealed packages

`template-lock-seeds.json` identifies exactly `minimal`, `dashboard` and `native-router` at the
coordinated source version. Their source locks retain all external registry
checksums. Only the known Forma runtime package entries omit checksums: a
commit cannot include the checksum of the archive containing that commit.
The marker is outside the distributed `templates/` tree and is never packed.

Use `scripts/release-set.mjs version <version>` from the repository root to
prepare development, alpha, beta or stable versions. It validates all three seeds
before producing changes, keeps exact internal requirements coordinated and
preserves external records. Do not delete locks or resolve a fresh graph to
make an unpublished candidate install.

The release packer creates all seven runtime archives, reads their actual
metadata and hashes, and seals all three template locks before packing create-app.
It never substitutes Rust source. All fifteen source files restore on success or
failure. Packed/installed lock validation remains strict: missing hashes,
mixed versions and mismatched internal metadata refuse before installation.
External runtime additions, when needed, come from the reviewed workspace
lock rather than a fresh registry resolution. Stable shipped npm and Cargo
requirements use `^X.Y.Z`; prereleases keep `=X.Y.Z-beta.N` (or alpha/rc).
Source seeds remain exact in every version. These manifest ranges do not
relax the shipped locks' exact candidate versions and archive hashes.

The candidate scaffold gate consumes the actual eight-archive set. A direct
copy of a source seed is not an installable unpublished candidate. Published
consumer projects receive sealed locks and use `npm ci` / `cargo --locked`.

Verified by: `tests/templates.test.ts` > "keeps direct npm resolutions and authenticates candidate runtime copies against the workspace lock"
The repository's `scripts/template-lock-seeds.test.mjs` and
`scripts/release-template-source.test.mjs` cover preparation, hash boundaries,
unchanged Rust source and restoration. Historical template guidance is in
[the migration archive](../../../docs/archive/2026-10-15-template-slice1/README.md).

## Recorded dependency qualification

The historical FORMA-165 gate required one physical esbuild copy. The 3.0 template
preserves the old external resolution `node_modules/esbuild@0.28.2` and the
current recorded build closure at
`node_modules/@getforma/build/node_modules/esbuild@0.28.1`. The minimal lock
also records an optional compiler-local 0.28.1 peer copy; npm may omit it when
the top-level peer already satisfies the compiler. This changes the earlier
single-copy guarantee. The scaffold gate requires every installed copy to
match a recorded location/version and every required recorded copy to exist;
its report records the actual inventory and optional omissions. No external
pin is upgraded to force deduplication.

## Retained dependency decision

Keep the two reviewed template esbuild resolutions for 3.0: the direct
0.28.2 and the candidate build closure's 0.28.1. Both satisfy the declared
`^0.28.1` requirement. Rewriting the template's existing external lock or
changing the production bundler solely to remove a duplicate would change
the artifacts being qualified. The installed-copy inventory remains a gate,
including any optional compiler peer omission; a third unrecorded copy fails.
This is an explicit retention decision, not a claim of template deduplication.
The workspace's development graph separately resolves one esbuild 0.28.1
under its existing override, including tsup; the vulnerable stale 0.27.7 copy
is removed without upgrading to tsup 9.

All template frontend manifests require Node 22, matching the public packages;
Rust stays 1.85. The dashboard uses its installed Tailwind CLI. Source locks
retain the documented Tailwind watcher advisory; the workspace audit result
does not describe that separate graph. Scripts remain off and every scaffold
install still checks registry signatures. See
[the migration guide](UPGRADING-3.0.md) for the consumer changes.

## Native template source and qualification

Home passes its declared count to a unary Counter with component-local state.
The native handler starts at 7; an explicit Browser build starts at 0. The
compiler removes the authenticated native page mount and injects Counter's
exact schema/binding metadata. About's empty-props page has no registered
islands; its native manifest retains its IR and stylesheet with empty JS.
Dashboard remains explicitly Browser.

The combined source mount is a compile-time native selector, not a permitted
whole-page SSR hydration call. Do not wrap it in an SSR runtime conditional,
use its return, or add a second root: unsupported entry shapes refuse.

The actual emitted source tests are in `tests/template-islands.test.ts`.
Packed acceptance checks the integrated strict adopter, actual handler
7 → activation → increment 8/reset 0, zero adoption writes and a real static
navigation with no script/worker requests. These controls shipped with the
qualified 3.0.0 set and must pass again for a new candidate. Preserve the earlier
raw-HTTP-only reports as historical evidence; they do not prove these claims.

## Optional native router starter

`native-router` alone declares `@getforma/router` and enables the `forma-server`
`navigation` feature. Its exact source seeds omit only internal archive checksums;
sealing reads the real candidate router archive and preserves the Rust feature.
Minimal and dashboard retain their existing dependency graphs. The native starter
serves ordinary HTML without JavaScript and enhances same-group links through typed
owner responses; the shell island persists while the leaf owner changes.

Candidate qualification requires its locked install/build, consumer MSRV, unlocked
update compatibility and fresh-nonce/no-store checks alongside the original cases.
The actual release server is exercised in Chromium, Firefox and WebKit for native
navigation, retained shell state, Back/Forward and no-JavaScript links. Linux N8
requires a third measured row at the unchanged 3 MB / 100 ms limits. Historical
seven-package 3.0/3.1 records still select only their two shipped templates and
nineteen heavy cases; current router candidates require all three and twenty-four.

Verified by: `scripts/template-lock-seeds.test.mjs`,
`scripts/release-template-lock.test.mjs`, `scripts/candidate-scaffold.test.mjs`,
`scripts/n8-size-start.test.mjs` and the native-router case in
`tests/scaffold.test.ts`.
