//! The preview frame: a document with an opaque origin and no network, for
//! content nobody reviewed (DR-14 tier (c); L-12, L-17, L-27, L-33, L-44;
//! SR32).
//!
//! A generated module rendered in the application's own page runs with the
//! page's origin: its cookies, its storage, its API. Tier (c) renders it in
//! a frame instead, whose document [`PageResponse::frame`] writes:
//!
//! - **An opaque origin and no network.** Its enforced
//!   `Content-Security-Policy` is the strict policy with four directives
//!   written in their place, and no other change (L-27, the one exception to
//!   SR5's rule against rewriting the policy): `sandbox allow-scripts`
//!   without `allow-same-origin`, `frame-ancestors` the application's own
//!   origin, `connect-src 'none'`, and `script-src` the response's nonce
//!   alone. The enforced header, because a browser ignores `sandbox` in
//!   `Content-Security-Policy-Report-Only` and in a `meta` element (L-17).
//! - **The runtime inline.** An opaque-origin document fetching the
//!   application's script would make a cross-origin, CORS-mode request, so
//!   core's zero-build runtime is written into the document as one nonced
//!   inline script, and the frame fetches nothing (L-44 (b)). The runtime
//!   then renders, in tier (c), the module the host sends it (core,
//!   FORMA-128) into the document's one element, `<div id="forma-frame">`.
//!
//! # Where the runtime comes from
//!
//! From the application's own build: the manifest's `assets` names it under
//! [`FRAME_RUNTIME_ASSET`] (`forma-runtime.js`, mapped to its hashed file),
//! and the file is read from the application's embedded `dist`, once, at
//! start ([`PreviewFrame::load`]). That keeps the runtime the one the
//! application built with, the same core version as its bundles (DR-26), in
//! the binary it ships, and found the way every other asset is found, with no
//! path for the application to keep in step. It must be a classic,
//! self-contained script (no `import`), and it is inlined as it is: one that
//! contains `</script` or `<!--`, in any case, cannot be inlined without
//! changing it and is refused rather than rewritten.
//!
//! A missing or unusable runtime is a coded [`FrameError`] at start: there is
//! never a frame without its runtime.
//!
//! | Code | When | Cause |
//! |---|---|---|
//! | FRAME-101 | [`PreviewFrame::load`] | The manifest's `assets` names no `forma-runtime.js` |
//! | FRAME-102 | [`PreviewFrame::load`] | The manifest names a runtime file that is not embedded |
//! | FRAME-103 | [`PreviewFrame::load`] | The runtime cannot be inlined: empty, not UTF-8, or containing `</script` or `<!--` |
//! | FRAME-104 | [`PreviewFrame::load`] | The application's origin is not `https://host[:port]` (or `http://` on a loopback host) |
//! | FRAME-201 | [`PageResponse::frame`] | The system random source failed to draw a nonce |
//!
//! # The host's side, which is the application's (L-12, L-33)
//!
//! forma-server writes the frame's document; the application ships the page
//! that frames it and the bridge that talks to it. The frame is only as
//! confined as that host keeps it:
//!
//! 1. **The `iframe` carries `sandbox="allow-scripts"`**, and never
//!    `allow-same-origin`. The attribute survives the frame navigating
//!    itself; the response header does not. Served without the header, a
//!    document in such an `iframe` still has `window.origin === "null"`.
//!
//!    ```html
//!    <iframe sandbox="allow-scripts" src="/preview-frame" title="Preview"></iframe>
//!    ```
//!
//! 2. **One `MessageChannel` port, handed once, on the frame's first load.**
//!    The host creates a channel and transfers one port to the frame with
//!    `iframe.contentWindow.postMessage(message, "*", [channel.port2])`
//!    (`"*"` because the frame's origin is opaque; the transferred port is
//!    what makes the channel private). After that the host listens only on
//!    its own port, never on `window`'s `message` event: a port message
//!    carries an empty origin, so the port itself is the check.
//! 3. **The frame may send only `ready`, `resize` and `error`,** and the
//!    host checks each against its schema (the type, and for `resize` a
//!    bounded number) before acting on it. None acts in the studio's
//!    session: no message from the frame calls the application's API,
//!    navigates the host, or reads its state.
//! 4. **The host sends only the module to render.**
//! 5. **Any later `load` event tears the frame down** (the `iframe` removed,
//!    the port closed): a second load means the frame navigated, and what
//!    loaded is no longer the document forma-server wrote.
//!
//! The frame's residual risk rests on `connect-src 'none'`, not on cookie
//! rules (L-27): a module can still show content to the user who previews
//! it, inside the frame, but it can read nothing of the application's and
//! send nothing anywhere.
//!
//! ```no_run
//! use axum::response::{IntoResponse, Response};
//! use forma_server::{assets, PageResponse, PreviewFrame};
//! use std::sync::Arc;
//!
//! // At start, before the port binds: refuse to start without the runtime.
//! fn start<Assets: rust_embed::Embed>() -> Result<Arc<PreviewFrame>, String> {
//!     let manifest = assets::try_load_manifest::<Assets>()?;
//!     PreviewFrame::load::<Assets>(&manifest, "https://studio.example")
//!         .map(Arc::new)
//!         .map_err(|e| e.to_string())
//! }
//!
//! // The `/preview-frame` route the host's iframe loads.
//! fn preview_frame(frame: &PreviewFrame) -> Response {
//!     match PageResponse::frame(frame) {
//!         Ok(page) => page.into_response(),
//!         Err(error) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error.code()).into_response(),
//!     }
//! }
//! ```

