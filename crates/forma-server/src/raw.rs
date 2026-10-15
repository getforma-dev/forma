//! The named raw HTML boundary. A RawHtml is reviewed application markup,
//! not sanitized data. Each constructor belongs on the application's SR8
//! allowlist with an owner. PageConfig::body_prefix accepts this type directly.
use std::{fmt, ops::Deref};

/// Markup explicitly vouched for by the application. The private field and sole
/// named constructor keep raw entry points searchable; strings cannot become a
/// RawHtml through From, Into, Default or deserialization.
///
/// ```
/// use forma_server::RawHtml;
/// let logo = RawHtml::trusted("<nav>Example</nav>");
/// assert_eq!(logo.as_str(), "<nav>Example</nav>");
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
        RawHtml::trusted(&*self.html)
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
