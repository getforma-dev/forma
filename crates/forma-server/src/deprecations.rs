//! Compile controls for the removed A2 response/raw-script bridges.

/// Public renderers return the typed response; callers cannot construct or split
/// it implicitly. The named unchecked exit remains available for reviewed uses.
///
/// ```
/// use axum::response::IntoResponse;
/// use forma_server::{PageResponse, PageConfig, RenderCtx, try_render, render_browser_shell};
/// fn respond(page: PageResponse) { let _ = page.into_response(); }
/// fn render(config: &PageConfig) { let _ = try_render(config, &RenderCtx::new()); }
/// fn shell(config: &PageConfig) { let _ = render_browser_shell(config, &RenderCtx::new()); }
/// fn reviewed(page: PageResponse) { let _ = page.into_parts_unchecked(); }
/// ```
///
/// ```compile_fail
/// use forma_server::PageOutput;
/// ```
/// ```compile_fail
/// use forma_server::render_page;
/// ```
/// ```compile_fail
/// use forma_server::render_page_with_nonce;
/// ```
/// ```compile_fail
/// fn html(page: forma_server::PageResponse) -> String { page.html }
/// ```
/// ```compile_fail
/// fn script(page: &mut forma_server::PageConfig<'_>) { page.config_script = Some("alert(1)"); }
/// ```
/// ```compile_fail
/// fn prefix(page: &mut forma_server::PageConfig<'_>) { page.body_prefix = Some("<nav>raw</nav>"); }
/// ```
/// ```
/// fn prefix<'a>(page: &mut forma_server::PageConfig<'a>, reviewed: &'a forma_server::RawHtml) {
///     page.body_prefix = Some(reviewed);
/// }
/// ```
pub(crate) struct RemovedBridges;

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

/// The retired tuple signature cannot be used through the final loader name.
///
/// ```compile_fail
/// fn load<A: rust_embed::Embed + 'static>(manifest: &forma_server::AssetManifest) -> usize {
///     forma_server::load_ir_modules::<A>(manifest).1.len()
/// }
/// ```
pub(crate) struct LoadIrModules;
