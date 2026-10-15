# Source-template migration archive

These files preserve the templates, temporary packaging source adapter and
related documentation as they stood before FORMA-144 slice 1. `index.json`
records each original path and SHA-256. They are historical evidence, not the
current package inputs or API guide.

The current template sources now use typed props, Pages binding/finalization
and PageResponse. Their source-only lock seeds omit only known internal
archive hashes; actual packed locks remain sealed. The temporary whole-file
Rust source adapter was removed after its reviewed behavior moved into the
source templates. Whole-page mount remains until the island/state migration.
