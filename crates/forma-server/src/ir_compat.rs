use forma_ir::parser::IrModule;
use rust_embed::Embed;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt;
use std::marker::PhantomData;
use std::sync::Arc;

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
/// FMIR v3's CRC-32 closes that.
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

/// Reads one embedded file by name, as rust-embed's `Embed::get` does: in a
/// debug build from disk on every call, in a release build from the bytes
/// compiled into the binary. A parameter so a test can hand the loader its
/// own files.
type Read<'r> = &'r dyn Fn(&str) -> Option<Cow<'static, [u8]>>;

/// Why one declared module was not loaded.
enum Refusal {
    /// The manifest names a file that is not embedded.
    NotEmbedded,
    /// The parser refused it.
    Parse(forma_ir::IrError),
}

impl Refusal {
    /// The coded error for `route`'s `ir_file`.
    fn error(&self, route: &str, ir_file: &str) -> IrLoadError {
        let reason = match self {
            Refusal::NotEmbedded => {
                "LOAD-101 declared in the manifest but not embedded".to_string()
            }
            Refusal::Parse(e) => format!("{} {e}", parse_failure_code(e)),
        };
        IrLoadError {
            route: route.to_string(),
            ir_file: ir_file.to_string(),
            reason,
        }
    }
}

/// The one check every module goes through, at start and on a development
/// reload: present, and parsed and validated by `IrModule::parse`.
fn check_module(bytes: Option<&[u8]>) -> Result<IrModule, Refusal> {
    let bytes = bytes.ok_or(Refusal::NotEmbedded)?;
    IrModule::parse(bytes).map_err(Refusal::Parse)
}

/// One route's module as loaded, with the file and bytes it came from (which
/// only a development reload reads).
struct Loaded {
    route: String,
    #[cfg_attr(not(debug_assertions), allow(dead_code))]
    ir_file: String,
    #[cfg_attr(not(debug_assertions), allow(dead_code))]
    bytes: Cow<'static, [u8]>,
    module: IrModule,
}

/// Load and parse all IR modules from the asset manifest, collecting failures.
///
/// This is the primary implementation; [`load_ir_modules`] discards the errors
/// and [`load_ir_modules_strict`] and [`IrModules::load`] surface them, so they
/// can never drift. Only the lenient loader logs a failure, because only it
/// hides one: the strict loaders hand every failure to their caller, which
/// refuses to start.
///
/// A route with no `ir` field in the manifest is NOT an error — it simply has
/// no IR and renders Phase 1. A route that DECLARES an `.ir` file which is not
/// embedded IS an error: that is a build/embed skew, and it used to fall
/// through silently with no log line and no `render_modes` entry, i.e. exactly
/// indistinguishable from the legitimate case.
fn load_from(
    manifest: &AssetManifest,
    read: Read<'_>,
    log_fallbacks: bool,
) -> (HashMap<String, RenderMode>, Vec<Loaded>, Vec<IrLoadError>) {
    let mut render_modes = HashMap::new();
    let mut loaded = Vec::new();
    let mut errors = Vec::new();

    for (route_pattern, route_assets) in &manifest.routes {
        let Some(ref ir_filename) = route_assets.ir else {
            // No IR declared for this route — nothing to load, not a failure.
            continue;
        };

        let bytes = read(ir_filename);
        match check_module(bytes.as_deref()) {
            Ok(module) => {
                tracing::info!(
                    route = %route_pattern,
                    ir_file = %ir_filename,
                    "Loaded IR module for SSR"
                );
                render_modes.insert(route_pattern.clone(), RenderMode::Phase2SsrReconcile);
                loaded.push(Loaded {
                    route: route_pattern.clone(),
                    ir_file: ir_filename.clone(),
                    bytes: bytes.unwrap_or_default(),
                    module,
                });
            }
            Err(refusal) => {
                if log_fallbacks {
                    match &refusal {
                        Refusal::NotEmbedded => tracing::warn!(
                            route = %route_pattern,
                            ir_file = %ir_filename,
                            "Manifest declares an IR file that is not embedded — Phase 1 fallback"
                        ),
                        Refusal::Parse(e) => tracing::warn!(
                            route = %route_pattern,
                            ir_file = %ir_filename,
                            error = %e,
                            "Failed to parse IR module — Phase 1 fallback"
                        ),
                    }
                }
                errors.push(refusal.error(route_pattern, ir_filename));
                // Insert explicitly so the map is total: every declared route
                // has a mode, rather than "absent" doing double duty.
                render_modes.insert(route_pattern.clone(), RenderMode::Phase1ClientMount);
            }
        }
    }

    if !loaded.is_empty() {
        tracing::info!(
            ssr_routes = loaded.len(),
            "Phase 2 SSR enabled for {} route(s)",
            loaded.len()
        );
    }

    (render_modes, loaded, errors)
}

