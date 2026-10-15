//! Private adapters preserve low-level renderer controls after the public raw SSR
//! entry is removed. External typed_pages tests exercise the final application API.
use crate::{AssetManifest, PageResponse, RawHtml, RenderCtx, RenderError, RouteAssets, RouteMode};

#[derive(Clone, Copy)]
pub(super) enum RenderPath {
    Phase1ClientMount,
    Phase2SsrReconcile,
}

pub(super) struct RenderFixture<'a> {
    pub title: &'a str,
    pub route_pattern: &'a str,
    pub manifest: &'a AssetManifest,
    pub config_json: Option<&'a serde_json::Value>,
    pub body_class: Option<&'a str>,
    pub personality_css: Option<&'a str>,
    pub body_prefix: Option<&'a RawHtml>,
    pub render_mode: RenderPath,
    pub ir_module: Option<&'a forma_ir::IrModule>,
    pub slots: Option<&'a forma_ir::SlotData>,
}
impl RenderFixture<'_> {
    fn document(&self) -> crate::PageConfig<'_> {
        crate::PageConfig {
            title: self.title,
            route_pattern: self.route_pattern,
            manifest: self.manifest,
            config_json: self.config_json,
            body_class: self.body_class,
            personality_css: self.personality_css,
            body_prefix: self.body_prefix,
        }
    }
}
pub(super) fn render_ssr(
    input: &RenderFixture<'_>,
    ctx: &RenderCtx,
) -> Result<PageResponse, RenderError> {
    crate::render::render_bound(
        &input.document(),
        ctx,
        input.ir_module,
        input.slots,
        ctx.limits(crate::Limits::default()),
    )
}
pub(super) fn render_shell(
    input: &RenderFixture<'_>,
    ctx: &RenderCtx,
) -> Result<PageResponse, RenderError> {
    // The matrix reuses document metadata while explicitly declaring the shell
    // fixture's route Browser. Public rejection controls live in typed_pages.
    let mut manifest = input.manifest.clone();
    let route = manifest
        .routes
        .entry(input.route_pattern.into())
        .or_insert_with(|| RouteAssets {
            mode: RouteMode::Browser,
            modulepreload: vec![],
            js: vec![],
            css: vec![],
            fonts: vec![],
            total_size_br: 0,
            budget_warn_threshold: 0,
            ir: None,
        });
    route.mode = RouteMode::Browser;
    route.ir = None;
    let mut config = input.document();
    config.manifest = &manifest;
    crate::render_browser_shell(&config, ctx)
}
mod checked_render;
mod page_response;
mod preview_frame;
mod raw_html;
mod typed_homes;

use crate::AssetMetadata;
/// Metadata-only renderer fixtures model each declared resource as an empty file.
/// Actual embedded-file integrity controls live in asset_integrity.rs.
pub(crate) fn fixture_assets(
    routes: &std::collections::HashMap<String, RouteAssets>,
) -> std::collections::HashMap<String, AssetMetadata> {
    routes
        .values()
        .flat_map(|route| {
            route
                .js
                .iter()
                .chain(&route.css)
                .chain(&route.fonts)
                .chain(&route.modulepreload)
                .chain(route.ir.iter())
        })
        .map(|file| {
            (
                file.clone(),
                AssetMetadata {
                    immutable: false,
                    integrity:
                        "sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"
                            .into(),
                    retained: false,
                },
            )
        })
        .collect()
}
