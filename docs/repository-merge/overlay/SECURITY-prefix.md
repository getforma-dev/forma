# Security Policy

This repository holds the whole Forma Stack since the repository merge
(FORMA-113). Each half keeps its own policy, because their trust boundaries
differ:

| Part | Policy |
|---|---|
| The crates (`forma-ir`, `forma-ir-derive`, `forma-server`) | The rest of this file |
| `@getforma/core` (`packages/core`) | [`packages/core/SECURITY.md`](packages/core/SECURITY.md), with [`packages/core/CSP.md`](packages/core/CSP.md) |
| `@getforma/compiler`, `@getforma/build`, `@getforma/create-app` | No policy of their own; report as below |

Report a vulnerability in any part as the next section says.

