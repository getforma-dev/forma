# Contributing to create-forma-app

## Before your first PR

Read the
[stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md),
then [`docs/TEMPLATES.md`](docs/TEMPLATES.md). This repo is the front door: the
templates are the first Forma code most people read, so what they demonstrate
is a claim about the whole stack.

## Setup

```bash
git clone https://github.com/getforma-dev/create-forma-app.git
cd create-forma-app
npm ci
npm test        # `pretest` builds the CLI first — the tests run dist/index.js
npx tsc --noEmit
```

## The gates

`npm test` is the structural half: it parses the templates (JSON, TOML-ish,
file inventories) and checks the CLI's behaviour against a scaffolded temp
directory. It is fast and needs no network.

The real gate is opt-in, because it needs a network and a Rust toolchain:

```bash
FORMA_SCAFFOLD_E2E=1 npx vitest run
```

That scaffolds each template into a temp directory, installs from the
template's lockfile with `npm ci`, builds the frontend, runs
`cargo check --locked`, then starts each compiled server and reads its
responses: the minimal template must serve real server-rendered markup after
`build:ssr`, the dashboard must serve each page as its declared browser shell
whose CSP nonce matches the script tag, and every page of both must answer
`Cache-Control: no-store` with a fresh nonce on each fetch, register no service
worker, and leave `/sw.js` to forma-server's retiring worker. It also runs
`npm audit signatures` over each template's install, fails on any
`use of deprecated` warning from the template's Rust, checks that a
construct the server cannot render fails the minimal template's strict build,
and that the minimal server refuses to start on a truncated module and
answers a failed render with its own 500, carrying neither the error nor an
empty shell. If you change a template's dependencies,
regenerate its lockfiles as
[`docs/TEMPLATES.md`](docs/TEMPLATES.md#regenerating-a-templates-lockfiles)
describes. CI runs it on Linux and Windows, and again before
`npm publish`. It is a separate job on purpose — see the "no self-skipping
tests" rule in the [testing
policy](https://github.com/getforma-dev/forma/blob/main/docs/TESTING.md).

The release workflow has its own check, which CI's `release-workflow` job
runs after actionlint:

```bash
ruby scripts/check-release-workflow.rb --self-test   # SR43: only the publish job holds id-token: write
bash scripts/test-release-artifacts.sh               # a packed file altered between jobs is refused
```

**Skipped checks that are by design.** On a pull request or a push, `scaffold`
is the one CI job that can show "skipped", and only two ways: it needs `test`,
so a red `test` skips it; and it needs `preflight` to find every `@getforma`
pin in `templates/` on npm, so a change whose pins name versions not yet
published skips it, with a warning naming each missing pin and what was not
verified. That is a release in progress, packages first; re-run CI once they
publish. `release.yml`, which runs only for a release tag, makes the same check
a hard failure; `update-core-dep.yml` runs only on a `core-release` dispatch. A
job skipped for any other reason is a defect in the workflow (FORMA-179).

## Tests

The standard is that
[testing policy](https://github.com/getforma-dev/forma/blob/main/docs/TESTING.md).
What it means here in practice:

- **Parse, don't grep.** A previous suite asserted that `main.rs` "contains
  127.0.0.1", which a commented-out line satisfies just as well as a bind call.
  The helpers in `tests/templates.test.ts` strip comments and read structure.
- **Anything true of one template is true of all of them.** Template
  assertions live in `describe.each(TEMPLATES)`, so a new template inherits
  every requirement the moment its directory exists — never copy an assertion
  into one template's block.
- **Documentation is under test.** The dashboard's documented API routes must
  equal its routed ones; its README's Playwright count must equal the number of
  `test(` blocks; a template description may not name a feature the template
  lacks or a number no test checks. That is deliberate: user-facing prose here
  is a claim about software, so it is testable, so it is tested.
- **Break it and watch it go red.** State the mutation in the PR description.

Cite the test that proves a claim, in the convention the code already uses:

```ts
// Verified by: tests/templates.test.ts > "binds to loopback and never to a wildcard address"
```

## Documentation

- A **template README ships to the user** who scaffolded it. It answers: what
  is this, how do I run it, what is unsafe about deploying it as-is, how do I
  put my own data in.
- **Contributor-facing rationale goes in [`docs/`](docs/)**, not into a
  template README.
- Do not copy a number between documents without re-running the thing that
  produces it, and say when a measurement was taken — the compiler and the
  runtime the templates install are published packages that move independently
  of this repo.
- Superseded documents move to [`docs/archive/`](docs/archive/) with an index
  entry saying what, when and why. Nothing is deleted.

## Pull requests

1. Branch from `main`.
2. Add tests that would fail without your change.
3. `npm test` and `npx tsc --noEmit` clean; run the E2E gate if you touched a
   template or the scaffolder's file handling.
4. Update `CHANGELOG.md`, and any document your change makes untrue.
5. State the mutation probe you ran against your new tests.
