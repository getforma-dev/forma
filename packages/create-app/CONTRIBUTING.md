# Contributing to create-forma-app

## Before your first PR

Read the
[stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE-3.0.md),
then [`docs/TEMPLATES.md`](docs/TEMPLATES.md). This package is the front door: the
templates are the first Forma code most people read, so what they demonstrate
is a claim about the whole stack.

## Setup

Use the repository's `.node-version` for workspace commands and Rust 1.85 or
newer for the scaffold checks. From a clean clone:

```bash
git clone https://github.com/getforma-dev/forma.git
cd forma
npm ci --ignore-scripts
npm run build
npm test -w packages/create-app
npx tsc --noEmit -p packages/create-app
```

The package's test script explicitly builds the CLI before testing its output.
Published consumers require Node 22 or newer; workspace development uses the
separately pinned toolchain.

## The gates

The structural suite checks the CLI, template contracts and generated files.
The full scaffold gate installs and serves the actual packed seven-package
candidate on Linux and Windows. It verifies typed SSR, explicit Browser pages,
response policy, declared island activation and static-route network behavior.
Use the [candidate workflow](README.md#development) from the repository root;
it records archive identities and restores the source lock seeds after packing.
A direct source-template copy is not a substitute for that packed candidate.

The published registry lane separately exercises a complete published set.
Missing or skipped required candidate checks fail release qualification; an
unpublished candidate does not receive credit from skipped registry work.
See [the release runbook](../../docs/RELEASING.md) and
[template lock seeds and sealed packages](docs/TEMPLATES.md#source-lock-seeds-and-sealed-packages).
Do not regenerate template locks against an arbitrary fresh dependency graph.

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
- Tie measured numbers to their exact source and artifacts. Identify historical
  results as historical; new measurements require their actual producer.
- Preserve superseded technical records and test evidence. Use the
  [root documentation policy](../../CONTRIBUTING.md#documentation) to distinguish
  public records from preserved internal work boards and session handoffs.

## Pull requests

1. Branch from `main`.
2. Add tests that would fail without your change.
3. `npm test` and `npx tsc --noEmit` clean; run the E2E gate if you touched a
   template or the scaffolder's file handling.
4. Update `CHANGELOG.md`, and any document your change makes untrue.
5. State the mutation probe you ran against your new tests.
