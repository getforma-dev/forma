//! The service worker: opt-in, per application, and retired everywhere else.
//!
//! # The setting
//!
//! A worker is an application's choice, made once at start, before the first
//! page renders and before `/sw.js` is served:
//!
//! ```no_run
//! use forma_server::sw::{self, ServiceWorker};
//!
//! // Ledger: pages with JS entries register /sw.js, which serves the built worker.
//! // After loading and validating the manifest, before binding:
//! # fn startup(manifest: &forma_server::AssetManifest) -> Result<(), Box<dyn std::error::Error>> {
//! sw::configure_for_manifest(ServiceWorker::for_app("ledger")?.enabled(), manifest)?;
//! # Ok(())
//! # }
//! ```
//!
//! Left unconfigured, the setting is [`ServiceWorker::off`]: no page registers
//! a worker, and `/sw.js` serves the *retiring worker* in place of whatever
//! the build embedded. A browser that installed a worker from an earlier
//! release checks `/sw.js` for an update on its next visits, receives the
//! retiring worker, which deletes Forma's caches and unregisters, and from then
//! on loads every page and asset from the network. This is the kill switch
//! that keeps turning the worker on a two-way door; it is served through 3.x.
//!
//! Static SSR pages emit no registration even when this setting is enabled.
//! A static-only app therefore does not newly install a worker. Existing clients
//! may still check the unchanged endpoint through the browser's worker lifecycle.
//!
//! Rolling back an application's worker is turning `.enabled()` off and
//! keeping the name: its retiring worker then deletes that application's own
//! caches too. Turning it back on re-installs it on the next JS-enabled page visit.
//!
//! # The cache-name contract (forma-server 0.2.2, `@getforma/build` 0.3.1)
//!
//! The build writes the production worker and the cache names; forma-server
//! writes the registration and the retiring worker. They meet here:
//!
//! - **Application name**: 1 to 63 of `a-z`, `0-9` and `-`, starting with a
//!   letter or digit; the same string in the build's configuration and in
//!   [`ServiceWorker::for_app`].
//! - **Cache name**: `forma:<app>:<build>`, where `<build>` is the build's
//!   identity as the build writes it (today the first 12 hex digits of
//!   `build`) and carries no `:`. The `forma:` prefix (a colon, not v1's
//!   hyphen) is new, so no v1 or 0.3.0 worker, all of which delete `forma-`
//!   names, ever deletes one.
//! - **v1's names** (builds up to 0.3.0): `forma-dev`, `forma-` and 12
//!   lowercase hex digits, and either with `-on-demand-v1`; exactly
//!   `^forma-(?:dev|[0-9a-f]{12})(?:-on-demand-v1)?$`. They cannot be traced
//!   to an application, so every Forma worker retires them.
//! - **The production worker** of application `X` reads only its own cache,
//!   and on activation deletes v1's names and `forma:X:` caches other than its
//!   own; never another application's (`forma:Y:`, `forma:Xy:`) and never a
//!   cache outside these patterns. It calls neither `skipWaiting()` nor
//!   `clients.claim()`: a new worker waits until the previous one controls no
//!   tab.
//! - **The retiring worker** deletes v1's names and, for a named application,
//!   `forma:X:` caches; then unregisters. It answers no request. It does call
//!   `skipWaiting()`, as a kill switch must: an open tab of the old build is
//!   handed to it at once and loses the old worker's cache, so its requests go
//!   to the network (and to the skew path if its build's assets are gone).
//!   That is the trade made on purpose: a planted entry stops being served from
//!   the navigation after the browser's update check, not when the last old
//!   tab closes.
//!
//! # One origin, one setting
//!
//! `/sw.js` and its scope `/` belong to the origin, so every process serving
//! one origin must agree on the setting: during a rolling deploy from 0.2.1 a
//! browser can alternate between registering and retiring until every
//! instance runs the new release; and of two applications behind one proxy on
//! one origin, only one can enable the worker, under its own name.
//!
//! `tests/js/retiring_worker.mjs` holds the contract's vectors as a table;
//! the build's tests are to share them.

use axum::{
    http::header,
    response::{IntoResponse, Response},
};
use rust_embed::Embed;
use std::fmt;
use std::sync::OnceLock;

/// An application's service-worker setting. See the [module docs](self).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServiceWorker {
    app: Option<String>,
    enabled: bool,
}

impl ServiceWorker {
    /// The default: no page registers a worker, and `/sw.js` is the retiring
    /// worker for v1's cache names.
    pub fn off() -> Self {
        Self::default()
    }

