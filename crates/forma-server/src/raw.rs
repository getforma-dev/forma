//! Raw HTML: markup forma-server writes into the page exactly as it is given.
//!
//! Every other value a page carries is escaped for its context. The one place
//! a handler's own markup reaches the page unescaped is
//! [`PageConfig::body_prefix`](crate::PageConfig::body_prefix), and the one
//! way to say that a string is such markup is [`RawHtml::trusted`]. The name
//! is the control: a reviewer, or a consumer's CI (`forma-raw-lint`), finds
//! every raw entry in an application by searching for `RawHtml::trusted`, and
//! nothing else in this crate makes a `RawHtml`.
//!
//! # The 0.2.2 bridge
//!
//! In 0.2.x `body_prefix` is still an `Option<&str>`, so every 0.2.1 call keeps
//! compiling. A `RawHtml` goes into it as `Some(&raw)`: it dereferences to the
//! markup, so the field takes it as it is, and the same line compiles in 3.0.0,
//! where the field takes only a `RawHtml`. Bind the value first
//! (`let raw = RawHtml::trusted(..);`): written inline,
//! `Some(&RawHtml::trusted(..))` borrows a temporary that Rust 1.85,
//! forma-server's MSRV, drops at the end of the `let config = PageConfig {
//! .. };` statement, so it does not compile there (E0716); newer compilers
//! extend the temporary, which hides the problem. A plain string still works and is
//! written exactly as before; in a debug build the first one a process renders
//! logs one warning, code `RAW-101`, naming the route:
//!
//! | Code | Where | Cause |
//! |---|---|---|
//! | RAW-101 | `PageConfig::body_prefix` | A plain string, not a `RawHtml`, in a debug build |
//!
//! To tell the two apart, a debug build keeps the address and length of every
//! live `RawHtml`'s markup, and a `body_prefix` that points at exactly one of
//! them is that `RawHtml`. A release build keeps no record and checks nothing:
//! it writes the field exactly as 0.2.1 did.

use std::fmt;
use std::ops::Deref;

/// Markup a handler vouches for, written into the page unescaped.
///
/// Made only by [`RawHtml::trusted`]: there is no `From`, `Default` or
/// `FromStr`, and its field is private, so the constructor's name is in every
/// line that makes one.
///
/// ```
/// use forma_server::RawHtml;
///
/// // GateWASM's tenant logo, escaped by the handler before it is vouched for.
/// let logo = RawHtml::trusted(format!("<img src=\"{}\" alt=\"\">", "/_assets/logo.svg"));
/// assert_eq!(&*logo, "<img src=\"/_assets/logo.svg\" alt=\"\">");
/// ```
///
/// Nothing turns a string into one by conversion:
///
/// ```compile_fail,E0277
/// let raw: forma_server::RawHtml = String::from("<b>x</b>").into();
/// ```
///
/// ```compile_fail,E0277
/// let raw: forma_server::RawHtml = "<b>x</b>".into();
/// ```
///
/// ```compile_fail,E0277
/// let raw: forma_server::RawHtml = "<b>x</b>".parse().unwrap();
/// ```
///
/// ```compile_fail,E0599
/// let raw = forma_server::RawHtml::default();
/// ```
///
/// ```compile_fail,E0451
/// let raw = forma_server::RawHtml { html: "<b>x</b>".into() };
/// ```
///
/// Passing it to `body_prefix`, which in 0.2.x is an `Option<&str>`:
///
/// ```
/// use forma_server::{render_browser_shell, AssetManifest, PageConfig, RawHtml, RenderCtx, RenderMode};
///
/// # fn page(manifest: &AssetManifest) {
/// let shell = RawHtml::trusted("<main id=\"studio\"></main>");
/// # #[allow(deprecated)]
/// let config = PageConfig {
///     title: "Studio",
///     route_pattern: "/",
///     manifest,
///     config_script: None,
///     config_json: None,
///     body_class: None,
///     personality_css: None,
///     body_prefix: Some(&shell), // compiles in 0.2.2 and in 3.0.0
///     render_mode: RenderMode::Phase1ClientMount,
///     ir_module: None,
///     slots: None,
/// };
/// let page = render_browser_shell(&config, &RenderCtx::new());
/// # let _ = page;
/// # }
/// ```
///
/// Verified by: crates/forma-server/tests/raw_html.rs > "a_search_finds_one_raw_constructor"
pub struct RawHtml {
    html: Box<str>,
}

impl RawHtml {
    /// Vouch for `html`: forma-server writes it into the page as it is.
    ///
    /// Whatever reaches the markup is trusted. Escape any value from a
    /// request, a database or a tenant before it goes in, or render it
    /// through a component instead, where the walker escapes it for you.
    /// Each call belongs on the application's raw-entry allowlist
    /// (`forma-raw-lint`) with an owner.
    pub fn trusted(html: impl Into<String>) -> RawHtml {
        let html = html.into().into_boxed_str();
        provenance::remember(&html);
        RawHtml { html }
    }

    /// The markup.
    pub fn as_str(&self) -> &str {
        &self.html
    }
}

