# Changelog

## [0.5.0] - 2026-03-17

### Changed
- Flagship dashboard template completely rebuilt — 4 islands (StatsCards, Sidebar, ActivityFeed, DataTable) with different hydration triggers, Rust JSON API routes, createFetch/createStore/createShow/$dispatch, SSR Phase 2 fallback, dark theme, separation of concerns
- Polished CLI — colored output, git init, package manager detection, branded header
- Dashboard is now the default template (listed first)
- Minimal template description: "Clean slate — ready to build on"

### Fixed
- Placeholder mismatch: CLI now replaces both {{PROJECT_NAME}} and {{project-name}}
- Dashboard build.ts outputDir fixed (was ../dist, now dist)
- 9 missing CSS class definitions added
- Unused nonce variable removed from dashboard main.rs
- Unused tower-http dependency removed from dashboard Cargo.toml
- Dead api.ts removed (islands use createFetch directly)
- Stale dist rebuilt

## [0.4.0] - 2026-03-17

### Added
- Flagship dashboard template with islands, API routes, dark theme

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
