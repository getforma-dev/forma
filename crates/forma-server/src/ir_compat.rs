use forma_ir::parser::IrModule;
use rust_embed::Embed;
use std::collections::HashMap;

use crate::{AssetManifest, RenderMode};

/// Why a route could not be served with Phase 2 SSR.
///
/// `reason` starts with a stable code, by family, then the cause:
///
/// | Code | Cause |
/// |---|---|
/// | LOAD-101 | The manifest declares a module that is not embedded |
/// | LOAD-102 | Not a module this reader accepts: magic, version or flags |
/// | LOAD-103 | A corrupt or truncated module: sections, tables, opcodes, names |
///
/// FMIR v2 carries no checksum, so a flipped byte the structure checks do not
/// reach (inside the source hash, or inside a text string) is not refused;
/// FMIR v3's CRC-32 closes that (DR-28).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrLoadError {
    /// The route pattern that failed.
    pub route: String,
    /// The `.ir` filename the manifest named for it.
    pub ir_file: String,
    /// The code and the human-readable cause, such as
    /// `LOAD-102 bad magic: expected FMIR, got [71, 77, 73, 82]`.
    pub reason: String,
}

impl IrLoadError {
    /// The failure's code (`LOAD-101` to `LOAD-103`), read from the start of
    /// `reason`; `None` for an error built by hand without one.
    pub fn code(&self) -> Option<&str> {
        let code = self.reason.split(' ').next()?;
        let digits = code.strip_prefix("LOAD-")?;
        (digits.len() == 3 && digits.bytes().all(|b| b.is_ascii_digit())).then_some(code)
    }
}