    /// Name the application, still off: `/sw.js` is the retiring worker,
    /// which also deletes this application's own caches (`forma:<app>:...`).
    /// Add [`ServiceWorker::enabled`] to turn the worker on.
    ///
    /// # Errors
    ///
    /// An [`AppNameError`] unless `app` is 1 to 63 of `a-z`, `0-9` and `-`,
    /// starting with a letter or digit.
    pub fn for_app(app: &str) -> Result<Self, AppNameError> {
        let mut bytes = app.bytes();
        let valid = !app.is_empty()
            && app.len() <= 63
            && matches!(bytes.next(), Some(b) if b.is_ascii_lowercase() || b.is_ascii_digit())
            && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if valid {
            Ok(ServiceWorker {
                app: Some(app.to_string()),
                enabled: false,
            })
        } else {
            Err(AppNameError {
                name: app.to_string(),
            })
        }
    }

    /// Turn the worker on: every page registers `/sw.js`, and `/sw.js`
    /// serves the worker the build embedded.
    #[must_use]
    pub fn enabled(mut self) -> Self {
        self.enabled = true;
        self
    }

    /// Whether pages register the worker.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// The application's name, if it gave one.
    pub fn app(&self) -> Option<&str> {
        self.app.as_deref()
    }
}

/// An application name the cache-name contract cannot carry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppNameError {
    name: String,
}

impl fmt::Display for AppNameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid service-worker application name {:?}: use 1 to 63 of a-z, 0-9 and -, \
             starting with a letter or digit",
            self.name
        )
    }
}

impl std::error::Error for AppNameError {}

/// [`configure`] was called after the setting was fixed: by an earlier
/// `configure`, or by the first page or `/sw.js` request, which read the
/// default.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlreadyConfigured {
    current: ServiceWorker,
}

impl AlreadyConfigured {
    /// The setting in force, which stays.
    pub fn current(&self) -> &ServiceWorker {
        &self.current
    }
}

impl fmt::Display for AlreadyConfigured {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "the service-worker setting is already fixed ({:?}); configure it once, at start, \
             before the first page renders",
            self.current
        )
    }
}

impl std::error::Error for AlreadyConfigured {}

static SETTING: OnceLock<ServiceWorker> = OnceLock::new();

/// Fix this process's service-worker setting. Call it once, at start, before
/// the first page renders and before `/sw.js` is served.
///
/// One setting per process, because `/sw.js` is one URL per origin and every
/// page's registration must agree with what that URL serves.
///
/// # Errors
///
/// [`AlreadyConfigured`] if it was set before, or if a render or `/sw.js`
/// already read the default; the setting in force stays.
fn set(worker: ServiceWorker) -> Result<(), AlreadyConfigured> {
    let mut offered = Some(worker);
    let current = SETTING.get_or_init(|| offered.take().unwrap_or_default());
    match offered {
        None => Ok(()),
        Some(_) => Err(AlreadyConfigured {
            current: current.clone(),
        }),
    }
}

/// A refused startup setting; the current setting is never changed on error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigureError {
    /// A page/request or earlier configuration already fixed the process setting.
    AlreadyConfigured(AlreadyConfigured),
    /// An enabled worker needs a validated application manifest.
    ManifestRequired,
    /// The manifest fails its common schema or version checks.
    InvalidManifest(String),
    /// The worker was configured for a different application.
    ApplicationMismatch {
        /// Application written by the build.
        manifest: String,
        /// Application explicitly chosen for the worker.
        worker: String,
    },
}
impl ConfigureError {
    /// Existing setting, if a prior configuration caused this refusal.
    pub fn current(&self) -> Option<&ServiceWorker> {
        match self {
            Self::AlreadyConfigured(e) => Some(e.current()),
            _ => None,
        }
    }
}
impl fmt::Display for ConfigureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyConfigured(e)=>e.fmt(f),
            Self::ManifestRequired=>f.write_str("enabled service worker requires configure_for_manifest(worker, &manifest) before binding"),
            Self::InvalidManifest(e)=>f.write_str(e),
            Self::ApplicationMismatch{manifest,worker}=>write!(f,"MANIFEST-104 manifest application {manifest:?} differs from worker for_app {worker:?}"),
        }
    }
}
impl std::error::Error for ConfigureError {}

/// Configure an off worker at startup. Enabled workers require
/// [`configure_for_manifest`] so application identity is checked before binding.
pub fn configure(worker: ServiceWorker) -> Result<(), ConfigureError> {
    if let Some(current) = SETTING.get() {
        return Err(ConfigureError::AlreadyConfigured(AlreadyConfigured {
            current: current.clone(),
        }));
    }
    if worker.is_enabled() {
        return Err(ConfigureError::ManifestRequired);
    }
    set(worker).map_err(ConfigureError::AlreadyConfigured)
}

