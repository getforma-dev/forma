# create-forma-app documentation

Contributor-facing material. If you have just scaffolded a project, the README
inside it is the document you want — these pages are about the scaffolder and
its templates.

| Document | What it answers |
|---|---|
| [Stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md) | What the four repos are, how the pipeline fits together, and why. Read before your first PR. |
| [TEMPLATES.md](TEMPLATES.md) | What a template is, what the scaffolder rewrites, what every template must do, and how to add one |
| [RENDERING-PHASES.md](RENDERING-PHASES.md) | Phase 1 vs Phase 2: the rule that decides which one a template can have, and why the dashboard is client-rendered on purpose |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Setup, the gates, and what a reviewer will ask |
| [Testing policy](https://github.com/getforma-dev/forma/blob/main/docs/TESTING.md) | The eight rules, the reviewer's checklist, the `Verified by:` contract |
| [archive/](archive/) | What has been retired from this repo's documentation, when, and why |

## What this repo ships

`npx @getforma/create-app my-app` copies a template, substitutes the project
name, and leaves a project that builds with `npm ci && npm run build` in
`admin/` and runs with `cargo run`. That is the whole product surface: a CLI of
about 240 lines, a side-effect-free library half that the tests can import
without starting a prompt, and two templates.

The templates are the real deliverable. They are the first Forma code most
people read, so what they demonstrate is a claim about the stack — which is why
`tests/templates.test.ts` checks the templates against their own documentation
rather than only against a schema.
