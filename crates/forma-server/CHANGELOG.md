# Changelog

## [0.1.3] - 2026-03-17

### Security
- Template interpolations escaped: asset URLs, body_class, personality_css
- `</style>` breakout prevention in personality CSS

### Added
- README for crates.io with full documentation
- 4 new security tests (escape_html, asset XSS, body_class escaping, CSS breakout)
- Crate-level `//!` documentation

## [0.1.1] - 2026-03-14

### Fixed
- Dependency on `forma-ir` versioned correctly

## [0.1.0] - 2026-03-13

### Added
- Initial release: page rendering, asset serving, CSP headers, service worker
- Phase 1 (client mount) and Phase 2 (SSR reconcile) rendering modes
- 14 tests