/// [`load_from`] over the embedded files of `A`, as two maps.
fn load_ir_modules_inner<A: Embed>(
    manifest: &AssetManifest,
    log_fallbacks: bool,
) -> (
    HashMap<String, RenderMode>,
    HashMap<String, IrModule>,
    Vec<IrLoadError>,
) {
    let (render_modes, loaded, errors) = load_from(manifest, &embedded::<A>, log_fallbacks);
    let ir_modules = loaded.into_iter().map(|l| (l.route, l.module)).collect();
    (render_modes, ir_modules, errors)
}

/// One of `A`'s files, through rust-embed.
fn embedded<A: Embed>(name: &str) -> Option<Cow<'static, [u8]>> {
    A::get(name).map(|file| file.data)
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
/// Deprecated: [`load_ir_modules_strict`] is the default loader from
/// 0.2.2, and 3.0.0 removes this one. It behaves exactly as at 0.2.1, and in
/// debug builds logs its deprecation once per process.
#[deprecated(
    since = "0.2.2",
    note = "serves a corrupt module's route as an empty shell for the life of the process; \
            use `load_ir_modules_strict`, the default loader, and refuse to start on its \
            errors. Removed in 3.0.0"
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
                 as an empty shell; use load_ir_modules_strict and refuse to start on its errors. \
                 Logged once per process, in debug builds."
            );
        }
    }
}

/// The module loader: every module the manifest declares, parsed and
/// checked, or every failure, so the server can refuse to start.
///
/// The default from 0.2.2. Call it at start, before the port binds, and stop
/// on `Err`: a module that is missing, corrupt, truncated or from another
/// format version for a server-rendered route is a failed deploy, and CI and
/// staging are where it should surface: one bad module refuses start,
/// for every route. Each [`IrLoadError`] names the route, the file and
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
/// To have a debug build reread a page's module when the build's watch mode
/// rewrites it, load with [`IrModules::load`] instead: the same check and
/// errors.
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

