# FORMA-189 source qualification

Source: e48aae32 (contains independently reviewed 90ec51de toolchain policy and
the reviewed standalone formatter-lock correction). All three fresh resolutions
started with only `version = 3`, resolved88 packages from current registry metadata,
and compiled every target of the named crate at its manifest floor:

- forma-ir: Rust1.71, build6.39s.
- forma-ir-derive: Rust1.71, build1.55s.
- forma-server: Rust1.85, build11.69s.

The logs include resolver decisions and native compiler output. Fresh locks and
source commits are retained; the candidate lock stayed unchanged in all three.
`manifest.json` authenticates these original bytes. Absolute scratch paths in raw
logs record this machine and are not used by the implementation.

The actual public GitHub preflight downloaded the alpha.2 DS12 and verified digest
24609247c729506cd304ae922ef04d0f4fa0a4fdf2b82726e1eee997b325a006.
It recognized a prerelease history, with no invented maintenance end date. No tag,
registry publication, live recall, support deadline or maintenance drill was created.

Twenty finite support/history/record/toolchain tests passed, including malformed
omitted inventory, exact calendar boundaries and seeded workflow drift. The release
workflow checker rejected33 seeded workflow violations and13 contract violations;
its91 helper tests passed after the known standalone formatter lock repair.
Actionlint1.7.12 passed both changed workflows. These local checks do not replace
exact-head independent review, integrated CI or the future final-publication event.