/// Validate the manifest and match an enabled worker's application before fixing
/// the setting. Call at startup and refuse to bind on error. Validation does not
/// read `configured()` or seal an unconfigured process's default.
pub fn configure_for_manifest(
    worker: ServiceWorker,
    manifest: &crate::AssetManifest,
) -> Result<(), ConfigureError> {
    manifest
        .validate()
        .map_err(ConfigureError::InvalidManifest)?;
    if worker.is_enabled() && worker.app() != Some(manifest.app.as_str()) {
        return Err(ConfigureError::ApplicationMismatch {
            manifest: manifest.app.clone(),
            worker: worker.app().unwrap_or_default().to_string(),
        });
    }
    set(worker).map_err(ConfigureError::AlreadyConfigured)
}

/// Check a reload against an already enabled worker without fixing defaults.
pub(crate) fn validate_manifest_app(manifest: &crate::AssetManifest) -> Result<(), String> {
    if let Some(worker) = SETTING.get().filter(|w| w.is_enabled()) {
        if worker.app() != Some(manifest.app.as_str()) {
            return Err(ConfigureError::ApplicationMismatch {
                manifest: manifest.app.clone(),
                worker: worker.app().unwrap_or_default().into(),
            }
            .to_string());
        }
    }
    Ok(())
}

/// This process's setting: what [`configure`] set, or [`ServiceWorker::off`].
/// Reading it fixes it.
pub fn configured() -> &'static ServiceWorker {
    SETTING.get_or_init(ServiceWorker::off)
}

/// The registration a page carries when the worker is on: the 0.2.1 script,
/// nonced.
pub(crate) fn registration_script(nonce: &str) -> String {
    if configured().is_enabled() {
        format!(
            "<script nonce=\"{nonce}\">if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');</script>\n"
        )
    } else {
        String::new()
    }
}

/// The retiring worker's source, for `app` (or for no application).
///
/// `app` has passed [`ServiceWorker::for_app`], so it holds only `a-z`, `0-9`
/// and `-`, and writing it into a JavaScript string needs no escaping.
pub(crate) fn retiring_worker(app: Option<&str>) -> String {
    let own = match app {
        Some(app) => format!("\"forma:{app}:\""),
        None => "null".to_string(),
    };
    format!(
        r#"// forma-server: the retiring service worker.
// It deletes Forma's v1 caches and this application's own, never another
// application's, then unregisters. It answers no request, so every page and
// asset loads from the network.
const LEGACY = /^forma-(?:dev|[0-9a-f]{{12}})(?:-on-demand-v1)?$/;
const OWN = {own};

self.addEventListener('install', (event) => {{
  event.waitUntil(self.skipWaiting());
}});

self.addEventListener('activate', (event) => {{
  event.waitUntil((async () => {{
    try {{
      const names = await caches.keys();
      await Promise.all(names
        .filter((name) => LEGACY.test(name) || (OWN !== null && name.startsWith(OWN)))
        .map((name) => caches.delete(name)));
    }} catch (error) {{
      // Storage may be unavailable (private browsing, quota); retire anyway.
    }}
    await self.registration.unregister();
  }})());
}});
"#
    )
}

/// The worker is on, but the build embedded no `sw.js`: pages register a
/// worker that cannot install, and a browser keeps any worker it already had
/// (as at 0.2.1). Said once per process, at the first such `/sw.js` request,
/// the first point at which the embedded set is known.
///
/// Verified by: crates/forma-server/tests/service_worker_on.rs > "an_enabled_application_with_no_built_worker_is_told_once"
fn warn_enabled_without_worker_once() {
    use std::sync::atomic::{AtomicBool, Ordering};
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::Relaxed) {
        tracing::warn!(
            "the service worker is enabled (forma_server::sw::configure) but the build \
             embedded no sw.js: /sw.js answers 404 and pages register a worker that cannot \
             install. Build with @getforma/build's `app` (0.3.1) and a `serviceWorker` mode, \
             or turn the worker off."
        );
    }
}

