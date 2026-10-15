# SSR e2e lane before the 3.0.0 entry contract, 2026-10-15

These files preserve the SSR e2e lane (`e2e/ssr/`) exactly as it was at
`385a17f`, the last base before FORMA-105's entry policy reached it. The
lane last ran green at `3c34b9e` (FORMA-103's E2E migration, 03:23 EDT); the
compiler's entry policy (`861228d`, `BUILD-611`) and core's strict activation
(FORMA-104) landed after it, and CI reached the lane again only once the size
gate was passed. `manifest.json` records every original SHA-256 and length.
They are historical assertions, not active product promises.

| Original assertion | Current control |
| --- | --- |
| Entries chose at run time: `if (document.querySelector('[data-forma-island]')) activateIslands(...) else mount(...)`. | `BUILD-611` refuses a nested mount: the compiler cannot delete a mount inside a branch without guessing. Every entry is a standalone literal registry and a standalone top-level `mount()`, the shape `packages/create-app`'s templates ship (FORMA-144). |
| A whole page was adopted by `mount()` on `#app[data-forma-ssr]`; "activated" meant `data-forma-ssr` removed. | `mount()` refuses a server-marked root (`FORMA_E_MOUNT_SSR`); a page activates only its islands (DR-6). `title`, `select`, `textarea-child`, `textarea-value` and `edited-controls` declare their interactive subtree as an island seeded from declared props; what each pinned before JavaScript, after activation and client-rendered is kept. |
| `root-fragment`: a root Fragment adopted as the range of its children (FORMA-003), its button live after activation. | A page with no island is static: the walker renders the Fragment's children, no script is referenced or requested, the button is inert; client-rendered the button works. Whole-page adoption no longer exists to pin; the surviving browser half of DR-7(a), Fragment-range adoption through the public facade, is pinned by `packages/core/src/dom/__tests__/hydrate-fragment.test.ts`. |
| Phase 1 (`csr.html`) was the `/` route's bundle on an empty `#app`, the manifest's route forced to Browser mode by the renderer. | The `/` route's product has no mount. Each case is also built as an explicit Browser route `/csr` (`ssr: false`) of the same entry, which keeps the mount; the renderer renders that route from the real manifest. |
| Activation observed as `data-forma-status="active"` on every island. | Strict activation (FORMA-104) makes no DOM write on success; `pending` is not evidence of failure (`packages/core/docs/ISLANDS.md`). The spec waits for the module to run, requires no host in `error` and no `forma:error` event; since a module that loads and does nothing also passes that, each behaviour test exercises the island through a reactive reader its signal drives (`edited-controls` echoes each seeded signal into text). |

No production source, diagnostic contract or compiler rule was changed; the
lane now tests the contract the diagnostics document.
