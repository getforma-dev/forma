use axum::{
    body::{Body, Bytes},
    extract::Path,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use rust_embed::Embed;

/// Load a text asset from the embedded dist directory. Panics if missing.
///
/// STARTUP ONLY. This panics on a missing or non-UTF8 file, so it must never
/// be reached from a request path — use [`try_asset`] there.
///
/// # Panics
///
/// On a missing or non-UTF-8 file; the 0.2.1 signature has no room for the
/// error, which [`try_asset`] returns.
#[allow(clippy::panic)] // the 0.2.1 signature; `try_asset` is the fallible one
pub fn asset<A: Embed>(name: &str) -> String {
    try_asset::<A>(name).unwrap_or_else(|e| panic!("{e}"))
}

/// Fallible [`asset`] — use this anywhere a request can influence `name`.
pub fn try_asset<A: Embed>(name: &str) -> Result<String, String> {
    let file = A::get(name).ok_or_else(|| format!("Missing asset: {name}"))?;
    std::str::from_utf8(&file.data)
        .map(|s| s.to_owned())
        .map_err(|_| format!("Non-UTF8 asset: {name}"))
}

/// Borrow an embedded file's bytes without copying them.
///
/// In release builds `rust-embed` hands back `Cow::Borrowed(&'static [u8])`,
/// so this is a pointer copy. The previous `.to_vec()` meant N concurrent
/// requests for the biggest asset (the WASM binary) allocated N full copies —
/// an unauthenticated memory amplifier that scales with connection count.
fn bytes_of(file: rust_embed::EmbeddedFile) -> Bytes {
    match file.data {
        std::borrow::Cow::Borrowed(b) => Bytes::from_static(b),
        std::borrow::Cow::Owned(v) => Bytes::from(v),
    }
}

fn body_of(file: rust_embed::EmbeddedFile) -> Body {
    Body::from(bytes_of(file))
}

/// Load raw bytes from the embedded dist directory. Returns None if missing.
///
/// Returns [`Bytes`] rather than `Vec<u8>` so callers do not copy the file;
/// `Bytes` derefs to `[u8]` and converts into a response `Body` for free.
pub fn asset_bytes<A: Embed>(name: &str) -> Option<Bytes> {
    A::get(name).map(bytes_of)
}

/// Load and parse the asset manifest from embedded assets.
///
/// STARTUP ONLY — panics if the manifest is missing or malformed.
///
/// Deprecated: a server should refuse to start with a message, not a
/// panic. [`try_load_manifest`] returns the error; in 3.0.0 `load_manifest`
/// itself returns it.
///
/// # Panics
///
/// If `manifest.json` is missing or does not parse.
#[deprecated(
    since = "0.2.2",
    note = "panics on a missing or malformed manifest; use `try_load_manifest`, which \
            returns the error. In 3.0.0 `load_manifest` returns a `Result`"
)]
#[allow(clippy::panic)] // the 0.2.1 signature; `try_load_manifest` is the fallible one
pub fn load_manifest<A: Embed>() -> crate::AssetManifest {
    try_load_manifest::<A>().unwrap_or_else(|e| panic!("{e}"))
}

/// Fallible [`load_manifest`].
pub fn try_load_manifest<A: Embed>() -> Result<crate::AssetManifest, String> {
    let data = try_asset::<A>("manifest.json")?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse manifest.json: {e}"))
}

/// Each route's `modulepreload` list from the embedded `manifest.json`, for
/// [`RenderCtx::with_module_preloads`](crate::RenderCtx::with_module_preloads)
/// Call it at start, beside [`try_load_manifest`].
///
/// # Errors
///
/// A missing or malformed manifest, or a preload that names a file the
/// manifest does not list among the build's `assets`; refuse to start on it,
/// as on a bad module.
pub fn try_load_module_preloads<A: Embed>() -> Result<crate::ModulePreloads, String> {
    let data = try_asset::<A>("manifest.json")?;
    crate::head::ModulePreloads::from_manifest_json(&data)
}

