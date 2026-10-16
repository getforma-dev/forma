# Fixture tool lookup after the final dependency refresh

At source `697898c0732d55ef359e407c91e6c88c1e5028ab`, hosted CI38855398022/job116825593076 passed Rust, core types/tests and the earlier R17 stages, then failed because `e2e/sync-fixtures.sh` required a package-local esbuild executable that the refreshed lockfile hoists to the workspace root. The complete original job log and original script are retained byte-for-byte.

The new test runs the actual sync script, npm build and installed esbuild in two real temporary installation layouts (including paths with spaces). With the original script, the hoisted layout fails at the same missing executable and the package-local layout passes. With package-relative Node resolution, both pass. A final invocation of the actual repository sync script rebuilds core and emits both fixture bundles successfully. No dependency, tool version, cap or release gate is changed; the corrected resolver honors an external FORMAJS_DIR as well as the workspace.

The new test is part of scripts/check.sh before the full fixture pipeline. Full refreshed hosted CI remains required. Logs below record the actual before, corrected and repository executions under Node24.22.0; no timing acceptance is claimed.