/// The page modules, loaded at start by the strict loader, and in a debug
/// build reread when the build's watch mode rewrites one.
///
/// [`load_ir_modules_strict`] hands the application its modules once, so a
/// page edited under `forma-build --watch` showed its change only after a
/// server restart. An application that holds its modules here instead asks
/// for a route's module per request, with [`IrModules::get`]:
///
/// - **In a release build** `get` is a map lookup. Nothing is watched or
///   checked: the modules are the ones embedded in the binary, which cannot
///   change.
/// - **In a debug build** (`cfg(debug_assertions)`) `get` first rereads the
///   manifest's entry for the route and the module's file, and when the bytes
///   differ from the module it holds, loads the new one through the same check
///   as start ([`IrModule::parse`], the strict loader's). A module that fails
///   it keeps the previous one, and the failure is logged once per distinct
///   file, as a `tracing` warning carrying its `LOAD-1xx` code; the next good
///   write replaces it. A route the manifest starts naming after start is
///   loaded on its first `get`; a route the manifest stops naming keeps its
///   last module.
///
/// Why per request, and why debug builds: in a debug build rust-embed reads
/// every file from disk on each call, so rereading the manifest and the module
/// costs two small reads and a comparison, and the next request sees the
/// build's last write, with no watcher thread, no file-watching dependency
/// and no path for forma-server to know beyond the `Embed` type. The watch
/// mode publishes a module by rename and only when its bytes change, so a read
/// never sees half a file and an unchanged module is never reloaded. In a
/// release build rust-embed serves the bytes compiled in, so there is nothing
/// to reread, and the check is not compiled: the switch is rust-embed's own.
/// (An application that enables rust-embed's `debug-embed` feature has its
/// files compiled into debug builds too; `get` then finds nothing changed.)
///
/// "Debug build" here means forma-server compiled with debug assertions
/// (`cfg(debug_assertions)`), not a profile's name. Cargo's default `release`
/// profile turns them off, so a default release binary reads nothing per
/// request. A profile that sets `debug-assertions = true`, for the whole
/// build or for forma-server alone (`[profile.release.package.forma-server]`),
/// compiles the check into what it calls a release binary: each `get` then
/// rereads the files, from the build folder on disk (rust-embed reads from
/// disk under the same switch), or, with `debug-embed`, from the embedded
/// bytes at the cost of a lock and a comparison. Keep debug assertions off in
/// the profile you deploy.
///
/// The strict loader's `render_modes` map has no counterpart here: a route is
/// server-rendered exactly when `get(route)` returns a module, and a route
/// without one (`ssr: false`) is served with
/// [`render_browser_shell`](crate::render_browser_shell).
///
/// ```no_run
/// use forma_server::{assets, IrModules, PageConfig};
/// use std::sync::Arc;
///
/// // At start, before the port binds: refuse to start on any error.
/// fn start<Assets: rust_embed::Embed>() -> Result<Arc<IrModules<Assets>>, String> {
///     let manifest = assets::try_load_manifest::<Assets>()?;
///     let modules = IrModules::<Assets>::load(&manifest).map_err(|errors| {
///         errors.iter().map(|e| e.to_string()).collect::<Vec<_>>().join("; ")
///     })?;
///     Ok(Arc::new(modules))
/// }
///
/// // Per request: hold the route's module for the render.
/// fn module<Assets: rust_embed::Embed>(modules: &IrModules<Assets>) -> Option<Arc<forma_ir::IrModule>> {
///     modules.get("/") // then `ir_module: module.as_deref()` in the PageConfig
/// }
/// ```
///
/// Verified by: crates/forma-server/tests/dev_reload.rs > "an_edited_page_is_served_on_the_next_request_and_a_broken_edit_keeps_the_previous_page"
/// Verified by: crates/forma-server/src/ir_compat.rs > "a_release_build_reads_nothing_per_request_and_a_debug_build_rereads"
pub struct IrModules<A> {
    modules: Modules,
    assets: PhantomData<fn() -> A>,
}

impl<A: Embed> IrModules<A> {
    /// Load every module the manifest declares, through the strict loader:
    /// the modules, or every failure, as [`load_ir_modules_strict`] returns
    /// them. Call it at start and refuse to start on `Err`.
    ///
    /// # Errors
    ///
    /// One [`IrLoadError`] per module that is not embedded or fails its
    /// check, naming route, file and code.
    pub fn load(manifest: &AssetManifest) -> Result<Self, Vec<IrLoadError>> {
        Ok(IrModules {
            modules: Modules::load(manifest, &embedded::<A>)?,
            assets: PhantomData,
        })
    }

    /// The route's module, or `None` for a route with none (a route the
    /// build declares `ssr: false`, or one the manifest never named). In a
    /// debug build, the module the build last wrote, if it loads; see the
    /// type's documentation.
    pub fn get(&self, route_pattern: &str) -> Option<Arc<IrModule>> {
        self.modules.get(route_pattern, &embedded::<A>)
    }
}

impl<A> fmt::Debug for IrModules<A> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("IrModules")
            .field("routes", &self.modules.routes())
            .finish()
    }
}

/// [`IrModules`]' state, apart from the `Embed` type, so a test can hand it
/// its own files.
struct Modules {
    #[cfg(not(debug_assertions))]
    by_route: HashMap<String, Arc<IrModule>>,
    #[cfg(debug_assertions)]
    dev: std::sync::Mutex<dev::Pages>,
}

impl Modules {
    fn load(manifest: &AssetManifest, read: Read<'_>) -> Result<Self, Vec<IrLoadError>> {
        let (_, loaded, errors) = load_from(manifest, read, false);
        if !errors.is_empty() {
            return Err(errors);
        }
        #[cfg(not(debug_assertions))]
        let modules = Modules {
            by_route: loaded
                .into_iter()
                .map(|l| (l.route, Arc::new(l.module)))
                .collect(),
        };
        #[cfg(debug_assertions)]
        let modules = Modules {
            dev: std::sync::Mutex::new(dev::Pages::new(manifest, loaded, read)),
        };
        Ok(modules)
    }

