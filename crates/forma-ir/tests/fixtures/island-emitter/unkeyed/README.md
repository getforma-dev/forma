# Unkeyed low-level controls

Byte-exact copies of the four paired fixtures as they were before FORMA-181 checkpoint A added
FMIR section `0x0006` (key paths) to every list the compiler proves. The originals are
authenticated in `docs/archive/2026-10-15-pre-keyed-rows/manifest.json`:

- `rows.ir`: SHA-256 `9dfc5904e67de0455c9a784215656fb2873272d0eeef6d8429a5fe97b114f67a`
- `local-inputs.ir`: SHA-256 `fecd5ccd1d9514637c2c3ab5503482a7788fabe4cc8f6924f0b14d38cfb15d85`
- `local-aggregates.ir`: SHA-256 `4ffd7ab6bbde9bb991266bc73656a716c5606220f654d7aefdbbc578640f5502`
- `aggregate-fallback.ir`: SHA-256 `c8d50a5c08b05a33579931613da42d05e183f2b5ef8185e58ad5384869dc1ce5`

A `LIST` without a section 6 entry remains a valid low-level reader form. `island_emitter.rs`
parses and renders these exactly as before: `local-aggregates` and `aggregate-fallback` keep
their scalar-key and scalar-row assertions here (the compiler no longer produces that shape from
source), and every keyed successor must render byte-identical state and byte-identical HTML
once its `data-forma-key` attributes are removed: since checkpoint B the walker writes the key
on each keyed row's root, and these unkeyed modules are the control that an unkeyed `LIST`
still renders exactly as before, with no key attribute. No compiler test regenerates these
files.
