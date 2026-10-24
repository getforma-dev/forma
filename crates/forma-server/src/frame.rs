//! The preview frame: a document with an opaque origin, for content nobody
//! reviewed.
//!
//! A generated module rendered in the application's own page runs with the
//! page's origin: its cookies, its storage, its API. Content nobody reviewed
//! (`@getforma/core`'s `mountMarkup` with `tier: 'unreviewed'`) renders in a
//! frame instead, whose document [`PageResponse::frame`] writes. The
//! document is one root, `<div id="forma-frame">`, and core's zero-build
//! runtime as one inline script; it names no URL, so loading it fetches
//! nothing. The runtime (`@getforma/core`'s frame runtime) then mounts the
//! module the host sends it into that root, with `tier: 'unreviewed'`.
//!
//! # What the frame's policy closes, and what it does not
//!
//! Its enforced `Content-Security-Policy` is the strict policy with nine
//! directives written in their place (the one exception to the rule that a
//! page's policy is never rewritten), in the enforced header because
//! a browser ignores `sandbox` in Report-Only and in `meta`:
//!
//! | Directive | What it closes |
//! |---|---|
//! | `sandbox allow-scripts` (no `allow-same-origin`) | An opaque origin: no cookies, storage or service worker of the application's, no same-origin window; no forms, popups, top navigation or downloads |
//! | `frame-ancestors <app origin>` | Framing by any other site |
//! | `script-src 'sha256-<runtime>'` | Every script but the inline runtime: none it creates, none it imports (`import()`), none from anywhere |
//! | `connect-src 'none'` | `fetch`, XHR, WebSocket, EventSource, `sendBeacon`, `<a ping>` |
//! | `img-src data:`, `style-src 'nonce-N'`, `font-src 'none'`, `worker-src 'none'`, `form-action 'none'` | Images, stylesheets, `url()` in `style` attributes, fonts and workers from any origin, the application's included: in an opaque-origin document CSP's `'self'` still names the application's origin, so markup alone would otherwise send it requests with its `SameSite=None` cookies |
//!
//! The strict policy's `default-src 'none'` closes nested frames, media and
//! prefetches, and `object-src` and `base-uri 'none'` stay. Trusted Types are
//! enforced in every build. The frame names no reporting endpoint: an unreviewed
//! document's reports do not belong to the application's reporting service.
//!
//! **What stays open, the residuals:**
//!
//! - **WebRTC.** A script in the frame can open an `RTCPeerConnection` whose
//!   STUN or TURN servers are any host: UDP packets and DNS lookups leave the
//!   browser, and no CSP directive closes that in Chrome 155 (`webrtc
//!   'block'` is reported as unrecognised). It needs script: the runtime, or
//!   code escaping it; markup alone cannot.
//! - **The frame navigating itself.** Neither the policy nor the sandbox
//!   stops a frame navigating its own document (by script, or by markup
//!   alone through `<meta http-equiv="refresh">`). The host's `frame-src` is
//!   the control: with the frame's exact path, every navigation to another
//!   URL is refused, save the frame's own path with another query (CSP's
//!   path matching ignores the query), which reaches the frame route, with
//!   the application's `SameSite=None` cookies, before the host's teardown.
//!   The frame route ignores its query, so what that carries lands in the
//!   application's access log and nowhere else. With anything wider than
//!   the exact path, a navigation it admits reaches that URL, data in its
//!   query, and on the application's origin carries those cookies. Name the
//!   exact path (below), and keep the frame route's query out of anything
//!   but the access log.
//! - **What the module shows.** It can show the user who previews it
//!   anything, inside the frame.
//!
//! **Closed by the runtime, not by the policy: link hints and `srcdoc`.** No
//! CSP directive governs `<link rel="preconnect">` and its kin, and in WebKit
//! a module's `<link rel="preconnect" href="…">`, its `href` written or bound,
//! opened a connection to the host it named from inside this frame, with
//! `connect-src 'none'` and the sandbox in place; an `<iframe srcdoc>` holding
//! such a `<link>` did too. `@getforma/core` 2.1.0's frame runtime mounts the
//! module with `tier: 'unreviewed'`, which parses it once in place, removes
//! every `<link>` and every `srcdoc` attribute (and refuses
//! `data-bind:srcdoc`), checks the live subtree after each write, and refuses
//! the render if one reaches the document (`FORMA_E_UNREVIEWED_LINK`,
//! `FORMA_E_UNREVIEWED_SRCDOC`). Only core 2.1.0 and later ship the frame
//! runtime, so every frame has it. Since FORMA-276 the same strip and live
//! check also remove every `on*` handler attribute and every URL attribute
//! whose value has a script scheme (`FORMA_E_UNREVIEWED_HANDLER`,
//! `FORMA_E_UNREVIEWED_URL`), which this policy refuses too, so the frame
//! does not depend on the policy alone for them.
//!
//! Checked in Chrome 155 (forma#22 and its review): markup alone (`<img>`, a
//! stylesheet, a `url()` in a `style` attribute, a font) reached neither the
//! application nor another origin; the runtime ran; `import()` and scripts
//! it created were refused; `fetch` was refused by `connect-src`. Checked in
//! Chromium 151, Firefox 153 and WebKit 26.5 with core 2.1.0's runtime (its
//! `e2e/frame.spec.ts`): a module's `<link>`
//! (preconnect, dns-prefetch, prefetch, preload, a bound `href`, or one
//! re-created by foreign content or foster parenting) and an `<iframe
//! srcdoc>` opened no connection in any of the three.
//!
//! # Where the runtime comes from
//!
//! From the application's own build: the manifest's `assets` names it under
//! [`FRAME_RUNTIME_ASSET`] (`forma-runtime.js`, mapped to its hashed file),
//! and the file is read from the application's embedded `dist`, once, at
//! start ([`PreviewFrame::load`]), which also computes its SHA-256 for
//! `script-src`. That keeps the runtime the one the application built with,
//! the same core version as its bundles, in the binary it ships, and
//! found the way every other asset is found, with no path for the
//! application to keep in step. It must be a classic, self-contained script
//! (no `import`), and it is inlined as it is, never rewritten: so it may not
//! contain `</script` or `<!--` (in any case), which would end or confuse its
//! element, nor a carriage return or a NUL, which the HTML parser rewrites
//! before it runs the script, so the script it runs would not be the one
//! hashed.
//!
//! A missing or unusable runtime is a coded [`FrameError`] at start: there is
//! never a frame without its runtime.
//!
//! | Code | When | Cause |
//! |---|---|---|
//! | FRAME-101 | [`PreviewFrame::load`] | The manifest's `assets` names no `forma-runtime.js` |
//! | FRAME-102 | [`PreviewFrame::load`] | The manifest names a runtime file that is not embedded |
//! | FRAME-103 | [`PreviewFrame::load`] | The runtime cannot be inlined: empty, not UTF-8, or containing `</script`, `<!--`, `\r` or NUL |
//! | FRAME-104 | [`PreviewFrame::load`] | The application's origin is not `https://host[:port]` (or `http://` on a loopback host) |
//! | FRAME-201 | [`PageResponse::frame`] | The system random source failed to draw a nonce |
//! | FRAME-202 | [`PageResponse::frame`] | The frame's policy is not a valid header value (ruled out by the checks at start) |
//!
//! # The host's side, which is the application's
//!
//! forma-server writes the frame's document; the application ships the page
//! that frames it and the bridge that talks to it. The frame is only as
//! confined as that host keeps it:
//!
//! 1. **The `iframe` carries `sandbox="allow-scripts"`**, never
//!    `allow-same-origin`, **set with `src` before it is inserted**: an
//!    `iframe` inserted first loads `about:blank`, and its first `load` event
//!    would be that one's. The attribute survives the frame navigating
//!    itself; the response header does not. Served without the header, a
//!    document in such an `iframe` still has `window.origin === "null"`.
//! 2. **The host page's own policy names the frame's exact URL in
//!    `frame-src`**: `PolicyExtensions::new().frame_src("https://studio.example/preview-frame")`,
//!    never `'self'` or a wider source. It is the only control on where the
//!    frame may navigate itself, and the host's teardown on a later load
//!    (5) comes after that request has left. It still admits the frame's
//!    own path with another query, the residual above.
//! 3. **One `MessageChannel` port, handed once, on the frame's first load,**
//!    with `iframe.contentWindow.postMessage(null, "*", [channel.port2])`:
//!    the message carries nothing but the port; `"*"` because the frame's
//!    origin is opaque (a target origin of `"null"` throws, and the
//!    application's never matches). After that the host listens only on its
//!    own port, never on `window`'s `message` event, and no other `message`
//!    listener on the host page trusts a message from origin `"null"`: the
//!    frame can `parent.postMessage` too, and it arrives with that origin.
//!    The frame's runtime takes the port only from `event.source === parent`
//!    (core's side).
//! 4. **The frame may send only `ready`, `resize` and `error`,** and the
//!    host checks each against its schema (the type, and for `resize` a
//!    bounded number) before acting on it. None acts in the studio's
//!    session: no message from the frame calls the application's API,
//!    navigates the host, or reads its state. **The host sends only the
//!    module to render.**
//! 5. **Any later `load` event tears the frame down** (the `iframe` removed,
//!    the port closed): a second load means the frame navigated, and what
//!    loaded is no longer the document forma-server wrote.
//!
//! ```js
//! const frame = document.createElement("iframe");
//! frame.setAttribute("sandbox", "allow-scripts"); // before src, before insertion
//! frame.src = "/preview-frame";
//! const channel = new MessageChannel();
//! let loads = 0;
//! frame.addEventListener("load", () => {
//!   if (++loads > 1) { // it navigated: tear it down
//!     channel.port1.close();
//!     frame.remove();
//!     return;
//!   }
//!   channel.port1.onmessage = (event) => { /* only ready, resize, error, schema-checked */ };
//!   frame.contentWindow.postMessage(null, "*", [channel.port2]); // only the port
//! });
//! document.body.append(frame);
//! ```
//!
//! ```no_run
//! use axum::response::{IntoResponse, Response};
//! use forma_server::{assets, PageResponse, PolicyExtensions, PreviewFrame};
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
//! // The host page's policy: frames from the frame's exact URL, nothing else.
//! fn host_policy() -> PolicyExtensions {
//!     PolicyExtensions::new().frame_src("https://studio.example/preview-frame")
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