    /// A release build: the module loaded at start. `read` is not called.
    #[cfg(not(debug_assertions))]
    fn get(&self, route: &str, read: Read<'_>) -> Option<Arc<IrModule>> {
        let _ = read;
        self.by_route.get(route).cloned()
    }

    /// A debug build: the module the build last wrote, if it loads.
    #[cfg(debug_assertions)]
    fn get(&self, route: &str, read: Read<'_>) -> Option<Arc<IrModule>> {
        // Nothing panics while holding the lock; a poisoned state is still
        // the last good modules.
        let mut pages = self.dev.lock().unwrap_or_else(|p| p.into_inner());
        pages.get(route, read)
    }

    fn routes(&self) -> Vec<String> {
        #[cfg(not(debug_assertions))]
        let mut routes: Vec<String> = self.by_route.keys().cloned().collect();
        #[cfg(debug_assertions)]
        let mut routes = self.dev.lock().unwrap_or_else(|p| p.into_inner()).routes();
        routes.sort();
        routes
    }
}

/// The development reload (debug builds only).
#[cfg(debug_assertions)]
mod dev {
    use super::{check_module, Loaded, Read};
    use crate::AssetManifest;
    use forma_ir::parser::IrModule;
    use std::borrow::Cow;
    use std::collections::HashMap;
    use std::sync::Arc;

    /// What a debug build knows about the modules and the manifest.
    pub(super) struct Pages {
        /// `manifest.json` as last read, parsed or refused.
        manifest: Option<Vec<u8>>,
        /// Each route's module file, as the manifest last named it.
        names: HashMap<String, String>,
        /// Each route's module and what it was loaded from, or why not.
        pages: HashMap<String, Page>,
    }

    #[derive(Default)]
    struct Page {
        /// The module served, with the file and bytes it was parsed from.
        current: Option<(String, Cow<'static, [u8]>, Arc<IrModule>)>,
        /// The file and bytes last refused, so a broken write is logged once.
        refused: Option<(String, Option<Vec<u8>>)>,
    }

    impl Pages {
        pub(super) fn new(manifest: &AssetManifest, loaded: Vec<Loaded>, read: Read<'_>) -> Self {
            let names = manifest
                .routes
                .iter()
                .filter_map(|(route, assets)| Some((route.clone(), assets.ir.clone()?)))
                .collect();
            let pages = loaded
                .into_iter()
                .map(|l| {
                    let page = Page {
                        current: Some((l.ir_file, l.bytes, Arc::new(l.module))),
                        refused: None,
                    };
                    (l.route, page)
                })
                .collect();
            Pages {
                // The manifest on disk now is the baseline: a later change to
                // it is what a `get` looks for.
                manifest: read("manifest.json").map(Cow::into_owned),
                names,
                pages,
            }
        }

        pub(super) fn routes(&self) -> Vec<String> {
            self.pages
                .iter()
                .filter(|(_, p)| p.current.is_some())
                .map(|(r, _)| r.clone())
                .collect()
        }

        pub(super) fn get(&mut self, route: &str, read: Read<'_>) -> Option<Arc<IrModule>> {
            self.reread_manifest(read);
            let Some(file) = self.names.get(route).cloned() else {
                return self.current(route);
            };
            let bytes = read(&file);
            let page = self.pages.entry(route.to_string()).or_default();
            let unchanged = page
                .current
                .as_ref()
                .is_some_and(|(loaded_from, loaded, _)| {
                    *loaded_from == file && Some(loaded) == bytes.as_ref()
                });
            if unchanged {
                // The build wrote back what is served: a later refusal of
                // the same broken bytes is news again.
                page.refused = None;
                return page.current.as_ref().map(|(_, _, m)| Arc::clone(m));
            }
            let attempt = (file.clone(), bytes.as_deref().map(<[u8]>::to_vec));
            if page.refused.as_ref() == Some(&attempt) {
                // Refused and logged already; still the previous module.
                return page.current.as_ref().map(|(_, _, m)| Arc::clone(m));
            }
            match check_module(bytes.as_deref()) {
                Ok(module) => {
                    tracing::info!(
                        route,
                        ir_file = %file,
                        "Reloaded the IR module the build rewrote (development)"
                    );
                    page.current = Some((file, bytes.unwrap_or_default(), Arc::new(module)));
                    page.refused = None;
                }
                Err(refusal) => {
                    let error = refusal.error(route, &file);
                    tracing::warn!(
                        code = error.code().unwrap_or_default(),
                        route,
                        ir_file = %file,
                        "{error}; the previous module stays until the build writes one that \
                         loads (development reload)"
                    );
                    page.refused = Some(attempt);
                }
            }
            page.current.as_ref().map(|(_, _, m)| Arc::clone(m))
        }

