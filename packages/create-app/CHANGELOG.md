# Changelog

## [0.3.0] - 2026-03-17

### Added
- `--help`, `--version`, `--template <name>` CLI flags
- Graceful error message when frontend not built (instead of Rust panic)
- `typescript` added to template devDependencies

### Fixed
- `.gitignore` files now survive npm pack (renamed `_gitignore` → `.gitignore` after copy)
- Process exits with code 1 on error (was 0)
- `engines: { node: ">=18" }` added to package.json

### Changed
- Dashboard template title changed from "Home" to "Dashboard"

## [0.2.0] - 2026-03-15

### Changed
- Templates updated to @getforma/core ^1.0.0
- Migrated templates from h() calls to JSX syntax
- Added automated dep update workflow for @getforma/core

## [0.1.0] - 2026-03-14

### Added
- Initial release with minimal and dashboard templates
- CLI with project name validation and template selection
