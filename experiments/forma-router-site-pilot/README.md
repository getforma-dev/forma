# Local getforma.dev portal pilot

This bounded FORMA-301 pilot uses the real `/project/` and `/releases/` pages from
website revision `919af5872b3a48fa43d12ce1bf4ceedad37dcdfd`. It tests the optional
HTML adapter with actual packed core/router archives. It does not change the
private website checkout, deploy to OVH, migrate the website, or qualify its
Rust/native server. Candidate archive versions retain the source version 3.1.0;
that does not mean the router package has been published.

The public files here are the harness and aggregate observations. The private
source archive, build output, installed dependencies and detailed build logs
stay under ignored `.local*` directories.

## Boundary and lifecycle

Preparation archives the exact site commit into an isolated directory and builds
its unchanged static site for rollback. A source override adds region markers
around the existing portal body. The pilot replaces the application navigator
with `navigation.js`, which connects `createHtmlAdapter` to the site's existing
`mountPortalPage` and search-close callbacks. Only the two registered paths gain
framework navigation. The header, search dialog, Pagefind index and theme controls
are the actual site components. Each departing page aborts its feature lifetime
before replacement; each admitted page mounts once.

The site intentionally generates versioned API documentation from installed
3.0.0 package declarations. A trial global core replacement correctly failed
that build guard. Preparation therefore leaves the site's documentation and
build dependencies intact, installs candidate archives separately, and applies
source-level esbuild aliases to the portal runtime. It does not relabel old
documentation or remove the guard. The candidate portal shell and router resolve
the same packed core instance.

The registry is generated after HTML output, avoiding a hash cycle. It contains
whole-document SHA-256 digests and one build/assets compatibility identity.
Bootstrap fetches it with `no-store` and checks the initial document's build and
asset identities before creating a router. Only the verified region is admitted;
page scripts are never replayed. A stale bootstrap leaves normal links working.
Changed fetched bytes trigger a full document recovery.

## Reproduce

Use the repository's Node 24 toolchain and built core/router distributions:

```sh
npm run build -w packages/core
npm run build -w packages/router
node experiments/forma-router-site-pilot/prepare.mjs /absolute/path/to/getforma-site
node experiments/forma-router-site-pilot/browser.mjs /absolute/path/to/new-receipt.json
```

The preparation directory must be fresh. Preserve an earlier attempt by moving
`.local` to another ignored `.local-*` name before rerunning. Browser receipts are
never overwritten. The browser harness starts and stops its own ephemeral
loopback server; engines and scenarios run sequentially. A manual preview can
use `node experiments/forma-router-site-pilot/serve.mjs` and its printed URL.

Rollback atomically changes the local serving pointer to the original build.
The browser gate authenticates the served original portal bundle by SHA-256,
checks the mismatch causes a fresh document, and proves the original site
navigator works again. The original site already has application navigation:
rollback restores that behavior. Homepage and native-lab destinations remain
document boundaries. No production control endpoint or deployment is introduced.

## Observations

`evidence/browser-three-engine-final.json` records six scenarios in each of
Chromium, Firefox and WebKit: real page/search/lifecycle retention, modified
HTML refusal, initial build mismatch, original-build rollback, bounded route
and native-lab document boundaries, and no-JavaScript links. In each positive
sequence, five mounts have four matching disposals, the search returns twelve
real results, and navigation requests no additional executable code.

`evidence/size-observation.json` records the complete portal bundle comparison:
13,491 bytes gzip-9 for the unchanged original and 20,382 for the candidate, a
6,891-byte increase. This includes different core versions and replacement of
the old application navigator; it is an application observation, not the
framework's router-only size gate or release qualification.

`evidence/attempts.json` preserves the rejected preparation and harness attempts.
The final test corrects the lab link to the site's actual `?count=7` URL. Its
native destination is the site's static-preview landing page; it does not prove
Rust rendering, production CSP, proxy headers, deployment, or native adoption.
The pilot updates the title through the adapter and retains the existing head;
broader page metadata updates and a production migration need a separate site
change and its normal verification/release workflow.