        fn current(&self, route: &str) -> Option<Arc<IrModule>> {
            self.pages
                .get(route)
                .and_then(|p| p.current.as_ref())
                .map(|(_, _, m)| Arc::clone(m))
        }

        /// Take the module names from `manifest.json` when it changed. One the
        /// watch mode publishes is whole (it is replaced by rename); one that
        /// does not parse keeps the names and is logged once.
        fn reread_manifest(&mut self, read: Read<'_>) {
            let Some(bytes) = read("manifest.json") else {
                return;
            };
            if self.manifest.as_deref() == Some(&bytes[..]) {
                return;
            }
            match serde_json::from_slice::<AssetManifest>(&bytes) {
                Ok(manifest) => {
                    for (route, assets) in manifest.routes {
                        if let Some(ir) = assets.ir {
                            self.names.insert(route, ir);
                        }
                    }
                }
                Err(e) => tracing::warn!(
                    "manifest.json does not parse ({e}); the module names stay as they were \
                     (development reload)"
                ),
            }
            self.manifest = Some(bytes.into_owned());
        }
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

/// [`IrModules`]' reload, over files a test controls: the reader is the
/// file-system boundary rust-embed reads in a debug build.
#[cfg(test)]
mod reload_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    /// The files rust-embed would read, and how many reads it was asked for.
    #[derive(Default)]
    struct Disk {
        files: Mutex<HashMap<String, Vec<u8>>>,
        reads: AtomicUsize,
    }

    impl Disk {
        fn write(&self, name: &str, bytes: Vec<u8>) {
            self.files
                .lock()
                .expect("lock")
                .insert(name.to_string(), bytes);
        }
        fn remove(&self, name: &str) {
            self.files.lock().expect("lock").remove(name);
        }
        fn read(&self, name: &str) -> Option<Cow<'static, [u8]>> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.files
                .lock()
                .expect("lock")
                .get(name)
                .cloned()
                .map(Cow::Owned)
        }
        fn reads(&self) -> usize {
            self.reads.load(Ordering::SeqCst)
        }
    }

    /// A module rendering `<p>{text}</p>`.
    fn page(text: &str) -> Vec<u8> {
        use forma_ir::parser::test_helpers::{
            build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
        };
        let mut ops = encode_open_tag(0, &[]);
        ops.extend_from_slice(&encode_text(1));
        ops.extend_from_slice(&encode_close_tag(0));
        build_minimal_ir(&["p", text], &[], &ops, &[])
    }

    fn html(module: Option<Arc<IrModule>>) -> String {
        let module = module.expect("a module");
        forma_ir::walk_to_html(&module, &forma_ir::SlotData::new(0)).expect("walks")
    }

    /// The manifest JSON naming each route's module (`None`: no module).
    fn manifest_json(routes: &[(&str, Option<&str>)]) -> Vec<u8> {
        let routes: serde_json::Map<String, serde_json::Value> = routes
            .iter()
            .map(|(route, ir)| {
                let mut assets = serde_json::json!({
                    "js": ["app.js"], "css": [], "fonts": [],
                    "total_size_br": 0, "budget_warn_threshold": 0
                });
                if let Some(ir) = ir {
                    assets["ir"] = (*ir).into();
                }
                (route.to_string(), assets)
            })
            .collect();
        serde_json::json!({"version": 1, "build_hash": "dev", "assets": {}, "routes": routes})
            .to_string()
            .into_bytes()
    }