/// Files that must never be served through the asset route.
///
/// `manifest.json` exposes the full route table, asset graph and per-route
/// size budgets, and nothing client-side fetches it. A direct `.br`/`.gz`
/// request would return compressed bytes with no `Content-Encoding`, i.e. a
/// corrupt response — those siblings are only ever reachable through content
/// negotiation below.
fn is_denied(filename: &str) -> bool {
    filename == "manifest.json" || filename.ends_with(".br") || filename.ends_with(".gz")
}

/// A parsed `Accept-Encoding` entry.
struct Encoding<'a> {
    token: &'a str,
    q: f32,
}

/// Parse `Accept-Encoding` into (token, qvalue) pairs.
///
/// RFC 9110 §12.5.3: `q=0` means "not acceptable". A substring test reads
/// `br;q=0` — the standard way a client or proxy says it cannot decode
/// brotli — as acceptance, and then serves an undecodable body. A substring
/// test also matches `x-brotli-nope` as "br".
fn parse_accept_encoding(header: &str) -> Vec<Encoding<'_>> {
    header
        .split(',')
        .filter_map(|element| {
            let mut parts = element.split(';').map(str::trim);
            let token = parts.next()?;
            if token.is_empty() {
                return None;
            }
            // Default q=1.0; an unparseable q is lenient (also 1.0).
            let mut q = 1.0_f32;
            for param in parts {
                let Some((name, value)) = param.split_once('=') else {
                    continue;
                };
                // Match the parameter name exactly after trimming — splitting
                // on the literal ";q=" would miss `br; q=0` and `br;Q=0`.
                if name.trim() == "q" {
                    q = value.trim().parse().unwrap_or(1.0);
                }
            }
            Some(Encoding {
                token,
                q: q.clamp(0.0, 1.0),
            })
        })
        .collect()
}

