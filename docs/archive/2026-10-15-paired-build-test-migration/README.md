# Build tests before immutable watch publication and mandatory refusal

Original tests and hashes are preserved. Watch readers now follow the manifest's committed alias and verify old accepted files remain unchanged. Strict-mode tests distinguish advisory diagnostics from mandatory BUILD-610 refusals, retain the all-pages JSON report contract, and exercise failed-build output preservation.