impl Deref for RawHtml {
    type Target = str;

    fn deref(&self) -> &str {
        &self.html
    }
}

impl Clone for RawHtml {
    fn clone(&self) -> Self {
        // Through the constructor, so the copy is remembered too.
        RawHtml::trusted(&*self.html)
    }
}

impl Drop for RawHtml {
    fn drop(&mut self) {
        provenance::forget(&self.html);
    }
}

impl PartialEq for RawHtml {
    fn eq(&self, other: &Self) -> bool {
        self.html == other.html
    }
}

impl Eq for RawHtml {}

impl fmt::Debug for RawHtml {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("RawHtml").field(&&*self.html).finish()
    }
}

/// The runtime half of the string form's deprecation: a `body_prefix` that is
/// not a `RawHtml` logs `RAW-101` once per process, in debug builds only, and
/// is written as it is either way.
///
/// Verified by: crates/forma-server/tests/body_prefix_string_warning.rs > "a_string_body_prefix_warns_once_per_process_in_debug_builds_and_a_raw_html_never_does"
pub(crate) fn check_body_prefix(body_prefix: &str, route: &str) {
    #[cfg(debug_assertions)]
    {
        use std::sync::atomic::{AtomicBool, Ordering};
        static WARNED: AtomicBool = AtomicBool::new(false);
        if WARNED.load(Ordering::Relaxed)
            || body_prefix.is_empty()
            || provenance::is_raw(body_prefix)
        {
            return;
        }
        if !WARNED.swap(true, Ordering::Relaxed) {
            tracing::warn!(
                code = "RAW-101",
                route,
                "RAW-101 PageConfig::body_prefix was given a plain string on route {route}: \
                 bind the markup as a RawHtml first (let markup = RawHtml::trusted(..);) and \
                 pass body_prefix: Some(&markup), so review and CI can find it; 3.0.0 accepts \
                 only a RawHtml. Logged once per process, in debug builds."
            );
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = (body_prefix, route);
}

/// Which strings are a live `RawHtml`'s markup, by address and length: kept
/// in debug builds only, for [`check_body_prefix`].
///
/// A `RawHtml`'s markup is its own heap allocation, which does not move when
/// the `RawHtml` does, so `&*raw` always has the address it had when it was
/// made, and no other live string shares it. Empty markup has no allocation
/// to tell apart and writes nothing, so it is neither remembered nor checked.
#[cfg(debug_assertions)]
mod provenance {
    use std::collections::BTreeSet;
    use std::sync::{Mutex, MutexGuard};

    static LIVE: Mutex<BTreeSet<(usize, usize)>> = Mutex::new(BTreeSet::new());

    fn key(s: &str) -> (usize, usize) {
        (s.as_ptr() as usize, s.len())
    }

    fn live() -> MutexGuard<'static, BTreeSet<(usize, usize)>> {
        // Nothing panics while holding the lock; a poisoned set is still a
        // set of addresses.
        LIVE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(super) fn remember(s: &str) {
        if !s.is_empty() {
            live().insert(key(s));
        }
    }

    pub(super) fn forget(s: &str) {
        if !s.is_empty() {
            live().remove(&key(s));
        }
    }

    pub(super) fn is_raw(s: &str) -> bool {
        !s.is_empty() && live().contains(&key(s))
    }

    #[cfg(test)]
    mod tests {
        use super::is_raw;
        use crate::RawHtml;

        #[test]
        fn a_raw_html_is_known_by_its_markup_and_a_string_with_the_same_text_is_not() {
            let raw = RawHtml::trusted("<nav>n</nav>");
            let same_text = String::from("<nav>n</nav>");
            assert!(is_raw(&raw));
            assert!(is_raw(raw.as_str()));
            assert!(!is_raw(&same_text));
            // A part of it is not the vouched-for value.
            assert!(!is_raw(&raw[1..]));
            assert!(!is_raw(&raw[..raw.len() - 1]));

            // A clone is its own allocation, remembered too.
            let copy = raw.clone();
            assert_eq!(copy, raw);
            assert!(is_raw(&copy));

            // Moving a RawHtml keeps its markup where it was.
            let at = raw.as_ptr();
            let moved = Box::new(raw);
            assert_eq!(moved.as_ptr(), at);
            assert!(is_raw(&moved));
        }

        #[test]
        fn a_dropped_raw_html_is_forgotten() {
            // A length no other test uses, so no other thread's RawHtml can
            // take this address and length between the drop and the check.
            let raw = RawHtml::trusted("<aside>".repeat(41));
            let (at, len) = (raw.as_ptr() as usize, raw.len());
            assert!(super::live().contains(&(at, len)));
            drop(raw);
            assert!(!super::live().contains(&(at, len)));
        }

        #[test]
        fn empty_markup_is_never_raw() {
            let raw = RawHtml::trusted("");
            assert!(!is_raw(&raw));
            assert!(!is_raw(""));
        }
    }
}

/// Release builds keep no record.
#[cfg(not(debug_assertions))]
mod provenance {
    pub(super) fn remember(_: &str) {}
    pub(super) fn forget(_: &str) {}
}
