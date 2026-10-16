# Core test JSX configuration: Vite7 repair

These original configs are byte-identical to `09df01e0f52dc42b2f45010e90d7d214188b6591`. The manifest authenticates each original, the first hosted CI log retained under the task work directory, and local before/after logs. The archive is protected from checkout newline conversion.

The locked toolchain is Vitest4.1.12/Vite7.3.6/esbuild0.28.1. Both core configs used the unsupported Vite8 `oxc` property. The full package typecheck reproduces CI run38853346808's TS2769 in the benchmark config. The ordinary test config was not previously in the package typecheck's explicit file list.

The repair uses Vite7's documented `esbuild` transform options: classic JSX, `h`, `Fragment`, and development instrumentation disabled. It includes every `vitest*.config.ts` in the existing full package typecheck, including future derived runtime-mutation configurations. No dependency or type escape changed. Reference: [Vite7 shared esbuild options](https://v7.vite.dev/config/shared-options#esbuild).

The actual Vite control uses each original config with a temporary TSX fixture whose local tsconfig deliberately selects `WrongFactory`/`WrongFragment`. This prevents the package tsconfig from hiding an ignored option. Both original transforms fail by emitting those wrong names. Both repaired transforms execute the expected nested `h`/`Fragment` tree. The archived runner is the exact task-work-directory script used; its relative Vite import reflects that location. It starts middleware-mode servers with file watching/HMR disabled and closes them and removes the fixture in `finally`.

After the repair, `npm run typecheck -w packages/core`, both Vite transformation controls, and21 existing JSX/build-config tests pass using Node24.22.0 and Vitest `--maxWorkers=2`. This is configuration correctness evidence, not a benchmark measurement or a new full workspace qualification. Refreshed hosted CI remains required.
