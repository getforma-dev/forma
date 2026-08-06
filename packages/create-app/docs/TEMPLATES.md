# Template anatomy

**Audience:** contributors to this repo. If you are using a scaffolded project,
its own README is the document you want.

A template is a complete, runnable project stored under `templates/<name>/`.
The scaffolder copies it, rewrites a few placeholders, and gets out of the way
— there is no template language and no post-generation codemod.

## What the scaffolder does to a template

| Step | Rule | Where |
|---|---|---|
| Copy | Everything under `templates/<name>/`, except `node_modules`, `dist`, `target` and `.git` | `NEVER_COPY`, `src/scaffold.ts` |
| Substitute | `{{PROJECT_NAME}}` and `{{project-name}}` → the project name, in text files only (`.toml .rs .ts .tsx .json .md .css .html .yml`) | `replacePlaceholders`, `src/scaffold.ts` |
| Rename | every `_gitignore` → `.gitignore`, at any depth | `restoreGitignores`, `src/scaffold.ts` |

Three consequences worth knowing before you edit a template:

- **`_gitignore`, never `.gitignore`.** `npm pack` renames a real `.gitignore`
  to `.npmignore`, which would both lose the file and change what the published
  tarball contains.
  Verified by: `tests/templates.test.ts` > "uses no real .gitignore, which npm pack would rename to .npmignore"
- **No lockfile, no build output.** A committed `admin/package-lock.json` is
  how this repo once shipped five-month-old pins that could not build on
  Windows: `npm install` honours the lockfile and ignores the ranges in
  `package.json`.
  Verified by: `tests/templates.test.ts` > "ships no lockfile, no installed dependencies and no build output"
- **Symlinks are neither followed nor rewritten**, so a link planted in a
  template cannot make the substitution walk write outside the destination.
  Verified by: `tests/scaffold-lib.test.ts` > "does not write through a symlink that points outside the tree"

## Layout

```
templates/<name>/
├── Cargo.toml          crate named {{project-name}}
├── src/
│   ├── main.rs         Axum server: page routes, asset serving, CSP header
│   └── …               anything else the server needs (the dashboard has data.rs)
├── admin/
│   ├── package.json    frontend deps — ranges, no lockfile
│   ├── build.ts        @getforma/build pipeline
│   ├── tsconfig.json   jsx: react, jsxFactory: h, jsxFragmentFactory: Fragment
│   └── src/            the app
├── _gitignore          becomes .gitignore on scaffold
└── README.md           ships to the user — this is their first document
```

## What every template must do

These are enforced by `tests/templates.test.ts`, parameterised over every entry
in `TEMPLATES`, so a new template inherits all of them the moment its directory
appears.

| Requirement | Why |
|---|---|
| Bind `127.0.0.1`, never `0.0.0.0` | A scaffolded server with unauthenticated routes must not be reachable off-box by default. Widening is opt-in via `FORMA_HOST`, and warns. |
| Send the CSP that `render_page` generated (`page.csp`) | The nonce is per-request and only matches the HTML from that same call; a header built anywhere else cannot match. |
| Install a `tracing` subscriber | `render_page` degrades Phase 2 → Phase 1 through `tracing::warn!`. With no subscriber that warning is discarded, and a broken SSR build is indistinguishable from a working client-rendered one. |
| Declare exactly the crates its Rust sources use | An unused dependency is a slower build and a wider supply chain for nothing. This is what caught `forma-ir` surviving the dashboard's SSR removal. |
| Pin frontend deps at or above the version whose fix it needs | `@getforma/core ^1.5.0` (CSP-safe-by-default runtime, `on*` prop dropping, URL-scheme filtering), `@getforma/build ^0.1.9` (the Tailwind step could not run on Windows below it). |
| JSX-to-`h()` tsconfig | `jsx: "react"`, `jsxFactory: "h"`, `jsxFragmentFactory: "Fragment"`. |
| A `_gitignore` covering `target/ node_modules/ dist/ .env .env.* *.pem *.key`, and **not** `Cargo.lock` | `Cargo.lock` belongs in an application's history. |

## Adding a template

1. Create `templates/<name>/` with the layout above.
2. Add the name to `TEMPLATES` in `src/scaffold.ts`, and an entry in
   `TEMPLATE_INFO` describing it.
   **`TEMPLATE_INFO` is user-facing documentation** — the picker and `--help`
   both read it — so every feature you name must be one the template has, and
   every number must be one a test checks.
   Verified by: `tests/templates.test.ts` > "advertises only features the template actually has"
   Verified by: `tests/templates.test.ts` > "counts the pages and API routes it claims, and claims no number this test cannot check"
3. Decide the rendering mode deliberately — see
   [RENDERING-PHASES.md](RENDERING-PHASES.md) — and ask for it explicitly in
   `main.rs`.
4. Write the template README for the person who just scaffolded it: what it
   is, how to run it, what is unsafe about deploying it as-is, and how to
   replace the mock data. Keep contributor-facing rationale in this `docs/`
   directory instead; the template README ships to users.
5. Run `npm test`, then the real gate:
   `FORMA_SCAFFOLD_E2E=1 npx vitest run` — it scaffolds each template into a
   temp directory, installs, builds the frontend, runs `cargo check`, starts
   the compiled server and reads its response.
