//! Typed server rendering and explicit browser shells for Forma.
//!
//! Load the build's validated manifest and modules, bind every SSR route to its
//! derived handler, then call [`Pages::finalize`] before opening the listener.
//! [`PageHandle::render`] returns a [`PageResponse`] or a coded [`RenderError`];
//! it never substitutes a browser shell for a failure.
//!
//! ```no_run
//! use forma_ir::PageProps;
//! use forma_server::{assets, load_ir_modules, PageHandle, RenderCtx};
//! #[derive(PageProps)]
//! struct HomeProps { title: String }
//! fn start<A: rust_embed::Embed + 'static>() -> Result<PageHandle<HomeProps>, String> {
//!     let manifest = assets::load_manifest::<A>()?;
//!     let pages = load_ir_modules::<A>(&manifest).map_err(|e| format!("{e:?}"))?;
//!     let home = pages.bind("home").map_err(|e| format!("{e:?}"))?;
//!     pages.finalize().map_err(|e| format!("{e:?}"))?;
//!     Ok(home) // the application may now open its listener
//! }
//! fn home(page: &PageHandle<HomeProps>) -> Result<forma_server::PageResponse, forma_server::RenderError> {
//!     page.render(&HomeProps { title:"Hello".into() }, &RenderCtx::new())
//! }
//! ```
//!
//! The response keeps HTML, its fresh nonce, enforced CSP and no-store headers
//! together. Per-request [`RenderCtx`] carries typed policy/head/preload settings,
//! escaped JSON, branding CSS and an explicit [`RawHtml`] prefix, never a nonce
//! or executable handler script. [`render_browser_shell`] accepts only a route
//! explicitly declared Browser. Unreviewed content belongs in [`frame`].
//!
//! In debug builds a corrupt edit keeps the previous module/asset snapshot;
//! changed schemas are rebound, while changed route names or modes require a
//! restart and fresh finalization. Release builds use their embedded snapshot.
//! The old raw SSR entry, tuple loader, PageOutput and caller nonce API are gone.

// Makes README.md's and SECURITY.md's "Zero `unsafe` blocks" a property the
// compiler enforces rather than a claim.
#![forbid(unsafe_code)]
// No `unwrap`, `expect` or `panic!` in the code that ships (DR-12, SR44): a
// render returns its failure. Tests may. Public asset/manifest loading and
// nonce generation also return their errors, including the compatibility aliases.
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

/// Serving content-hashed files out of the embedded `dist` directory.
pub mod assets;
/// Content-Security-Policy construction and nonce generation.
pub mod csp;
/// Compile controls pinning removed response/raw-script bridges.
#[cfg(doctest)]
mod deprecations;
// Documented by its own `//!` docs (the preview frame, DR-14 tier (c)).
pub mod frame;
/// Typed homes for the page's head: manifest preloads and head links.
pub mod head;
/// Loading and version-checking the per-route `.ir` modules at startup.
pub mod ir;
/// Unreleased, opt-in native navigation and action feasibility contracts.
#[cfg(feature = "experimental-router")]
pub mod navigation;
/// Bound page contracts and checked handler rendering.
pub mod pages;
/// Raw HTML: the one named type for markup written unescaped.
pub mod raw;
/// Request context, errors and the explicit browser shell.
pub mod render;
/// The page response: HTML that never leaves without its policy.
pub mod response;
// Documented by its own `//!` docs: an outer `///` line here would merge with
// them and resolve their intra-doc links from the crate root.
pub mod sw;
/// The HTML page template and the SSR render entry points.
pub mod template;
/// Document metadata, manifest and declared route modes.
pub mod types;

/// Re-exported because it appears in [`assets::asset_bytes`]'s signature.
pub use axum::body::Bytes;
pub use csp::{
    build_csp_header, generate_csp_nonce, CspNonce, InvalidNonce, NonceError, PolicyError,
    PolicyExtensions,
};
pub use forma_ir::props::{PropsError, PropsSource, PropsWarning};
/// Parser errors and their authoritative `code()` method.
pub use forma_ir::IrError;
/// Derive and trait for declared handler props.
pub use forma_ir::PageProps;
/// Re-exported: [`RenderCtx::with_limits`] takes it.
pub use forma_ir::WalkLimits;
/// Limits inherited by a bound page, with optional per-request overrides.
pub use forma_ir::WalkLimits as Limits;
pub use frame::{FrameError, PreviewFrame, FRAME_RUNTIME_ASSET};
pub use head::{HeadLink, HeadLinkError, ModulePreloads};
#[allow(deprecated)]
pub use ir::{load_ir_modules, IrLoadError};
#[cfg(feature = "experimental-router")]
pub use navigation::{ActionContext, ActionResponse, NavigationConfig, NavigationResponse};
pub use pages::{PageHandle, Pages};
pub use raw::RawHtml;
pub use render::{render_browser_shell, RenderCtx, RenderError};
#[cfg(feature = "compression")]
pub use response::CompressedPageResponse;
pub use response::{PageParts, PageResponse, RenderCounts};
pub use types::*;

#[cfg(test)]
#[path = "../tests/internal_renderer/mod.rs"]
mod render_contract;
