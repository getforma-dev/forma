# Named composition-canvas size reference

Measured 2026-10-28 from source `166cec8741462a5ebc4449c4fd553af482a978bd`,
using fresh workspace builds of core/compiler/build (package versions 3.2.0),
Node 24.22.0, esbuild 0.28.1 and macOS arm64. This is a source-checkout
measurement, not a new registry or release qualification.

| Measurement | Bytes, gzip level 9 | Policy |
|---|---:|---|
| Estimated Forma share | 28,024 | Warning 25,578; error 28,420 |
| Application share | 897 | Included in total JavaScript |
| Entry JavaScript | 28,921 | Forma + application shares |
| Generated service worker | 1,451 | Included in total JavaScript |
| Total route JavaScript | 30,372 | Error 76,800 |

The route has 396 B of Forma headroom under its existing error ceiling. Its
standard warning is retained. There is no application override or larger canvas
ceiling: the route uses ordinary native `islands` policy under
`FORMA_SIZE_POLICY=framework`.

The producer copies the named fixture's `app.tsx` and `page.tsx` byte-for-byte
into a clean single-route consumer wrapper. It links canonical workspace package
roots, so the production bundler attributes core and alien-signals correctly;
no framework code is copied into application files. All four card renderers are
present. The emitted **4,754 B FMIR equals the committed named fixture byte for
byte**, with zero compiler diagnostics. It is not the historical 4,752 B spike.

The wrapper has no CSS, optional router or client-side data bootstrap. Request
props/serialized island state and rendered HTML are not JavaScript payload.
Forma gzip is the build's estimate from raw metafile contributions plus the
identity banner, apportioned over the compressed entry; it is not a separately
compressed framework archive. [The raw size report](size-report.json) preserves
both compression formats, default/effective policy and warning status.
[The measurement receipt](measurement.json) records input hashes, package
product inventories, toolchain, wrapper configuration and output hashes.

Reproduce from the repository root with the pinned Node toolchain and installed
lockfile dependencies:

```sh
npm run build -w packages/compiler
npm run build -w packages/build
npm run build -w packages/core
node packages/compiler/scripts/measure-composition-canvas.mjs /new/evidence/directory
```

The [producer](../../../packages/compiler/scripts/measure-composition-canvas.mjs)
refuses to overwrite evidence, requires unchanged production sources, checks
strict native admission and exact frozen FMIR, and removes its temporary wrapper.
This JavaScript size wrapper has no Cargo lock; the build reports that Rust
compatibility remains a startup check. It does not repeat Rust rendering,
browser conformance or full GenUI component-library acceptance. Those remain
separate evidence and consumer responsibilities.
