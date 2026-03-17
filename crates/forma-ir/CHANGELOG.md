# Changelog

## [0.1.3] - 2026-03-17

### Security
- Added `MAX_RECURSION_DEPTH = 64` for SHOW_IF/SWITCH — prevents stack overflow from malicious IR
- Added `</script>` escaping test for script tag props

### Changed
- Walker refactored: `walk_range` and `walk_range_until_island_end` merged into single `walk_range_impl` with `WalkMode` enum — eliminates 322 lines of duplicated opcode handling

### Added
- README for crates.io with full documentation

## [0.1.1] - 2026-03-14

### Fixed
- Made `serde_json` a required dependency (was optional)
- Removed `cdylib` from default crate-type

## [0.1.0] - 2026-03-13

### Added
- Initial release: FMIR binary format parser, walker, slots, WASM exports
- HTML generation with XSS-safe escaping
- Hydration marker emission for FormaJS
- 124 tests
