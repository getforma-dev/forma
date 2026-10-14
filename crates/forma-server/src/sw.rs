//! The service worker: opt-in, per application, and retired everywhere else
//! (DR-25, Q15, M25).
//!
//! # The setting
//!
//! A worker is an application's choice, made once at start, before the first
//! page renders and before `/sw.js` is served:
//!
//! ```no_run
//! use forma_server::sw::{self, ServiceWorker};
//!
//! // Ledger: pages register /sw.js, which serves the worker its build wrote.
//! sw::configure(ServiceWorker::for_app("ledger")?.enabled())?;
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! Left unconfigured, the setting is [`ServiceWorker::off`]: no page registers
//! a worker, and `/sw.js` serves the *retiring worker* in place of whatever
//! the build embedded. A browser that installed a worker from an earlier
//! release checks `/sw.js` for an update on its next visits, receives the
//! retiring worker, which deletes Forma's caches and unregisters, and from then
//! on loads every page and asset from the network. This is the kill switch
//! that keeps DR-25's door two-way; it is served through 3.x.
//!
//! Rolling back an application's worker is turning `.enabled()` off and
//! keeping the name: its retiring worker then deletes that application's own
//! caches too. Turning it back on re-installs the worker on the next visit.
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
//!   `build_hash`) and carries no `:`. The `forma:` prefix (a colon, not v1's
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
//!   `skipWaiting()`, since it serves nothing a waiting tab could lose.
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
pub fn configure(worker: ServiceWorker) -> Result<(), AlreadyConfigured> {
    let mut offered = Some(worker);
    let current = SETTING.get_or_init(|| offered.take().unwrap_or_default());
    match offered {
        None => Ok(()),
        Some(_) => Err(AlreadyConfigured {
            current: current.clone(),
        }),
    }
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
        r#"// forma-server: the retiring service worker (DR-25, M25).
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
            None => return axum::http::StatusCode::NOT_FOUND.into_response(),
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
        for name in ["ledger", "ksx-studio", "app2", "9lives", &"a".repeat(63)] {
            let worker = ServiceWorker::for_app(name).unwrap();
            assert_eq!(worker.app(), Some(name));
            assert!(!worker.is_enabled(), "naming does not turn it on");
            assert!(worker.enabled().is_enabled());
        }
        for name in [
            "",
            "Ledger",
            "-ledger",
            "led ger",
            "led:ger",
            "led\"ger",
            "led'ger",
            "led\\ger",
            "ledger\n",
            "lédger",
            "led_ger",
            "led.ger",
            &"a".repeat(64),
        ] {
            let error = ServiceWorker::for_app(name).expect_err(name);
            assert!(error.to_string().contains(&format!("{name:?}")), "{error}");
        }
    }

    #[test]
    fn the_retiring_worker_deletes_v1_s_caches_and_its_own_never_another_s() {
        // The worker's behaviour, run by Node in a stand-in service-worker
        // scope over the contract's cache-name vectors. Node (18 or later) is
        // required: a missing `node` fails this test, it does not skip it.
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/js/retiring_worker.mjs");
        let output = std::process::Command::new("node")
            .arg("--test")
            .arg(script)
            .env("FORMA_RETIRING_UNNAMED", retiring_worker(None))
            .env("FORMA_RETIRING_LEDGER", retiring_worker(Some("ledger")))
            .output()
            .unwrap_or_else(|e| panic!("this test runs the worker in Node 18+, not found: {e}"));
        let report = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.status.success(), "{report}");
        // node --test reports its own count; all of them ran and passed.
        assert!(report.contains("# pass 7"), "{report}");
        assert!(report.contains("# fail 0"), "{report}");
    }
}