    /// The disk with `/` naming `page.ir` and `/app` naming none, and the
    /// manifest the application read from it at start.
    fn started(first: &str) -> (Disk, AssetManifest) {
        let disk = Disk::default();
        let json = manifest_json(&[("/", Some("page.ir")), ("/app", None)]);
        disk.write("manifest.json", json.clone());
        disk.write("page.ir", page(first));
        let manifest = serde_json::from_slice(&json).expect("manifest");
        (disk, manifest)
    }

    #[test]
    fn a_release_build_reads_nothing_per_request_and_a_debug_build_rereads() {
        let (disk, manifest) = started("first");
        let read = |name: &str| disk.read(name);
        let modules = Modules::load(&manifest, &read).expect("loads");
        let after_load = disk.reads();
        assert!(after_load >= 1, "the start reads the module");

        for _ in 0..3 {
            assert_eq!(html(modules.get("/", &read)), "<p>first</p>");
        }
        assert!(
            modules.get("/app", &read).is_none(),
            "a route with no module"
        );
        // The build rewrites the page's module.
        disk.write("page.ir", page("second"));
        let served = html(modules.get("/", &read));

        if cfg!(debug_assertions) {
            assert_eq!(
                served, "<p>second</p>",
                "debug: the next get serves the rewrite"
            );
            // Each get reads the manifest and the route's module, if it has one.
            assert_eq!(disk.reads(), after_load + 3 * 2 + 1 + 2);
        } else {
            assert_eq!(
                served, "<p>first</p>",
                "release: the module loaded at start"
            );
            assert_eq!(disk.reads(), after_load, "release: no read after start");
        }
    }

