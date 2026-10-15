# Maintaining source templates

Both templates use the current typed Pages API. Minimal declares a numeric
count in TypeScript and Rust, binds its handle and finalizes before listening.
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