/// The code for a module the parser refused.
fn parse_failure_code(error: &forma_ir::IrError) -> &'static str {
    use forma_ir::IrError;
    match error {
        IrError::BadMagic(_) | IrError::UnsupportedVersion(_) | IrError::UnsupportedFlags(_) => {
            "LOAD-102"
        }
        _ => "LOAD-103",
    }
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
/// Only the lenient loader logs a failure, because only it hides one: the
/// strict loader hands every failure to its caller, which refuses to start.
///
/// A route with no `ir` field in the manifest is NOT an error — it simply has
/// no IR and renders Phase 1. A route that DECLARES an `.ir` file which is not
/// embedded IS an error: that is a build/embed skew, and it used to fall
/// through silently with no log line and no `render_modes` entry, i.e. exactly
/// indistinguishable from the legitimate case.
fn load_ir_modules_inner<A: Embed>(
    manifest: &AssetManifest,
    log_fallbacks: bool,
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
            if log_fallbacks {
                tracing::warn!(
                    route = %route_pattern,
                    ir_file = %ir_filename,
                    "Manifest declares an IR file that is not embedded — Phase 1 fallback"
                );
            }
            errors.push(IrLoadError {
                route: route_pattern.clone(),
                ir_file: ir_filename.clone(),
                reason: "LOAD-101 declared in the manifest but not embedded".to_string(),
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
                if log_fallbacks {
                    tracing::warn!(
                        route = %route_pattern,
                        ir_file = %ir_filename,
                        error = %e,
                        "Failed to parse IR module — Phase 1 fallback"
                    );
                }
                errors.push(IrLoadError {
                    route: route_pattern.clone(),
                    ir_file: ir_filename.clone(),
                    reason: format!("{} {e}", parse_failure_code(&e)),
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
/// build degrades instead of refusing to start: a corrupt module's route is
/// served as an empty shell for the life of the process.
///
/// Routes with no `.ir` field in the manifest are not included in the returned
/// map — callers should treat absent routes as `Phase1ClientMount`.
///
/// Deprecated (DR-11): [`load_ir_modules_strict`] is the default loader from
/// 0.2.2, and 3.0.0 removes this one. It behaves exactly as at 0.2.1, and in
/// debug builds logs its deprecation once per process.
#[deprecated(
    since = "0.2.2",
    note = "serves a corrupt module's route as an empty shell for the life of the process; \
            use `load_ir_modules_strict`, the default loader, and refuse to start on its \
            errors. Removed in 3.0.0 (DR-11)"
)]
pub fn load_ir_modules<A: Embed>(
    manifest: &AssetManifest,
) -> (HashMap<String, RenderMode>, HashMap<String, IrModule>) {
    log_deprecation_once();
    let (render_modes, ir_modules, _errors) = load_ir_modules_inner::<A>(manifest, true);
    (render_modes, ir_modules)
}

/// The runtime half of `load_ir_modules`' deprecation: one `tracing` warning
/// per process, in debug builds only.
///
/// Verified by: crates/forma-server/tests/load_ir_modules_deprecation.rs > "load_ir_modules_logs_its_deprecation_once_per_process_in_debug_builds"
fn log_deprecation_once() {
    #[cfg(debug_assertions)]
    {
        use std::sync::atomic::{AtomicBool, Ordering};
        static LOGGED: AtomicBool = AtomicBool::new(false);
        if !LOGGED.swap(true, Ordering::Relaxed) {
            tracing::warn!(
                "forma_server::load_ir_modules is deprecated: it serves a corrupt module's route \
                 as an empty shell; use load_ir_modules_strict and refuse to start on its errors \
                 (DR-11). Logged once per process, in debug builds."
            );
        }
    }
}

/// The module loader: every module the manifest declares, parsed and
/// checked, or every failure, so the server can refuse to start (DR-11).
///
/// The default from 0.2.2. Call it at start, before the port binds, and stop
/// on `Err`: a module that is missing, corrupt, truncated or from another
/// format version for a server-rendered route is a failed deploy, and CI and
/// staging are where it should surface (Q13: one bad module refuses start,
/// for every route; RK7). Each [`IrLoadError`] names the route, the file and
/// a code. A route the build declares `ssr: false` carries no `ir` in the
/// manifest and needs no module: it is not an error, and not in the maps.
///
/// ```no_run
/// use forma_server::{assets, load_ir_modules_strict};
///
/// fn start<Assets: rust_embed::Embed>() -> Result<(), String> {
///     let manifest = assets::try_load_manifest::<Assets>()?;
///     let (render_modes, modules) = load_ir_modules_strict::<Assets>(&manifest).map_err(|errors| {
///         let names: Vec<String> = errors.iter().map(|e| e.to_string()).collect();
///         names.join("; ") // e.g. "route /: IR file page.ir: LOAD-103 ..."
///     })?;
///     // ...only now bind the port.
///     # let _ = (render_modes, modules);
///     Ok(())
/// }
/// ```
///
/// Verified by: crates/forma-server/tests/strict_loader.rs > "with_a_bad_module_the_fixture_server_binds_no_port"
#[allow(clippy::type_complexity)]
pub fn load_ir_modules_strict<A: Embed>(
    manifest: &AssetManifest,
) -> Result<(HashMap<String, RenderMode>, HashMap<String, IrModule>), Vec<IrLoadError>> {
    let (render_modes, ir_modules, errors) = load_ir_modules_inner::<A>(manifest, false);
    if errors.is_empty() {
        Ok((render_modes, ir_modules))
    } else {
        Err(errors)
    }
}

#[cfg(test)]
#[allow(deprecated)] // the lenient loader's 0.2.1 behaviour is pinned here too
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
        assert_eq!(errors[0].code(), Some("LOAD-101"));

        // ...and the lenient variant still degrades gracefully, with the map
        // made total rather than relying on absence.
        let (render_modes, ir_modules) = load_ir_modules::<Fixtures>(&manifest);
        assert_eq!(render_modes.get("/"), Some(&RenderMode::Phase1ClientMount));
        assert!(ir_modules.is_empty());
    }

    #[test]
    fn a_load_error_s_code_is_read_from_the_start_of_its_reason() {
        let error = |reason: &str| IrLoadError {
            route: "/".to_string(),
            ir_file: "page.ir".to_string(),
            reason: reason.to_string(),
        };
        assert_eq!(error("LOAD-102 bad magic").code(), Some("LOAD-102"));
        assert_eq!(error("LOAD-103 out of bounds").code(), Some("LOAD-103"));
        // Built by hand without one, or something code-shaped that is not.
        for reason in [
            "bad magic",
            "",
            "LOAD-1 x",
            "LOAD-1023 x",
            "LOAD-10x y",
            "load-102 x",
        ] {
            assert_eq!(error(reason).code(), None, "{reason:?}");
        }
        // The parser's errors map to their family.
        assert_eq!(
            parse_failure_code(&forma_ir::IrError::BadMagic(*b"GMIR")),
            "LOAD-102"
        );
        assert_eq!(
            parse_failure_code(&forma_ir::IrError::UnsupportedVersion(3)),
            "LOAD-102"
        );
        assert_eq!(
            parse_failure_code(&forma_ir::IrError::UnsupportedFlags(1)),
            "LOAD-102"
        );
        assert_eq!(
            parse_failure_code(&forma_ir::IrError::InvalidOpcode(0x81)),
            "LOAD-103"
        );
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
