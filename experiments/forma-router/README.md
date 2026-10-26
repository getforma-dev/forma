# FORMA-301 native feasibility experiment

This is an internal experiment on the published Forma 3.1.0 source baseline
`9a570afece5eb5091824422f00134a875310e857`. It is not a public router package,
a supported navigation wire version, or completion of FORMA-301.

The reviewed target lives in the design-doc-factory `forma-router` task. Its
105-question research map connects Angular, Astro and React Router findings to
57 acceptance scenarios. The chosen package boundary is optional
`@getforma/router` in this monorepo, coordinated with a future compatible minor.

## What is real here

- Two actual compiler-produced FMIR pages and different registered islands.
- A single compiled group bootstrap, generated manifest, build ID and SRI.
- Typed Rust `PageProps`, finalized page bindings and complete document responses.
- Experimental no-store page/action representations from those same bindings.
- Detached native claims validation and revocable adoption scopes.
- Browser navigation, retained static shell/input, history and real island input.
- Enhanced URL-encoded forms, CSRF checks, validation, 303-to-GET and revalidation.
- Negative controls for stale work, malformed admission and uncertain mutation.

The server uses public fixture data in an in-memory test store. Its reset/state
routes and fixed test session/CSRF setup must never be deployed as authentication.

## Reproduce

Use the repository's Node 24 version and Rust toolchain. Install the workspace
dependencies, build core/compiler/build normally, and install Playwright's three
browsers. From the repository root:

```sh
node experiments/forma-router/build.mjs
cargo build --manifest-path experiments/forma-router/server/Cargo.toml
```

Start from `experiments/forma-router/server`:

```sh
PORT=51216 ./target/debug/forma-router-native-proof
```

In another terminal at the repository root:

```sh
python3 experiments/forma-router/server/check_http.py http://127.0.0.1:51216 --output experiments/forma-router/server/evidence/http-local.json
node experiments/forma-router/browser-proof.mjs http://127.0.0.1:51216 experiments/forma-router/evidence/browser-local.json
```

The browser runner accepts `PROOF_ENGINES=chromium,firefox,webkit` and a
`PROOF_CASE` substring for diagnosis. Full runs use fresh browser contexts per
scenario, a 390×844 viewport, reduced motion, and separately disabled JavaScript.
Restart the server after every group build: its admitted manifest is loaded at
startup. The paths under `dist/` are generated; never patch their state or FMIR.

## Receipts and limits

`evidence/browser-first.json` retains the initial 44/45 result;
`webkit-cycle-diagnostic.json` identifies WebKit's history-write quota failure.
`browser-second.json` records 45/45 after pacing writes before live DOM disposal.
The final security-reviewed campaign and its Node 24 replay each passed 81/81; `browser-node24-final.json` and `security-node24-source-manifest.json` bind the repository-toolchain result to actual source/products. Failed runs remain alongside fixes.
The server evidence directory records HTTP, unit, build and Clippy results.

The static shell is not a general nested layout owner tree. The proof has private
source imports, a fixed route/endpoint set and a strict fragment profile. It does
not qualify the proposed browser/generated-HTML adapters, route matcher, packed
starter, complete metadata/style handling, production auth orchestration,
multipart uploads, all resource classes or performance budgets. The proposed
typed 404/error-page representation is not implemented in this HTTP 200 proof.

Current core size passes the unchanged default ceiling with only three gzip bytes
of headroom. Public entry points and production ownership changes must be measured
again. No existing package version, release inventory or performance budget is
changed by this experiment. No package or site deployment is authorized here.
