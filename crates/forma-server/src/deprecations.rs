//! Doctests that pin each A2 deprecation (compiled only for `cargo test --doc`).
//!
//! Each deprecated item has two snippets of the same code: one under
//! `#![allow(deprecated)]` that must compile, proving the 0.2.1 call still
//! works, and one under `#![deny(deprecated)]` that must not, proving the
//! deprecation is there. The pair is what makes the `compile_fail` honest: the
//! only difference between the two is the lint level.

/// `render_page_with_nonce` (L-14).
///
/// ```
/// #![allow(deprecated)]
/// use forma_server::{render_page_with_nonce, CspNonce, PageConfig};
/// fn render(config: &PageConfig) { let _ = render_page_with_nonce(config, &CspNonce::generate()); }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// use forma_server::{render_page_with_nonce, CspNonce, PageConfig};
/// fn render(config: &PageConfig) { let _ = render_page_with_nonce(config, &CspNonce::generate()); }
/// ```
pub(crate) struct RenderPageWithNonce;

/// `PageOutput`'s public fields (DR-17).
///
/// ```
/// #![allow(deprecated)]
/// fn parts(page: forma_server::PageOutput) -> (String, String, forma_server::CspNonce) {
///     (page.html, page.csp, page.nonce)
/// }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// fn html(page: forma_server::PageOutput) -> String { page.html }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// fn csp(page: forma_server::PageOutput) -> String { page.csp }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// fn nonce(page: forma_server::PageOutput) -> forma_server::CspNonce { page.nonce }
/// ```
pub(crate) struct PageOutputFields;

/// `PageOutput::headers` (DR-17).
///
/// ```
/// #![allow(deprecated)]
/// fn headers(page: &forma_server::PageOutput) -> usize { page.headers().len() }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// fn headers(page: &forma_server::PageOutput) -> usize { page.headers().len() }
/// ```
pub(crate) struct PageOutputHeaders;

/// `PageConfig::config_script` (DR-18): naming the field at all, `None`
/// included, warns, since every 0.2.x `PageConfig` literal lists it.
///
/// ```
/// #![allow(deprecated)]
/// use forma_server::{AssetManifest, PageConfig, RenderMode};
/// fn config(manifest: &AssetManifest) -> PageConfig<'_> {
///     PageConfig {
///         title: "t", route_pattern: "/", manifest, config_script: None, config_json: None,
///         body_class: None, personality_css: None, body_prefix: None,
///         render_mode: RenderMode::Phase1ClientMount, ir_module: None, slots: None,
///     }
/// }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// use forma_server::{AssetManifest, PageConfig, RenderMode};
/// fn config(manifest: &AssetManifest) -> PageConfig<'_> {
///     PageConfig {
///         title: "t", route_pattern: "/", manifest, config_script: None, config_json: None,
///         body_class: None, personality_css: None, body_prefix: None,
///         render_mode: RenderMode::Phase1ClientMount, ir_module: None, slots: None,
///     }
/// }
/// ```
pub(crate) struct ConfigScript;

/// `render_page` (DR-11; FORMA-120).
///
/// ```
/// #![allow(deprecated)]
/// fn render(config: &forma_server::PageConfig) { let _ = forma_server::render_page(config); }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// fn render(config: &forma_server::PageConfig) { let _ = forma_server::render_page(config); }
/// ```
pub(crate) struct RenderPage;

/// `assets::load_manifest` (L-13; FORMA-120).
///
/// ```
/// #![allow(deprecated)]
/// fn load<A: rust_embed::Embed>() -> forma_server::AssetManifest {
///     forma_server::assets::load_manifest::<A>()
/// }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// fn load<A: rust_embed::Embed>() -> forma_server::AssetManifest {
///     forma_server::assets::load_manifest::<A>()
/// }
/// ```
pub(crate) struct LoadManifest;

/// `load_ir_modules`, the lenient loader (DR-11; FORMA-121).
///
/// ```
/// #![allow(deprecated)]
/// fn load<A: rust_embed::Embed>(manifest: &forma_server::AssetManifest) -> usize {
///     forma_server::load_ir_modules::<A>(manifest).1.len()
/// }
/// ```
///
/// ```compile_fail
/// #![deny(deprecated)]
/// fn load<A: rust_embed::Embed>(manifest: &forma_server::AssetManifest) -> usize {
///     forma_server::load_ir_modules::<A>(manifest).1.len()
/// }
/// ```
pub(crate) struct LoadIrModules;