/// Axum handler: serve `/sw.js` with no-cache headers.
///
/// Mount at `/sw.js` in your router. With the worker [enabled](ServiceWorker::enabled)
/// it serves the `sw.js` the build embedded (404 if there is none). Otherwise,
/// the default from 0.2.2, it serves the retiring worker, whatever the build
/// embedded (see the [module docs](self)).
///
/// Verified by: crates/forma-server/tests/service_worker_off.rs > "by_default_sw_js_is_the_retiring_worker_even_with_a_built_worker_embedded"
/// Verified by: crates/forma-server/tests/service_worker_on.rs > "an_enabled_application_serves_its_built_worker"
pub async fn serve_sw<A: Embed>() -> Response {
    let setting = configured();
    let body = if setting.is_enabled() {
        match crate::assets::asset_bytes::<A>("sw.js") {
            Some(data) => axum::body::Body::from(data),
            None => {
                warn_enabled_without_worker_once();
                return axum::http::StatusCode::NOT_FOUND.into_response();
            }
        }
    } else {
        axum::body::Body::from(retiring_worker(setting.app()))
    };
    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, "text/javascript; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
        .header("service-worker-allowed", "/");
    // The service worker is the highest-value script on the origin;
    // it must not be sniffable into another type.
    for (name, value) in crate::types::asset_security_headers() {
        builder = builder.header(name, value);
    }
    // Static headers cannot fail to parse; if one ever did, answer 500 rather
    // than panic or send the worker without its headers.
    match builder.body(body) {
        Ok(response) => response.into_response(),
        Err(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_embed::Embed;

    #[derive(Embed)]
    #[folder = "test_fixtures/"]
    struct Fixtures;

    #[tokio::test]
    async fn serve_sw_sets_nosniff_and_no_store() {
        let response = serve_sw::<Fixtures>().await;
        let headers = response.headers();
        assert_eq!(
            headers
                .get("x-content-type-options")
                .map(|v| v.to_str().unwrap()),
            Some("nosniff"),
            "the service worker must not be sniffable into another type"
        );
        assert_eq!(
            headers
                .get(header::CONTENT_TYPE)
                .map(|v| v.to_str().unwrap()),
            Some("text/javascript; charset=utf-8")
        );
        assert!(headers
            .get(header::CACHE_CONTROL)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("no-store"));
    }

    #[test]
    fn application_names_are_what_a_cache_name_can_carry() {
        // The grammar as data, shared with @getforma/build's `app` (copied into
        // forma-tools' `packages/build/tests/helpers/app-name-vectors.ts`): the
        // two must accept exactly the same names, edges included.
        let table: serde_json::Value =
            serde_json::from_str(include_str!("../tests/js/app_name_vectors.json"))
                .expect("the shared table is JSON");
        let names = |key: &str| -> Vec<String> {
            table[key]
                .as_array()
                .expect("a list")
                .iter()
                .map(|v| v.as_str().expect("a name").to_string())
                .collect()
        };
        let (accepted, refused) = (names("accepted"), names("refused"));
        // The edges the review found unpinned are in the table.
        for edge in ["ledger-", "a", "0", "123", "a--b"] {
            assert!(accepted.iter().any(|n| n == edge), "{edge}");
        }
        for name in &accepted {
            let worker = ServiceWorker::for_app(name).unwrap_or_else(|e| panic!("{e}"));
            assert_eq!(worker.app(), Some(name.as_str()));
            assert!(!worker.is_enabled(), "naming does not turn it on");
            assert!(worker.enabled().is_enabled());
        }
        for name in &refused {
            let error = ServiceWorker::for_app(name).expect_err(name);
            assert!(error.to_string().contains(&format!("{name:?}")), "{error}");
        }
        assert!(refused.len() >= 29, "the hostile names are all there");
    }

    #[test]
    fn the_retiring_worker_deletes_v1_s_caches_and_its_own_never_another_s() {
        // The worker's behaviour, run by Node in a stand-in service-worker
        // scope over the contract's cache-name vectors. Node (18 or later) is
        // required: a missing `node` fails this test, it does not skip it.
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/js/retiring_worker.mjs");
        // The script writes how many tests passed here, so this check does not
        // read Node's reporter output (which NODE_OPTIONS can change).
        let count_file = std::env::temp_dir().join(format!(
            "forma-retiring-worker-{}-{:?}.txt",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_file(&count_file);
        let output = std::process::Command::new("node")
            .arg("--test")
            .arg(script)
            .env("FORMA_RETIRING_UNNAMED", retiring_worker(None))
            .env("FORMA_RETIRING_LEDGER", retiring_worker(Some("ledger")))
            .env("FORMA_RETIRING_REPORT", &count_file)
            .output()
            .unwrap_or_else(|e| panic!("this test runs the worker in Node 18+, not found: {e}"));
        let report = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.status.success(), "{report}");
        let passed = std::fs::read_to_string(&count_file)
            .unwrap_or_else(|e| panic!("the script reported no count ({e}):\n{report}"));
        let _ = std::fs::remove_file(&count_file);
        // One hand-over check, then three checks for each of the two sources.
        assert_eq!(passed, "7", "{report}");
    }
}