use crate::csp::{self, CspNonce, PagePolicy};
use crate::response::{PageResponse, RenderCounts};
use crate::types::AssetManifest;
use rust_embed::Embed;
use std::fmt;
use std::sync::Arc;

/// The logical name the build's manifest gives the frame runtime in its
/// `assets`, mapped to the hashed file the application embeds.
pub const FRAME_RUNTIME_ASSET: &str = "forma-runtime.js";

/// What the preview frame's document needs, read once at start: the inline
/// runtime and the application's origin (see the [module docs](self)).
#[derive(Clone)]
pub struct PreviewFrame {
    runtime: Arc<str>,
    app_origin: String,
}

impl PreviewFrame {
    /// Read the runtime the manifest names under [`FRAME_RUNTIME_ASSET`] from
    /// the application's embedded files `A`, and check `app_origin`, the
    /// origin of the pages that frame it (`https://studio.example`).
    ///
    /// # Errors
    ///
    /// `FRAME-101` to `FRAME-104` (see the [module docs](self)); refuse to
    /// start on any of them.
    ///
    /// Verified by: crates/forma-server/tests/preview_frame.rs > "a_frame_without_its_runtime_is_a_coded_error_at_start"
    pub fn load<A: Embed>(manifest: &AssetManifest, app_origin: &str) -> Result<Self, FrameError> {
        let app_origin = csp::check_origin(app_origin)
            .map_err(|reason| FrameError::new("FRAME-104", format!("{app_origin:?}: {reason}")))?;
        let Some(file) = manifest.assets.get(FRAME_RUNTIME_ASSET) else {
            return Err(FrameError::new(
                "FRAME-101",
                format!(
                    "the manifest's assets name no {FRAME_RUNTIME_ASSET}: build with the frame \
                     runtime, or serve no preview frame"
                ),
            ));
        };
        let Some(embedded) = A::get(file) else {
            return Err(FrameError::new(
                "FRAME-102",
                format!(
                    "the manifest names {FRAME_RUNTIME_ASSET} as {file}, which is not embedded"
                ),
            ));
        };
        let runtime = std::str::from_utf8(&embedded.data)
            .map_err(|_| FrameError::new("FRAME-103", format!("{file} is not UTF-8")))?;
        if runtime.trim().is_empty() {
            return Err(FrameError::new("FRAME-103", format!("{file} is empty")));
        }
        let lower = runtime.to_ascii_lowercase();
        for sequence in ["</script", "<!--"] {
            if lower.contains(sequence) {
                return Err(FrameError::new(
                    "FRAME-103",
                    format!(
                        "{file} contains {sequence:?}, which would end or confuse its inline \
                         script; the runtime is inlined as it is, never rewritten"
                    ),
                ));
            }
        }
        Ok(PreviewFrame {
            runtime: Arc::from(runtime),
            app_origin,
        })
    }

    /// The origin the frame's `frame-ancestors` names, in lower case.
    pub fn app_origin(&self) -> &str {
        &self.app_origin
    }
}

