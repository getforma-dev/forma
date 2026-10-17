//! Start-up and response plumbing shared by the fixture applications.
//!
//! Nothing here renders: each binary binds its own props types to its own routes.
//! What is shared is what every application in the stack repeats: refuse to start
//! on a bad build, answer a coded render failure with a bare 500, serve the build's
//! assets, and report the bound address once the socket is owned.

pub mod bench_data;

use std::net::Ipv4Addr;

use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use forma_server::{assets, load_ir_modules, AssetManifest, PageProps, Pages, RenderError};
use rust_embed::Embed;

/// A fixture's start: the manifest, and the loaded modules ready to bind.
pub struct Startup {
    pub manifest: AssetManifest,
    pub pages: Pages,
}

/// Load the embedded build or exit, naming why, before any port is bound.
pub fn load<A: Embed + 'static>() -> Startup {
    let manifest = assets::try_load_manifest::<A>().unwrap_or_else(|error| {
        eprintln!("fixture: manifest.json: {error}");
        std::process::exit(1);
    });
    let pages = load_ir_modules::<A>(&manifest).unwrap_or_else(|errors| {
        for error in errors {
            eprintln!("{error}");
        }
        std::process::exit(1);
    });
    Startup { manifest, pages }
}

/// Bind one server-rendered route to its handler type, or exit naming every refusal.
pub fn bind<P: PageProps>(pages: &Pages, route: &str) -> forma_server::PageHandle<P> {
    pages.bind::<P>(route).unwrap_or_else(|errors| {
        for error in errors {
            eprintln!("{error}");
        }
        std::process::exit(1);
    })
}

/// Seal registration: every server-rendered route must be bound. Call before listening.
pub fn finalize(pages: &Pages) {
    pages.finalize().unwrap_or_else(|errors| {
        for error in errors {
            eprintln!("{error}");
        }
        std::process::exit(1);
    });
}

/// The build's own files, content-hashed and immutable, plus measurement setup.
pub fn with_assets<A: Embed + 'static>(router: Router) -> Router {
    forma_server::sw::configure(forma_server::sw::ServiceWorker::off())
        .expect("configured once, before the first page");
    router
        .route("/__forma_performance_blank", get(performance_blank))
        .route("/favicon.ico", get(|| async { StatusCode::NO_CONTENT }))
        .route("/sw.js", get(forma_server::sw::serve_sw::<A>))
        .route(
            "/_assets/{*filename}",
            get(forma_server::assets::serve_asset::<A>),
        )
}

// Lighthouse's neutral page precedes its cache/storage reset and trace. It must
// initialize only a same-origin renderer, never any application code or assets.
async fn performance_blank() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            ),
        ],
        "<!doctype html><title>Forma measurement setup</title>",
    )
}

/// A rendered page as the response, with the walker's own counts in a header the
/// fixtures' specs read (`nodes=…; bytes=…; list=…`). The header is the fixtures',
/// not Forma's: it exists so a page's size is measured by the walker, not guessed.
/// A coded failure is logged by code and route and answered with a bare 500; the
/// error never reaches the response and no shell takes the page's place.
pub fn respond(result: Result<forma_server::PageResponse, RenderError>) -> Response {
    match result {
        Ok(page) => {
            let counts = page.counts();
            let mut response = page.into_response();
            if let Ok(value) = HeaderValue::from_str(&format!(
                "nodes={}; bytes={}; list={}",
                counts.nodes, counts.bytes, counts.list_iterations
            )) {
                response.headers_mut().insert("x-fixture-counts", value);
            }
            response
        }
        Err(error) => {
            tracing::error!(code = error.code(), route = error.route(), "{error}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                [
                    (header::CACHE_CONTROL, "no-store"),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                ],
                "Internal Server Error",
            )
                .into_response()
        }
    }
}

/// Listen on `FORMA_PORT` (default 0: any free port) on 127.0.0.1 and print
/// `FORMA_LISTENING http://127.0.0.1:<port>` once this process owns the socket.
pub async fn serve(router: Router) {
    let port = match std::env::var("FORMA_PORT") {
        Ok(value) if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) => {
            value.parse::<u16>().unwrap_or_else(|_| {
                eprintln!("FORMA_PORT must be an integer from 0 to 65535");
                std::process::exit(1);
            })
        }
        Err(std::env::VarError::NotPresent) => 0,
        _ => {
            eprintln!("FORMA_PORT must be an integer from 0 to 65535");
            std::process::exit(1);
        }
    };
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .await
        .unwrap_or_else(|error| {
            eprintln!("fixture: cannot bind 127.0.0.1:{port}: {error}");
            std::process::exit(1);
        });
    match listener.local_addr() {
        Ok(address) => println!("FORMA_LISTENING http://{address}"),
        Err(error) => {
            eprintln!("fixture: no local address: {error}");
            std::process::exit(1);
        }
    }
    if let Err(error) = axum::serve(listener, router).await {
        eprintln!("fixture: server stopped: {error}");
        std::process::exit(1);
    }
}

/// The island's `fetch('/api/status')` target in the ledger fixture.
pub async fn instance() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        "{}",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn measurement_setup_is_inert_and_uncacheable() {
        let response = performance_blank().await.into_response();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );
        assert_eq!(
            response.headers()[header::CONTENT_SECURITY_POLICY],
            "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        );
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .expect("bounded setup body");
        assert_eq!(
            body.as_ref(),
            b"<!doctype html><title>Forma measurement setup</title>"
        );
    }
}