use crate::csp::{self, CspNonce};
use crate::response::{PageResponse, RenderCounts};
use crate::types::AssetManifest;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rust_embed::Embed;
use std::fmt;
use std::sync::Arc;

/// The logical name the build's manifest gives the frame runtime in its
/// `assets`, mapped to the hashed file the application embeds.
pub const FRAME_RUNTIME_ASSET: &str = "forma-runtime.js";

/// What the preview frame's document needs, read once at start: the inline
/// runtime, its SHA-256 and the application's origin (see the
/// [module docs](self)).
#[derive(Clone)]
pub struct PreviewFrame {
    runtime: Arc<str>,
    runtime_sha256: String,
    app_origin: String,
}

impl PreviewFrame {
    /// Read the runtime the manifest names under [`FRAME_RUNTIME_ASSET`] from
    /// the application's embedded files `A`, hash it for `script-src`, and
    /// check `app_origin`, the origin of the pages that frame it
    /// (`https://studio.example`).
    ///
    /// # Errors
    ///
    /// `FRAME-101` to `FRAME-104` (see the [module docs](self)); refuse to
    /// start on any of them.
    ///
    /// Verified by: crates/forma-server/tests/internal_renderer/preview_frame.rs > "a_frame_without_its_runtime_is_a_coded_error_at_start"
    pub fn load<A: Embed>(manifest: &AssetManifest, app_origin: &str) -> Result<Self, FrameError> {
        manifest
            .validate()
            .map_err(|e| FrameError::new("FRAME-101", e))?;
        let app_origin = csp::check_origin(app_origin)
            .map_err(|reason| FrameError::new("FRAME-104", format!("{app_origin:?}: {reason}")))?;
        let Some(file) = manifest.aliases.get(FRAME_RUNTIME_ASSET) else {
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
        // The HTML parser turns CR and CRLF into LF and NUL into U+FFFD before
        // the script runs, so the hash of bytes holding either would not be
        // the hash of the script the browser checks.
        for (character, name) in [('\r', "a carriage return"), ('\0', "a NUL")] {
            if runtime.contains(character) {
                return Err(FrameError::new(
                    "FRAME-103",
                    format!(
                        "{file} contains {name}, which the HTML parser rewrites before it runs \
                         the script, so the script would not match its hash; build it with LF \
                         line endings"
                    ),
                ));
            }
        }
        let digest = ring::digest::digest(&ring::digest::SHA256, runtime.as_bytes());
        Ok(PreviewFrame {
            runtime: Arc::from(runtime),
            runtime_sha256: STANDARD.encode(digest.as_ref()),
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
            .field("runtime_sha256", &self.runtime_sha256)
            .field("app_origin", &self.app_origin)
            .finish()
    }
}

impl PageResponse {
    /// The preview frame's document, ready to send: an opaque origin, the
    /// runtime inline and allowed by its hash, and the requests the
    /// [`frame` module docs](crate::frame) list closed, with their residuals
    /// (the docs also set out the host's side). The only response whose
    /// policy is rewritten, and only in its nine directives.
    ///
    /// As every `PageResponse`, it writes `Cache-Control: no-store`, the
    /// document headers, and in a development build Trusted Types in
    /// Report-Only (no endpoint), with it; its HTML is reachable apart from
    /// them only through `into_parts_unchecked()`.
    ///
    /// # Errors
    ///
    /// `FRAME-201` when no nonce can be drawn for `style-src`: there is no
    /// frame without one; `FRAME-202`, ruled out by the checks at start.
    ///
    /// Verified by: crates/forma-server/tests/internal_renderer/preview_frame.rs > "the_frame_document_inlines_the_runtime_by_its_hash_and_names_nothing_to_fetch"
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
    let policy = csp::frame_policy(&nonce, &preview.runtime_sha256, &preview.app_origin)
        .ok_or_else(|| {
            FrameError::new(
                "FRAME-202",
                "the frame's policy is not a valid header value".into(),
            )
        })?;
    let html = document(&preview.runtime);
    Ok(PageResponse::with_policy(
        html,
        nonce,
        policy,
        RenderCounts::default(),
    ))
}

/// The frame's document: one root for the runtime to render into, and the
/// runtime inline, allowed by its hash. No `src`, `href` or other URL: the
/// document itself fetches nothing.
fn document(runtime: &str) -> String {
    let mut html = String::with_capacity(runtime.len() + 256);
    html.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n");
    html.push_str("<meta charset=\"utf-8\">\n");
    html.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    html.push_str("<title>Preview</title>\n");
    html.push_str("</head>\n<body>\n<div id=\"forma-frame\"></div>\n<script>");
    html.push_str(runtime);
    html.push_str("</script>\n</body>\n</html>");
    html
}

/// Why a preview frame could not be made: a stable code (`FRAME-101` to
/// `FRAME-202`, see the [module docs](self)) and the cause.
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
            runtime_sha256: "AAAA".to_string(),
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

    #[test]
    fn frame_202_a_policy_that_is_no_header_value_is_no_frame() {
        // Unreachable through `load`, which checks the origin: built by hand
        // here, an origin with a newline makes no header value.
        let bad = PreviewFrame {
            app_origin: "https://studio.example\r\nx: y".to_string(),
            ..preview()
        };
        let error = frame_with(&bad, CspNonce::try_generate).expect_err("no frame");
        assert_eq!(error.code(), "FRAME-202");
    }
}