impl fmt::Debug for PreviewFrame {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PreviewFrame")
            .field("runtime_bytes", &self.runtime.len())
            .field("app_origin", &self.app_origin)
            .finish()
    }
}

impl PageResponse {
    /// The preview frame's document, ready to send: an opaque origin, no
    /// network, the runtime inline under a fresh nonce (see the
    /// [`frame` module docs](crate::frame), which also set out the host's
    /// side). The only response whose policy is rewritten, and only in
    /// `sandbox`, `frame-ancestors`, `connect-src` and `script-src` (L-27).
    ///
    /// As every `PageResponse`, it writes `Cache-Control: no-store` and the
    /// document headers with it; its HTML is reachable apart from them only
    /// through `into_parts_unchecked()`.
    ///
    /// # Errors
    ///
    /// `FRAME-201` when no nonce can be drawn: there is no frame without one.
    ///
    /// Verified by: crates/forma-server/tests/preview_frame.rs > "the_frame_document_inlines_the_runtime_under_its_nonce_and_names_nothing_to_fetch"
    pub fn frame(preview: &PreviewFrame) -> Result<PageResponse, FrameError> {
        frame_with(preview, CspNonce::try_generate)
    }
}

/// [`PageResponse::frame`] with the nonce source a parameter, so a test can
/// make the draw fail.
fn frame_with(
    preview: &PreviewFrame,
    draw: impl FnOnce() -> Result<CspNonce, csp::NonceError>,
) -> Result<PageResponse, FrameError> {
    let nonce = draw().map_err(|e| FrameError::new("FRAME-201", e.to_string()))?;
    let policy = csp::frame_policy(&nonce, &preview.app_origin);
    let policy = PagePolicy {
        csp: axum::http::HeaderValue::from_str(&policy).map_err(|_| {
            // Unreachable: the origin was checked and the nonce is base64.
            FrameError::new(
                "FRAME-104",
                "the frame policy is not a valid header value".into(),
            )
        })?,
        // Trusted Types reported, as on every page carrying the enforced
        // policy (FORMA-127); no reporting endpoint.
        report_only: axum::http::HeaderValue::from_str(&csp::report_only_policy()).map_err(
            |_| {
                FrameError::new(
                    "FRAME-104",
                    "the Report-Only policy is not a valid header value".into(),
                )
            },
        )?,
        reporting_endpoints: None,
        relaxed: None,
        opener: axum::http::HeaderValue::from_static("same-origin"),
    };
    let html = document(&nonce, &preview.runtime);
    Ok(PageResponse::with_policy(
        html,
        nonce,
        policy,
        RenderCounts::default(),
    ))
}

/// The frame's document: one root for the runtime to render into, and the
/// runtime inline under the nonce. No `src`, `href` or other URL: the
/// document itself fetches nothing.
fn document(nonce: &CspNonce, runtime: &str) -> String {
    let mut html = String::with_capacity(runtime.len() + 256);
    html.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n");
    html.push_str("<meta charset=\"utf-8\">\n");
    html.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    html.push_str("<title>Preview</title>\n");
    html.push_str("</head>\n<body>\n<div id=\"forma-frame\"></div>\n<script nonce=\"");
    html.push_str(nonce.as_str());
    html.push_str("\">");
    html.push_str(runtime);
    html.push_str("</script>\n</body>\n</html>");
    html
}

/// Why a preview frame could not be made: a stable code (`FRAME-101` to
/// `FRAME-201`, see the [module docs](self)) and the cause.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct FrameError {
    code: &'static str,
    detail: String,
}

impl FrameError {
    fn new(code: &'static str, detail: String) -> Self {
        FrameError { code, detail }
    }

    /// The stable code, such as `FRAME-101`.
    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for FrameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.code, self.detail)
    }
}

impl std::error::Error for FrameError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn preview() -> PreviewFrame {
        PreviewFrame {
            runtime: Arc::from("window.__runtime = 1;"),
            app_origin: "https://studio.example".to_string(),
        }
    }

    #[test]
    fn frame_201_a_failed_nonce_draw_is_no_frame() {
        let error = frame_with(&preview(), || Err(csp::NonceError)).expect_err("no frame");
        assert_eq!(error.code(), "FRAME-201");
        // The same frame with a real draw is made: the failure is the draw's.
        assert!(frame_with(&preview(), CspNonce::try_generate).is_ok());
    }
}
