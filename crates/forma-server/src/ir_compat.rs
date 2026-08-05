use forma_ir::parser::IrModule;
use rust_embed::Embed;
use std::collections::HashMap;

use crate::{AssetManifest, RenderMode};

/// Why a route could not be served with Phase 2 SSR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrLoadError {
    /// The route pattern that failed.
    pub route: String,
    /// The `.ir` filename the manifest named for it.
    pub ir_file: String,
    /// Human-readable cause.
    pub reason: String,
}

impl std::fmt::Display for IrLoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "route {}: IR file {}: {}",
            self.route, self.ir_file, self.reason
        )
    }
}

impl std::error::Error for IrLoadError {}

/// Load and parse all IR modules from the asset manifest, collecting failures.
///
/// This is the primary implementation; [`load_ir_modules`] discards the errors
/// and [`load_ir_modules_strict`] surfaces them, so the two can never drift.
///
/// A route with no `ir` field in the manifest is NOT an error — it simply has
/// no IR and renders Phase 1. A route that DECLARES an `.ir` file which is not
/// embedded IS an error: that is a build/embed skew, and it used to fall
/// through silently with no log line and no `render_modes` entry, i.e. exactly
/// indistinguishable from the legitimate case.
fn load_ir_modules_inner<A: Embed>(
    manifest: &AssetManifest,
) -> (
    HashMap<String, RenderMode>,
    HashMap<String, IrModule>,
    Vec<IrLoadError>,
) {
    let mut render_modes = HashMap::new();
    let mut ir_modules = HashMap::new();
    let mut errors = Vec::new();

    for (route_pattern, route_assets) in &manifest.routes {
        let Some(ref ir_filename) = route_assets.ir else {
            // No IR declared for this route — nothing to load, not a failure.
            continue;
        };

        let Some(ir_bytes) = crate::assets::asset_bytes::<A>(ir_filename) else {
            tracing::warn!(
                route = %route_pattern,
                ir_file = %ir_filename,
                "Manifest declares an IR file that is not embedded — Phase 1 fallback"
            );
            errors.push(IrLoadError {
                route: route_pattern.clone(),
                ir_file: ir_filename.clone(),
                reason: "declared in the manifest but not embedded".to_string(),
            });
            // Insert explicitly so the map is total: every declared route has
            // a mode, rather than "absent" doing double duty.
            render_modes.insert(route_pattern.clone(), RenderMode::Phase1ClientMount);
            continue;
        };

        match IrModule::parse(&ir_bytes) {
            Ok(module) => {
                tracing::info!(
                    route = %route_pattern,
                    ir_file = %ir_filename,
                    "Loaded IR module for SSR"
                );
                render_modes.insert(route_pattern.clone(), RenderMode::Phase2SsrReconcile);
                ir_modules.insert(route_pattern.clone(), module);
            }
            Err(e) => {
                tracing::warn!(
                    route = %route_pattern,
                    ir_file = %ir_filename,
                    error = %e,
                    "Failed to parse IR module — Phase 1 fallback"
                );
                errors.push(IrLoadError {
                    route: route_pattern.clone(),
                    ir_file: ir_filename.clone(),
                    reason: e.to_string(),
                });
                render_modes.insert(route_pattern.clone(), RenderMode::Phase1ClientMount);
            }
        }
    }

    if !ir_modules.is_empty() {
        tracing::info!(
            ssr_routes = ir_modules.len(),
            "Phase 2 SSR enabled for {} route(s)",
            ir_modules.len()
        );
    }

    (render_modes, ir_modules, errors)
}

/// Load and parse all IR modules from the asset manifest, ignoring failures.
///
/// Every failure is logged and represented as `Phase1ClientMount`, so a broken
/// build degrades instead of refusing to start. Use
/// [`load_ir_modules_strict`] if you would rather fail startup on a
/// build/embed skew than quietly ship without SSR.
///
/// Routes with no `.ir` field in the manifest are not included in the returned
/// map — callers should treat absent routes as `Phase1ClientMount`.
pub fn load_ir_modules<A: Embed>(
    manifest: &AssetManifest,
) -> (HashMap<String, RenderMode>, HashMap<String, IrModule>) {
    let (render_modes, ir_modules, _errors) = load_ir_modules_inner::<A>(manifest);
    (render_modes, ir_modules)
}

/// [`load_ir_modules`], but returns the collected failures so an app can fail
/// startup on a build/embed skew rather than silently serving Phase 1.
///
/// Note the distinction the lenient variant cannot express: a missing embedded
/// asset for a declared `.ir` is an error here, while a route that never had
/// an `ir` field is not.
#[allow(clippy::type_complexity)]
pub fn load_ir_modules_strict<A: Embed>(
    manifest: &AssetManifest,
) -> Result<(HashMap<String, RenderMode>, HashMap<String, IrModule>), Vec<IrLoadError>> {
    let (render_modes, ir_modules, errors) = load_ir_modules_inner::<A>(manifest);
    if errors.is_empty() {
        Ok((render_modes, ir_modules))
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::RouteAssets;
    use rust_embed::Embed;

    #[derive(Embed)]
    #[folder = "test_fixtures/"]
    struct Fixtures;

    fn manifest_with_ir(route: &str, ir: Option<&str>) -> AssetManifest {
        let mut routes = HashMap::new();
        routes.insert(
            route.to_string(),
            RouteAssets {
                js: vec![],
                css: vec![],
                fonts: vec![],
                total_size_br: 0,
                budget_warn_threshold: 0,
                ir: ir.map(str::to_string),
            },
        );
        AssetManifest {
            version: 1,
            build_hash: "test".to_string(),
            assets: HashMap::new(),
            routes,
            wasm: None,
        }
    }

    #[test]
    fn a_declared_but_unembedded_ir_file_is_reported_not_swallowed() {
        // Previously this fell through with no log line and no render_modes
        // entry — indistinguishable from a route that never had IR.
        let manifest = manifest_with_ir("/", Some("page.deadbeef.ir"));
        let errors = load_ir_modules_strict::<Fixtures>(&manifest).unwrap_err();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].route, "/");
        assert_eq!(errors[0].ir_file, "page.deadbeef.ir");

        // ...and the lenient variant still degrades gracefully, with the map
        // made total rather than relying on absence.
        let (render_modes, ir_modules) = load_ir_modules::<Fixtures>(&manifest);
        assert_eq!(render_modes.get("/"), Some(&RenderMode::Phase1ClientMount));
        assert!(ir_modules.is_empty());
    }

    #[test]
    fn a_route_with_no_ir_field_is_not_an_error() {
        // The distinction the old code could not express.
        let manifest = manifest_with_ir("/", None);
        let (render_modes, ir_modules) =
            load_ir_modules_strict::<Fixtures>(&manifest).expect("must not error");
        assert!(render_modes.is_empty());
        assert!(ir_modules.is_empty());
    }
}
