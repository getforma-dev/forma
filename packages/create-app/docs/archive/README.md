# Archive — `create-forma-app`

Nothing here is current. Everything here was once published or relied on, and
is kept so a reader who meets a stale claim can find out what replaced it and
why.

**How to add an entry.** Never delete a superseded document: move it into this
directory with a `YYYY-MM-DD-` prefix and add a row below. If you corrected a
false claim inside a live document (or a user-facing string) instead of
retiring a whole file, still add a row.

---

## Retired documents

*(none yet — this directory was created 2026-08-05 with the docs restructure)*

## Retired and corrected claims

| Claim | Where it lived | Retired | Why |
|---|---|---|---|
| "Live dashboard **with islands**, API routes, dark theme — full showcase" | `src/scaffold.ts` `TEMPLATE_INFO.dashboard`, shown in the interactive picker; duplicated verbatim in the `--help` text in `src/index.ts` | 2026-08-05 | False. Neither template calls `activateIslands`; the dashboard is a client-mounted app (`RenderMode::Phase1ClientMount`). Replaced with a description of what it actually is, and the `--help` text now renders from `TEMPLATE_INFO` so the two cannot drift apart again. A test now fails if a description names a feature the template does not have, or a number no test checks. |
| The repo had no `CONTRIBUTING.md` and no `docs/`; the reasoning behind the dashboard's rendering mode lived only in the template README that ships to users | repo root, `templates/dashboard/README.md` | 2026-08-05 | Contributor-facing rationale now lives in [`../RENDERING-PHASES.md`](../RENDERING-PHASES.md) and [`../TEMPLATES.md`](../TEMPLATES.md). The template README keeps the short version, because a user who just scaffolded a project does need to know why their page is client-rendered. |

## Notes on material that is *not* archived

- **`templates/dashboard/README.md`'s "Phase 1 by design" section** stays in the
  template. It is the answer to the first question a user has about the project
  they just created, and the measurement it quotes was taken against that
  template as shipped. `docs/RENDERING-PHASES.md` covers the same rule as
  mechanism, for whoever writes the *next* template, and flags that the
  measurement is version-bound.
- **`CHANGELOG.md`** is the record of what changed and when; this archive is for
  material that was wrong or superseded, which is a different question.