    #[test]
    fn the_reload_loads_through_the_strict_loader_at_start() {
        // A bad module at start is a refused start, in every build, with the
        // strict loader's codes.
        let (disk, manifest) = started("first");
        let mut flipped = page("first");
        flipped[0] ^= 0xFF;
        disk.write("page.ir", flipped);
        let read = |name: &str| disk.read(name);
        let errors = Modules::load(&manifest, &read).err().expect("refused");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].route, "/");
        assert_eq!(errors[0].ir_file, "page.ir");
        assert_eq!(errors[0].code(), Some("LOAD-102"));
        disk.remove("page.ir");
        let errors = Modules::load(&manifest, &read).err().expect("refused");
        assert_eq!(errors[0].code(), Some("LOAD-101"));
    }

    #[cfg(debug_assertions)]
    mod development {
        use super::*;
        use tracing::field::{Field, Visit};
        use tracing::span::{Attributes, Id, Record};
        use tracing::{Event, Metadata, Subscriber};

        /// The warnings logged, as (code, message).
        #[derive(Clone, Default)]
        struct Warnings(Arc<Mutex<Vec<(String, String)>>>);

        impl Subscriber for Warnings {
            fn enabled(&self, _: &Metadata<'_>) -> bool {
                true
            }
            fn new_span(&self, _: &Attributes<'_>) -> Id {
                Id::from_u64(1)
            }
            fn record(&self, _: &Id, _: &Record<'_>) {}
            fn record_follows_from(&self, _: &Id, _: &Id) {}
            fn event(&self, event: &Event<'_>) {
                #[derive(Default)]
                struct Fields(String, String);
                impl Visit for Fields {
                    fn record_str(&mut self, field: &Field, value: &str) {
                        if field.name() == "code" {
                            self.0 = value.to_string();
                        }
                    }
                    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                        if field.name() == "message" {
                            self.1 = format!("{value:?}");
                        }
                    }
                }
                if *event.metadata().level() == tracing::Level::WARN {
                    let mut fields = Fields::default();
                    event.record(&mut fields);
                    self.0.lock().expect("lock").push((fields.0, fields.1));
                }
            }
            fn enter(&self, _: &Id) {}
            fn exit(&self, _: &Id) {}
        }

        impl Warnings {
            fn codes(&self) -> Vec<String> {
                self.0
                    .lock()
                    .expect("lock")
                    .iter()
                    .map(|(c, _)| c.clone())
                    .collect()
            }
        }

        #[test]
        fn a_module_that_fails_to_load_keeps_the_previous_one_and_is_logged_once_with_its_code() {
            let (disk, manifest) = started("first");
            let read = |name: &str| disk.read(name);
            let modules = Modules::load(&manifest, &read).expect("loads");
            let warnings = Warnings::default();
            tracing::subscriber::with_default(warnings.clone(), || {
                // A truncated module: refused, the previous one served, one
                // warning however many requests read it.
                let good = page("second");
                disk.write("page.ir", good[..good.len() - 3].to_vec());
                for _ in 0..3 {
                    assert_eq!(html(modules.get("/", &read)), "<p>first</p>");
                }
                assert_eq!(warnings.codes(), ["LOAD-103"]);
                let (_, message) = warnings.0.lock().expect("lock")[0].clone();
                assert!(
                    message.contains("route /: IR file page.ir: LOAD-103"),
                    "{message}"
                );
                assert!(message.contains("the previous module stays"), "{message}");

                // Not a module at all (bad magic): its own code, once.
                let mut magic = page("second");
                magic[0] ^= 0xFF;
                disk.write("page.ir", magic.clone());
                for _ in 0..3 {
                    assert_eq!(html(modules.get("/", &read)), "<p>first</p>");
                }
                // Deleted: LOAD-101, once.
                disk.remove("page.ir");
                for _ in 0..3 {
                    assert_eq!(html(modules.get("/", &read)), "<p>first</p>");
                }
                assert_eq!(warnings.codes(), ["LOAD-103", "LOAD-102", "LOAD-101"]);

                // The next good write is served...
                disk.write("page.ir", page("second"));
                assert_eq!(html(modules.get("/", &read)), "<p>second</p>");
                // ...and breaking it the same way again is news again.
                disk.write("page.ir", magic.clone());
                assert_eq!(html(modules.get("/", &read)), "<p>second</p>");
                assert_eq!(
                    warnings.codes(),
                    ["LOAD-103", "LOAD-102", "LOAD-101", "LOAD-102"]
                );
                // So is the same break after the build wrote back the module
                // being served (an undo), which reloads nothing.
                disk.write("page.ir", page("second"));
                assert_eq!(html(modules.get("/", &read)), "<p>second</p>");
                disk.write("page.ir", magic);
                assert_eq!(html(modules.get("/", &read)), "<p>second</p>");
                assert_eq!(
                    warnings.codes(),
                    ["LOAD-103", "LOAD-102", "LOAD-101", "LOAD-102", "LOAD-102"]
                );
            });
        }

        #[test]
        fn the_manifest_can_rename_a_module_or_name_a_new_one_and_a_bad_one_changes_nothing() {
            let (disk, manifest) = started("first");
            let read = |name: &str| disk.read(name);
            let modules = Modules::load(&manifest, &read).expect("loads");
            assert!(modules.get("/late", &read).is_none());
            let warnings = Warnings::default();
            tracing::subscriber::with_default(warnings.clone(), || {
                // A rebuilt production manifest: new names for both pages,
                // and a route that had no module now has one.
                disk.write("page.2.ir", page("renamed"));
                disk.write("late.ir", page("late"));
                disk.write(
                    "manifest.json",
                    manifest_json(&[("/", Some("page.2.ir")), ("/late", Some("late.ir"))]),
                );
                assert_eq!(html(modules.get("/", &read)), "<p>renamed</p>");
                assert_eq!(html(modules.get("/late", &read)), "<p>late</p>");
                assert!(warnings.codes().is_empty());

                // A manifest that does not parse: logged once, names kept.
                disk.write("manifest.json", b"{\"routes\":".to_vec());
                for _ in 0..3 {
                    assert_eq!(html(modules.get("/", &read)), "<p>renamed</p>");
                }
                let logged = warnings.0.lock().expect("lock").clone();
                assert_eq!(logged.len(), 1, "{logged:?}");
                assert!(
                    logged[0].1.contains("manifest.json does not parse"),
                    "{logged:?}"
                );

                // A manifest that stops naming a route's module: the last
                // module stays.
                disk.write("manifest.json", manifest_json(&[("/", None)]));
                assert_eq!(html(modules.get("/", &read)), "<p>renamed</p>");
                assert_eq!(html(modules.get("/late", &read)), "<p>late</p>");
            });
        }
    }
}
