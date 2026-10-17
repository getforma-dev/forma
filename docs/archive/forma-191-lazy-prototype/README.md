# Lazy native prototype originals and first outcomes

These files preserve the real earlier sources, plans and outcomes; historical
plans describe their own stopping point and are not current qualification claims.
The final scoped result is in `../../evidence/forma-191-lazy-prototype/README.md`.

- `original-source/` is byte-exact Git source from
  `cf869f8302ea0a07d144f39b808a8452485df970` for the runtime, real-browser
  regression suite and native fixture selector/documentation.
- `finite-snapshot/` preserves all 26 files and the original `FINITE-MANIFEST.json`
  unchanged, including both genuine eager-cache failures and the separate initial
  Happy DOM option-default test assumption. The corrected identical controls
  produced 49 intended failures against the original runtime and 51 passes
  against the lazy runtime. It also retains the 170-case success and type checks.
- `product-gate-first/` contains the successful core build, five size caps, typed
  SSR products and debug fauth binary, then a configuration-loader failure before
  any browser test. Its complete 80-file core and 323-file compiler/build/typed
  artifact hash inventories remain here; binary products are not embedded.
- `product-browser-corrected/` preserves the second, distinct configuration-loader
  failure before browser tests. The original `.ts` and byte-identical `.mts`
  wrappers are preserved under `wrappers/`.
- `product-browser-cjs/` preserves the first actual fauth browser invocation:
  40 passed, 1 WebKit failure, and 10 serially unexecuted tests. The unchanged
  browser-error assertion rejected the debug server's endpointless Report-Only
  Trusted Types warning. That attempt did not capture full response headers;
  later actual captures are separately recorded in the final evidence.
- `wrappers/` retains the executed orchestration sources, including the corrected
  CommonJS wrapper. Each raw attempt includes its copied, identity-aware launcher
  and cleanup result. Nothing here is reclassified as an acceptance pass.

`SHA256.json` inventories every file here except itself. Original logs and source
bytes have not been rewritten or newline-normalized. No timing gate is closed by
this archive.
