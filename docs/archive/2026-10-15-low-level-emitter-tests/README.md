# Low-level emitter tests before declared island metadata

Exact original tests and their standalone source fixture are preserved here. Active low-level tests now attach declared schemas and contracts, retain ordered/repeated inputs rather than filtering names, and account for section 10 in contiguous offsets.

The standalone source fixture previously referenced undeclared `panelClass`, `tone`, `rows`, `formatUptime` and `formatLatency`. Its active replacement declares actual local defaults and closed computations. This is an explicit source migration; the archive retains the unsupported original. The tests still assert real pipeline structure, distinct slot identities, static expansion, ordered input metadata and binary bounds.

The original SSR placeholder-text control is also preserved. Its active form now asserts BUILD-610 at the original sub-component source, retaining the explanatory signal warning.

The following mandatory-text-refusal migration also preserves the exact post-ac807 walker/emission tests. Eleven generic text/marker cases now use closed scalar arrows (the actual signal-call case declares its signal). The lexical-scope case refuses the out-of-scope read and separately verifies that removing it preserves the sub-component's local default. No source catalogue or compiler behavior is changed in this test checkpoint.