/// Axum handler: serve a static asset with content negotiation (brotli, gzip).
///
/// Mount at `/_assets/{filename}` in your router. One binary may mount it for
/// several `Embed` types; each serves exactly its own files.
///
/// `A` is `'static` because release builds cache each type's file list under
/// its [`TypeId`](std::any::TypeId). Every `#[derive(Embed)]` type is, and
/// mounting the handler on an axum route already required it.
pub async fn serve_asset<A: Embed + 'static>(
    Path(filename): Path<String>,
    headers: HeaderMap,
) -> Response {
    if is_denied(&filename) {
        return StatusCode::NOT_FOUND.into_response();
    }

    // Validate the requested name against the embedded file list BEFORE any
    // lookup. In debug builds rust-embed reads from the filesystem, so on
    // Windows `A::get` is case-insensitive and accepts NTFS stream syntax
    // (`app.abc.js::$DATA`) — both of which 404 in release. Comparing against
    // `iter()` (which yields the on-disk casing in debug and the compiled-in
    // list in release) makes the two profiles agree, and closes the alias
    // without a charset allowlist that would 404 legitimate un-hashed font
    // filenames containing spaces.
    if !is_embedded::<A>(&filename) {
        return StatusCode::NOT_FOUND.into_response();
    }

    let accept = headers
        .get(header::ACCEPT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let accepted = parse_accept_encoding(&accept);
    let q_of = |name: &str| {
        accepted
            .iter()
            .find(|e| e.token == name)
            .map(|e| e.q)
            .unwrap_or(0.0)
    };

    // Ordered preference list. `*` and `identity` deliberately fall through to
    // the raw asset: treating `*` as licence to send brotli would be a
    // robustness regression.
    let mut candidates = [("br", q_of("br")), ("gzip", q_of("gzip"))];
    // Stable sort by q descending, br winning ties (preserving the previous
    // br-first bias).
    candidates.sort_by(|a, b| b.1.total_cmp(&a.1));

    let if_none_match = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok());

    for (encoding, q) in candidates {
        if q <= 0.0 {
            continue;
        }
        let suffix = if encoding == "br" { "br" } else { "gz" };
        // Serve the first candidate whose compressed sibling actually exists —
        // an asset with only a .gz used to be served raw to a br+gzip client.
        if let Some(file) = A::get(&format!("{filename}.{suffix}")) {
            return asset_response(&filename, file, Some(encoding), if_none_match);
        }
    }

    match A::get(&filename) {
        Some(file) => asset_response(&filename, file, None, if_none_match),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// True if `name` is exactly one of `A`'s embedded file names.
fn is_embedded<A: Embed + 'static>(name: &str) -> bool {
    #[cfg(not(debug_assertions))]
    {
        // Release: the list is compiled in and immutable, so cache it, per type.
        match cached_names::<A>() {
            Some(names) => names.contains(name),
            // Verified by: crates/forma-server/src/assets.rs > "more_embed_types_than_cache_slots_each_serve_their_own_assets"
            None => A::iter().any(|f| f == name),
        }
    }
    #[cfg(debug_assertions)]
    {
        // Debug: rust-embed walks the folder, so never cache — a newly built
        // asset must be servable without restarting the dev server.
        A::iter().any(|f| f == name)
    }
}

/// One `Embed` type's file names, borrowed from its compiled-in list.
#[cfg(not(debug_assertions))]
type NameSet = std::collections::HashSet<std::borrow::Cow<'static, str>>;

/// How many `Embed` types get a cached name set. An application serves one;
/// asset retention would serve two (this build's and the previous one's). A
/// type beyond the last slot is checked by scanning its list: slower, never
/// wrong.
#[cfg(not(debug_assertions))]
const NAME_CACHE_SLOTS: usize = 4;

/// One cached name set per `Embed` type, each slot claimed by the first request
/// its type serves and never written again.
///
/// The cache carries its own `TypeId` key because a `static` cannot be per
/// type: one declared inside a generic function is a single static shared by
/// every instantiation. 0.2.0's cache was such a static, so the first type
/// served filled it and every other type's valid assets answered 404.
///
/// Slots rather than a locked map: reading a filled `OnceLock` is one atomic
/// load, where every `RwLock` read writes a shared counter that all the cores
/// serving assets would contend on.
#[cfg(not(debug_assertions))]
static NAME_CACHE: [std::sync::OnceLock<(std::any::TypeId, NameSet)>; NAME_CACHE_SLOTS] =
    [const { std::sync::OnceLock::new() }; NAME_CACHE_SLOTS];

/// `A`'s cached name set, or `None` if every slot belongs to another type.
#[cfg(not(debug_assertions))]
fn cached_names<A: Embed + 'static>() -> Option<&'static NameSet> {
    let key = std::any::TypeId::of::<A>();
    for slot in &NAME_CACHE {
        // Slots fill in order and are written once, so a type absent from
        // every earlier slot cannot be in a later one: the first empty slot is
        // this type's to claim. A concurrent claim on the same slot blocks
        // until the winner has filled it, then reads the winner's key.
        let (owner, names) = slot.get_or_init(|| (key, A::iter().collect()));
        // Verified by: crates/forma-server/tests/asset_sets.rs > "two_embed_types_each_serve_their_own_assets"
        if *owner == key {
            return Some(names);
        }
    }
    None
}

/// True if the filename carries a content hash, i.e. its bytes can never
/// change under this name.
///
/// `@getforma/build` composes hashed names as `<base>.<8 lowercase hex>.<ext>`.
/// It hashes only `.js/.css/.wasm/.ir` — fonts, svg and the like keep their
/// original names and must NOT be pinned for a year with `immutable`, or a
/// redeploy cannot invalidate them.
fn is_content_hashed(filename: &str) -> bool {
    let name = filename.rsplit('/').next().unwrap_or(filename);
    name.split('.').skip(1).any(|segment| {
        segment.len() == 8
            && segment
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

fn asset_response(
    filename: &str,
    file: rust_embed::EmbeddedFile,
    encoding: Option<&str>,
    if_none_match: Option<&str>,
) -> Response {
    let mime = mime_for(filename);
    // Strong ETag from the content hash rust-embed already computed. This
    // matters because un-hashed assets (every .woff2, every .svg) now get
    // `max-age=0, must-revalidate`; without a validator that would mean a full
    // 200-with-body re-download on every navigation.
    let etag = format!(
        "\"{}{}\"",
        hex8(&file.metadata.sha256_hash()),
        // The compressed variants are different bytes under the same URL, and
        // `Vary: accept-encoding` is advisory to caches only, so qualify it.
        encoding.unwrap_or("")
    );

    let cache_control = if is_content_hashed(filename) {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=0, must-revalidate"
    };

    // Answer a conditional request without re-sending the body.
    if if_none_match.map(|v| v.split(',').any(|c| c.trim() == etag)) == Some(true) {
        return built(
            Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header(header::CACHE_CONTROL, cache_control)
                .header(header::ETAG, &etag)
                .header("vary", "accept-encoding")
                .body(Body::empty()),
        );
    }

    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::ETAG, &etag)
        .header("vary", "accept-encoding")
        // Harmless for js/css/wasm — a subresource's own CSP does not govern
        // its execution, only a directly-navigated document's. It bites
        // exactly the case it is meant to: an `.svg` or `.html` in dist that
        // someone navigates to directly cannot run script. It does not collide
        // with the per-page policy, which the app sets on page responses.
        .header(
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; sandbox",
        );

    for (name, value) in crate::types::asset_security_headers() {
        builder = builder.header(name, value);
    }

    if let Some(enc) = encoding {
        builder = builder.header(header::CONTENT_ENCODING, enc);
    }

    built(builder.body(body_of(file)))
}

/// A response from a builder, or a bare 500 if a header failed to parse.
///
/// Every header above is a static string or an ETag of hex digits, so the
/// builder cannot fail today; this keeps a future header that can from
/// panicking the request (DR-12) and sends no body without its headers.
fn built(response: Result<Response<Body>, axum::http::Error>) -> Response {
    match response {
        Ok(response) => response.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// First 8 bytes of a hash, hex-encoded.
fn hex8(hash: &[u8; 32]) -> String {
    hash[..8].iter().map(|b| format!("{b:02x}")).collect()
}

/// Map a filename to its `Content-Type`.
///
/// Extension matching is case-insensitive and anchored to the last dot after
/// the last path separator — the dashboard template mounts a wildcard route,
/// so `filename` can contain `/`, and `img.v2/logo` must not be read as
/// extension `v2/logo`.
///
/// Anything unrecognized stays `application/octet-stream`. Combined with the
/// `nosniff` header that is the correct fail-closed answer, and the default is
/// deliberate: `.ir` files are opaque binaries read via `arrayBuffer()`, so
/// octet-stream is the honest type for them.
fn mime_for(filename: &str) -> &'static str {
    let base = filename.rsplit('/').next().unwrap_or(filename);
    let ext = base.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase());
    match ext.as_deref() {
        // One spelling of the JS MIME for both extensions (WHATWG-preferred).
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        // Hard requirement, not a nicety: the wasm-pack loader uses
        // WebAssembly.instantiateStreaming, which strictly rejects any other
        // type.
        Some("wasm") => "application/wasm",
        Some("json") => "application/json",
        Some("map") => "application/json",
        Some("html") => "text/html; charset=utf-8",
        Some("txt") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml",
        Some("webmanifest") => "application/manifest+json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_matching_is_case_insensitive() {
        // The regression that actually matters: `nosniff` hard-blocks a script
        // or stylesheet served as octet-stream, and in debug builds the
        // filesystem lookup is case-insensitive on Windows, so an uppercase
        // request used to resolve the file and then be refused by the browser.
        assert_eq!(
            mime_for("app.abc123ef.js"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            mime_for("APP.ABC123EF.JS"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(mime_for("app.MJS"), "text/javascript; charset=utf-8");
        assert_eq!(mime_for("style.CSS"), "text/css; charset=utf-8");
    }

    #[test]
    fn mime_reads_the_extension_after_the_last_separator() {
        // A wildcard asset route can deliver a path, and `img.v2/logo` has no
        // extension at all.
        assert_eq!(mime_for("img.v2/logo"), "application/octet-stream");
        assert_eq!(mime_for("img.v2/logo.png"), "image/png");
        assert_eq!(mime_for("noextension"), "application/octet-stream");
    }

    #[test]
    fn mime_covers_images_fonts_and_maps() {
        assert_eq!(mime_for("logo.a1b2c3d4.png"), "image/png");
        assert_eq!(mime_for("photo.jpeg"), "image/jpeg");
        assert_eq!(mime_for("icon.ico"), "image/x-icon");
        assert_eq!(mime_for("inter.woff2"), "font/woff2");
        assert_eq!(mime_for("legacy.woff"), "font/woff");
        assert_eq!(mime_for("app.js.map"), "application/json");
    }

    #[test]
    fn mime_wasm_is_pinned() {
        // WebAssembly.instantiateStreaming rejects anything else.
        assert_eq!(mime_for("forma.deadbeef.wasm"), "application/wasm");
    }

    #[test]
    fn mime_default_stays_fail_closed() {
        // Pinned so a future widening does not silently swallow these: with
        // nosniff set, octet-stream is the correct answer for an opaque binary.
        assert_eq!(mime_for("page.abc12345.ir"), "application/octet-stream");
        assert_eq!(mime_for("archive.zip"), "application/octet-stream");
        assert_eq!(mime_for("thing.unknownext"), "application/octet-stream");
    }

    #[test]
    fn content_hash_detection_gates_immutable_caching() {
        assert!(is_content_hashed("app.a1b2c3d4.js"));
        assert!(is_content_hashed("page.00000000.ir"));
        // Un-hashed: pinning these for a year means a redeploy cannot
        // invalidate them.
        assert!(!is_content_hashed("manifest.json"));
        assert!(!is_content_hashed("sw.js"));
        assert!(!is_content_hashed("index.html"));
        assert!(!is_content_hashed("Inter Variable.woff2"));
        // Wrong length or non-hex must not count.
        assert!(!is_content_hashed("app.a1b2c3.js"));
        assert!(!is_content_hashed("app.a1b2c3d4e5.js"));
        assert!(!is_content_hashed("app.zzzzzzzz.js"));
    }

    #[test]
    fn denied_names_are_never_served() {
        // manifest.json exposes the route table and asset graph; a direct
        // .br/.gz request would return compressed bytes with no
        // Content-Encoding.
        assert!(is_denied("manifest.json"));
        assert!(is_denied("app.a1b2c3d4.js.br"));
        assert!(is_denied("app.a1b2c3d4.js.gz"));
        assert!(!is_denied("app.a1b2c3d4.js"));
    }

    // -- Accept-Encoding negotiation ----------------------------------------

    /// Resolve which encoding `serve_asset` would pick, given a header and the
    /// set of compressed siblings that exist.
    fn pick(header: &str, has_br: bool, has_gz: bool) -> Option<&'static str> {
        let lowered = header.to_ascii_lowercase();
        let accepted = parse_accept_encoding(&lowered);
        let q_of = |name: &str| {
            accepted
                .iter()
                .find(|e| e.token == name)
                .map(|e| e.q)
                .unwrap_or(0.0)
        };
        let mut candidates = [("br", q_of("br")), ("gzip", q_of("gzip"))];
        candidates.sort_by(|a, b| b.1.total_cmp(&a.1));
        for (encoding, q) in candidates {
            if q <= 0.0 {
                continue;
            }
            if (encoding == "br" && has_br) || (encoding == "gzip" && has_gz) {
                return Some(encoding);
            }
        }
        None
    }

    #[test]
    fn qvalue_zero_is_a_rejection_not_an_acceptance() {
        // The standard way a client or proxy says "I cannot decode brotli".
        // A substring test read this as acceptance and shipped an undecodable
        // body — i.e. the whole app bundle failed to load, with no fallback.
        assert_eq!(pick("gzip, deflate, br;q=0", true, true), Some("gzip"));
        assert_eq!(pick("gzip;q=0, br", true, true), Some("br"));
        assert_eq!(pick("gzip;q=0, br;q=0", true, true), None);
        // Whitespace and an uppercase parameter name must not defeat it.
        assert_eq!(pick("br; q=0, gzip", true, true), Some("gzip"));
        assert_eq!(pick("br;Q=0, gzip", true, true), Some("gzip"));
    }

    #[test]
    fn higher_qvalue_wins() {
        assert_eq!(pick("br;q=0.1, gzip;q=0.9", true, true), Some("gzip"));
        assert_eq!(pick("br;q=0.9, gzip;q=0.1", true, true), Some("br"));
        // br wins ties, preserving the previous bias.
        assert_eq!(pick("br, gzip", true, true), Some("br"));
    }

    #[test]
    fn tokens_match_exactly_not_by_substring() {
        // `x-brotli-nope` used to be served brotli.
        assert_eq!(pick("x-brotli-nope", true, true), None);
        assert_eq!(pick("gzipped-thing", true, true), None);
    }

    #[test]
    fn falls_through_to_the_next_candidate_when_a_sibling_is_missing() {
        // An asset with a .gz but no .br used to be served RAW to a br+gzip
        // client.
        assert_eq!(pick("gzip, deflate, br", false, true), Some("gzip"));
        assert_eq!(pick("gzip, deflate, br", true, false), Some("br"));
        assert_eq!(pick("gzip, deflate, br", false, false), None);
    }

    #[test]
    fn wildcard_identity_and_absent_headers_serve_raw() {
        // `*` is deliberately not treated as licence to send brotli.
        assert_eq!(pick("*", true, true), None);
        assert_eq!(pick("identity", true, true), None);
        assert_eq!(pick("", true, true), None);
    }

    // -- End-to-end handler behavior ----------------------------------------

    #[derive(Embed)]
    #[folder = "test_fixtures/"]
    struct Fixtures;

    /// Call the handler with an optional Accept-Encoding header.
    async fn get(name: &str, accept: Option<&str>) -> Response {
        let mut headers = HeaderMap::new();
        if let Some(accept) = accept {
            headers.insert(header::ACCEPT_ENCODING, accept.parse().unwrap());
        }
        serve_asset::<Fixtures>(Path(name.to_string()), headers).await
    }

    fn header_of(response: &Response, name: &str) -> Option<String> {
        response
            .headers()
            .get(name)
            .map(|v| v.to_str().unwrap().to_string())
    }

    #[tokio::test]
    async fn serves_a_hashed_asset_immutable_with_an_etag() {
        let response = get("app.a1b2c3d4.js", None).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            header_of(&response, "content-type").as_deref(),
            Some("text/javascript; charset=utf-8")
        );
        assert_eq!(
            header_of(&response, "cache-control").as_deref(),
            Some("public, max-age=31536000, immutable")
        );
        assert!(header_of(&response, "etag").is_some());
        assert_eq!(
            header_of(&response, "x-content-type-options").as_deref(),
            Some("nosniff")
        );
    }

    #[tokio::test]
    async fn un_hashed_assets_are_revalidated_not_pinned_for_a_year() {
        // `immutable` on an un-hashed name means a redeploy cannot invalidate
        // it — the ETag is what keeps that cheap.
        let response = get("style.css", None).await;
        assert_eq!(
            header_of(&response, "cache-control").as_deref(),
            Some("public, max-age=0, must-revalidate")
        );
        assert!(header_of(&response, "etag").is_some());
    }

    #[tokio::test]
    async fn conditional_request_gets_304_without_a_body() {
        let first = get("style.css", None).await;
        let etag = header_of(&first, "etag").unwrap();

        let mut headers = HeaderMap::new();
        headers.insert(header::IF_NONE_MATCH, etag.parse().unwrap());
        let second = serve_asset::<Fixtures>(Path("style.css".to_string()), headers).await;
        assert_eq!(second.status(), StatusCode::NOT_MODIFIED);
    }

    #[tokio::test]
    async fn negotiation_honours_qvalue_zero_end_to_end() {
        // style.css has a .br sibling but no .gz.
        let response = get("style.css", Some("gzip, deflate, br")).await;
        assert_eq!(
            header_of(&response, "content-encoding").as_deref(),
            Some("br")
        );

        // ...and a client that cannot decode brotli must not receive it.
        let response = get("style.css", Some("gzip, deflate, br;q=0")).await;
        assert_eq!(header_of(&response, "content-encoding"), None);
    }

    #[tokio::test]
    async fn falls_back_to_gzip_when_only_a_gz_sibling_exists() {
        // app.a1b2c3d4.js has a .gz but no .br — this used to serve raw.
        let response = get("app.a1b2c3d4.js", Some("gzip, deflate, br")).await;
        assert_eq!(
            header_of(&response, "content-encoding").as_deref(),
            Some("gzip")
        );
    }

    #[tokio::test]
    async fn manifest_and_compressed_siblings_are_not_directly_servable() {
        // manifest.json exposes the route table and asset graph; a raw .gz
        // response would be corrupt (compressed bytes, no Content-Encoding).
        assert_eq!(
            get("manifest.json", None).await.status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            get("app.a1b2c3d4.js.gz", None).await.status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            get("style.css.br", None).await.status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn filename_aliases_404_in_debug_just_like_release() {
        // In debug builds rust-embed reads from the filesystem, so on Windows
        // these used to resolve (as octet-stream) while 404ing in release —
        // a dev/prod divergence that hides MIME and cache bugs until deploy.
        for alias in [
            "APP.A1B2C3D4.JS",
            "app.a1b2c3d4.js::$DATA",
            "app.a1b2c3d4.js.",
            "app.a1b2c3d4.js ",
            "./app.a1b2c3d4.js",
            "../Cargo.toml",
        ] {
            assert_eq!(
                get(alias, None).await.status(),
                StatusCode::NOT_FOUND,
                "alias {alias:?} must not resolve"
            );
        }
    }

    #[tokio::test]
    async fn missing_asset_is_404() {
        assert_eq!(get("nope.js", None).await.status(), StatusCode::NOT_FOUND);
    }

    // -- One binary, more Embed types than the release name cache holds ------

    #[derive(Embed)]
    #[folder = "tests/fixtures/asset-sets/a/"]
    struct SetA;

    #[derive(Embed)]
    #[folder = "tests/fixtures/asset-sets/b/"]
    struct SetB;

    #[derive(Embed)]
    #[folder = "tests/fixtures/asset-sets/c/"]
    struct SetC;

    #[derive(Embed)]
    #[folder = "tests/fixtures/asset-sets/d/"]
    struct SetD;

    #[derive(Embed)]
    #[folder = "tests/fixtures/asset-sets/e/"]
    struct SetE;

    /// Serve `name` from `A`; return status and body.
    async fn fetch<A: Embed + 'static>(name: &str) -> (StatusCode, Vec<u8>) {
        let response = serve_asset::<A>(Path(name.to_string()), HeaderMap::new()).await;
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("an asset body is in memory and cannot fail to collect");
        (status, body.to_vec())
    }

    /// `A` serves its own hashed file and its own `shared.css` byte for byte,
    /// and refuses `foreign`, another set's file.
    async fn assert_serves_its_own<A: Embed + 'static>(
        own: &str,
        own_js: &[u8],
        own_css: &[u8],
        foreign: &str,
    ) {
        assert_eq!(
            fetch::<A>(own).await,
            (StatusCode::OK, own_js.to_vec()),
            "{own} from its own set"
        );
        assert_eq!(
            fetch::<A>("shared.css").await,
            (StatusCode::OK, own_css.to_vec()),
            "shared.css from the set holding {own}"
        );
        assert_eq!(
            fetch::<A>(foreign).await.0,
            StatusCode::NOT_FOUND,
            "{foreign} from the set holding {own}"
        );
    }

    #[tokio::test]
    async fn more_embed_types_than_cache_slots_each_serve_their_own_assets() {
        // Five types against the cache's slots, so in release at least one of
        // them is checked by the uncached scan, whichever order this binary's
        // tests reach the cache in (`Fixtures` may hold a slot too).
        #[cfg(not(debug_assertions))]
        const _: () = assert!(5 > NAME_CACHE_SLOTS, "serve more types than slots");

        // Twice, so every type is served again after all five have claimed or
        // missed a slot.
        for _ in 0..2 {
            assert_serves_its_own::<SetA>(
                "a.aaaaaaaa.js",
                b"export default \"a\";\n",
                b".a{}\n",
                "b.bbbbbbbb.js",
            )
            .await;
            assert_serves_its_own::<SetB>(
                "b.bbbbbbbb.js",
                b"export default \"bb\";\n",
                b".bb{}\n",
                "c.cccccccc.js",
            )
            .await;
            assert_serves_its_own::<SetC>(
                "c.cccccccc.js",
                b"export default \"ccc\";\n",
                b".ccc{}\n",
                "d.dddddddd.js",
            )
            .await;
            assert_serves_its_own::<SetD>(
                "d.dddddddd.js",
                b"export default \"dddd\";\n",
                b".dddd{}\n",
                "e.eeeeeeee.js",
            )
            .await;
            assert_serves_its_own::<SetE>(
                "e.eeeeeeee.js",
                b"export default \"eeeee\";\n",
                b".eeeee{}\n",
                "a.aaaaaaaa.js",
            )
            .await;
        }
    }
}
