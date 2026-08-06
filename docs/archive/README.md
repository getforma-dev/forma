# Archive — `forma`

Nothing here is current. Everything here was once believed, published, or
relied on, and is kept so that a reader who meets a stale claim in the wild can
find out what replaced it and why.

**How to use this file.** Each entry says *what* the material was, *when* it
was retired, and *why*. Files that were removed from circulation are stored in
this directory next to this index. Where the material was a claim inside a live
document rather than a whole file, the entry records the claim and its
correction — there is no file to keep, but the history is the point.

**How to add an entry.** Never delete a superseded document. Move it here,
prefix the filename with the retirement date (`YYYY-MM-DD-`), and add a row
below. If you corrected a false claim instead of retiring a document, add a row
anyway: the next person to write that sentence should be able to find out why
it was wrong the first time.

---

## Retired documents

*(none yet — this directory was created 2026-08-05 with the docs restructure)*

## Retired and corrected claims

| Claim | Where it lived | Retired | Why |
|---|---|---|---|
| `CONTRIBUTING.md` described setup and PR mechanics only, and named no standard for tests or docs | `CONTRIBUTING.md` | 2026-08-05 | Superseded, not deleted: the file was rewritten to point at [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and [`docs/TESTING.md`](../TESTING.md) and to state the citation contract. The mechanics it carried are all still in the new file. |
| The root `README.md` was the only narrative documentation for the whole server framework, and the pipeline diagram in it was the only place the stack was explained | `README.md` | 2026-08-05 | The design rationale now lives in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and the binary contract in [`docs/FMIR-FORMAT.md`](../FMIR-FORMAT.md), both written 2026-08-05. The README keeps the four questions a README should answer and delegates the rest. |

## Retirements in the other repos

The other three repos keep their own archive index, because the material and
the reasons are local to them:

- `formajs/docs/archive/` — the monolithic README's narrative sections and the
  completed hardening audit
- `forma-tools/docs/archive/`
- `create-forma-app/docs/archive/`
