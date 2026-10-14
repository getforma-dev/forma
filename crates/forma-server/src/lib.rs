//! Axum middleware for Forma SSR.
//!
//! Provides page rendering ([`try_render`]), content-hashed asset serving,
//! CSP headers with cryptographic nonces, an opt-in service worker ([`sw`]), and
//! the Phase 1 (client mount) / Phase 2 (SSR reconcile) rendering pipeline.
//!
//! # Quick Start
//!
//! ```rust,no_run
//! use forma_server::{try_render, PageConfig, PageResponse, RenderCtx, RenderError};
//! ```
//!
//! # Serving a page
//!
//! [`try_render`] returns the page or a coded [`RenderError`]; the handler
//! chooses the response (DR-11). A page's HTML embeds a per-request nonce
//! that only its policy blesses, so the HTML, the policy and
//! `Cache-Control: no-store` travel together: a [`PageResponse`], as axum's
//! `IntoResponse`, writes all of them and cannot be sent without them
//! (DR-17). A handler that needs a looser policy adds typed
//! [`PolicyExtensions`] through its [`RenderCtx`]; it never edits the
//! policy's text.
//!
//! ```rust,no_run
//! use axum::http::StatusCode;
//! use axum::response::{IntoResponse, Response};
//! use forma_server::{try_render, PageConfig, RenderCtx};
//!
//! fn home(config: &PageConfig) -> Response {
//!     match try_render(config, &RenderCtx::new()) {
//!         Ok(page) => page.into_response(),
//!         Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
//!     }
//! }
//! ```
//!
//! Markup the page carries unescaped is a [`RawHtml`], made only by
//! [`RawHtml::trusted`], so a search for that name finds every raw entry
//! (DR-19). The route's `modulepreload` links come from the build's manifest
//! and head links have a typed field, both through [`RenderCtx`]; data goes
//! through `config_json`.
//!
//! A route the build declares `ssr: false` is served by
//! [`render_browser_shell`]. At start, [`load_ir_modules_strict`] is the
//! module loader: stop on its errors, before the port binds. [`IrModules`]
//! loads the same way and, in a debug build, rereads a page's module when the
//! build's watch mode rewrites it. Deprecated in
//! 0.2.2, removed in 3.0.0: `render_page` and its Phase 1 fallback,
//! `render_page_with_nonce`, the lenient `load_ir_modules`, [`PageOutput`]'s
//! public fields and `headers()`, and `PageConfig::config_script`.

// Makes README.md's and SECURITY.md's "Zero `unsafe` blocks" a property the
// compiler enforces rather than a claim.
#![forbid(unsafe_code)]
// No `unwrap`, `expect` or `panic!` in the code that ships (DR-12, SR44): a
// render returns its failure. Tests may. The 0.2.1 functions whose signatures
// have no room for an error (`CspNonce::generate`, `assets::asset`, the
// deprecated `assets::load_manifest`) keep their documented panics under a
// scoped `allow`, each with its fallible twin; none is on the render path.
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

/// Serving content-hashed files out of the embedded `dist` directory.
pub mod assets;
/// Content-Security-Policy construction and nonce generation.
pub mod csp;
/// Doctests pinning each deprecation; built only by `cargo test --doc`.
#[cfg(doctest)]
mod deprecations;
/// Typed homes for the page's head: manifest preloads and head links.
pub mod head;
/// Loading and version-checking the per-route `.ir` modules at startup.
pub mod ir_compat;
/// Raw HTML: the one named type for markup written unescaped.
pub mod raw;
/// The render that returns its failure: `try_render`, `render_browser_shell`.
pub mod render;
/// The page response: HTML that never leaves without its policy.
pub mod response;
// Documented by its own `//!` docs: an outer `///` line here would merge with
// them and resolve their intra-doc links from the crate root.
pub mod sw;
/// The HTML page template and the SSR render entry points.
pub mod template;
/// Request/response types: page config, manifest, render mode.
pub mod types;

/// Re-exported because it appears in [`assets::asset_bytes`]'s signature.
pub use axum::body::Bytes;
pub use csp::{
    build_csp_header, generate_csp_nonce, CspNonce, InvalidNonce, NonceError, PolicyError,
    PolicyExtensions,
};
/// Re-exported: [`RenderCtx::with_limits`] takes it.
pub use forma_ir::WalkLimits;
pub use head::{HeadLink, HeadLinkError, ModulePreloads};
#[allow(deprecated)]
pub use ir_compat::{load_ir_modules, load_ir_modules_strict, IrLoadError, IrModules};
pub use raw::RawHtml;
pub use render::{render_browser_shell, try_render, RenderCtx, RenderError};
pub use response::{PageParts, PageResponse, RenderCounts};
#[allow(deprecated)]
pub use template::{render_page, render_page_with_nonce};
pub use types::*;
