use super::*;
use crate::csp::{page_policy, CspNonce, PolicyExtensions};
use crate::RenderCounts;
use axum::body::to_bytes;
use std::io::Read;

fn headers(value: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(header::ACCEPT_ENCODING, value.parse().unwrap());
    headers
}

fn page(body: &str) -> PageResponse {
    // A deterministic nonce only for the private response fixture. Public
    // renderers still mint their own nonce and expose no override.
    let nonce = CspNonce::parse("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH").unwrap();
    let html = format!("<!doctype html><style nonce=\"{nonce}\">body{{color:black}}</style>{body}");
    let extensions = PolicyExtensions::new().report_uri("/csp-report");
    let policy = page_policy(&nonce, &extensions).unwrap();
    PageResponse::with_policy(html, nonce, policy, RenderCounts::default())
}

#[test]
fn negotiation_honors_quality_refusals_wildcards_identity_and_field_lines() {
    use Coding::{Brotli, Gzip};
    use Negotiated::{Encoded, Identity, NotAcceptable};
    for (input, expected) in [
        ("", Identity),
        ("identity", Identity),
        (
            "br",
            Encoded {
                coding: Brotli,
                identity: true,
            },
        ),
        (
            "gzip",
            Encoded {
                coding: Gzip,
                identity: true,
            },
        ),
        (
            "gzip, br",
            Encoded {
                coding: Brotli,
                identity: true,
            },
        ),
        (
            "br;q=0.3,gzip;q=0.7",
            Encoded {
                coding: Gzip,
                identity: true,
            },
        ),
        (
            "BR; Q=0, GZIP; q=1",
            Encoded {
                coding: Gzip,
                identity: true,
            },
        ),
        ("br;q=0,gzip;q=0", Identity),
        ("br;q=NaN", Identity),
        ("br;q=0,br;q=1", Identity),
        ("deflate", Identity),
        ("x-brotli-nope", Identity),
        (
            "*",
            Encoded {
                coding: Brotli,
                identity: true,
            },
        ),
        ("*;q=0", NotAcceptable),
        ("*;q=0, identity;q=1", Identity),
        (
            "*;q=1, br;q=0",
            Encoded {
                coding: Gzip,
                identity: true,
            },
        ),
        (
            "*;q=0, br;q=1",
            Encoded {
                coding: Brotli,
                identity: false,
            },
        ),
        ("br;q=0.5,identity;q=1", Identity),
        (
            "br,identity;q=0",
            Encoded {
                coding: Brotli,
                identity: false,
            },
        ),
        ("br;q=0,gzip;q=0,identity;q=0", NotAcceptable),
    ] {
        assert_eq!(negotiate(&headers(input)), expected, "{input}");
    }
    let mut multiple = headers("br;q=0");
    multiple.append(header::ACCEPT_ENCODING, "gzip;q=0.8".parse().unwrap());
    assert_eq!(
        negotiate(&multiple),
        Encoded {
            coding: Gzip,
            identity: true
        }
    );
    assert_eq!(negotiate(&HeaderMap::new()), Identity);
}

#[tokio::test]
async fn encoded_bodies_decode_to_the_same_page_with_all_policy_headers_intact() {
    for coding in ["br", "gzip"] {
        let page = page(&"<p>Escaped &amp; UTF-8 é 🦀</p>".repeat(300));
        let original = page.html.clone();
        let policy = page.headers();
        let counts = page.counts();
        let compressed = page.with_compression(&headers(coding));
        assert_eq!(compressed.counts(), counts);
        let response = compressed.into_response();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_ENCODING], coding);
        assert_eq!(response.headers()[header::VARY], "Accept-Encoding");
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        for (name, value) in policy {
            assert_eq!(response.headers()[name], value);
        }
        let length: usize = response.headers()[header::CONTENT_LENGTH]
            .to_str()
            .unwrap()
            .parse()
            .unwrap();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(body.len(), length);
        assert!(body.len() < original.len());
        let mut decoded = String::new();
        if coding == "br" {
            brotli::Decompressor::new(body.as_ref(), 4096)
                .read_to_string(&mut decoded)
                .unwrap();
        } else {
            flate2::read::GzDecoder::new(body.as_ref())
                .read_to_string(&mut decoded)
                .unwrap();
        }
        assert_eq!(decoded, original);
    }
}

#[tokio::test]
async fn identity_threshold_and_all_refused_paths_keep_headers_and_exact_body_rules() {
    for value in ["", "identity", "br;q=0,gzip;q=0"] {
        let page = page(&"content ".repeat(500));
        let expected = page.html.clone();
        let response = page.with_compression(&headers(value)).into_response();
        assert!(response.headers().get(header::CONTENT_ENCODING).is_none());
        assert_eq!(response.headers()[header::VARY], "Accept-Encoding");
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(body.as_ref(), expected.as_bytes());
    }
    for bytes in [1023, 1024] {
        let mut page = page("");
        page.html = "x".repeat(bytes);
        let response = page.with_compression(&headers("gzip")).into_response();
        assert_eq!(
            response.headers().contains_key(header::CONTENT_ENCODING),
            bytes >= 1024
        );
    }
    let response = page("tiny")
        .with_compression(&headers("gzip,identity;q=0"))
        .into_response();
    assert_eq!(response.headers()[header::CONTENT_ENCODING], "gzip");
    let response = page("secret")
        .with_compression(&headers("*;q=0"))
        .into_response();
    assert_eq!(response.status(), StatusCode::NOT_ACCEPTABLE);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(response.headers()[header::CONTENT_LENGTH], "0");
    assert!(to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn enabling_the_feature_does_not_compress_an_ordinary_page_or_change_raw_parts() {
    let expected = page(&"ordinary ".repeat(1000)).html;
    let response = page(&"ordinary ".repeat(1000)).into_response();
    assert!(!response.headers().contains_key(header::CONTENT_ENCODING));
    assert!(!response.headers().contains_key(header::VARY));
    assert_eq!(
        to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .as_ref(),
        expected.as_bytes()
    );
    let parts = page(&"ordinary ".repeat(1000)).into_parts_unchecked();
    assert_eq!(parts.html, expected);
    assert!(parts
        .headers
        .iter()
        .all(|(name, _)| name != header::CONTENT_ENCODING));
}

#[tokio::test]
async fn axum_head_has_get_headers_and_no_body_for_every_negotiated_representation() {
    use axum::{http::Request, routing::get, Router};
    use tower::ServiceExt;
    for encoding in ["br", "gzip", "identity", "*;q=0"] {
        let app = Router::new().route(
            "/",
            get(|headers: HeaderMap| async move {
                page(&"dashboard ".repeat(1000)).with_compression(&headers)
            }),
        );
        let request = |method| {
            Request::builder()
                .uri("/")
                .method(method)
                .header(header::ACCEPT_ENCODING, encoding)
                .body(Body::empty())
                .unwrap()
        };
        let get = app.clone().oneshot(request("GET")).await.unwrap();
        let head = app.oneshot(request("HEAD")).await.unwrap();
        assert_eq!(head.status(), get.status());
        assert_eq!(head.headers(), get.headers());
        assert!(to_bytes(head.into_body(), usize::MAX)
            .await
            .unwrap()
            .is_empty());
    }
}

#[test]
#[ignore = "manual per-request compression timing; use a representative HTML fixture"]
#[allow(clippy::print_stdout)]
fn compression_levels() {
    use std::time::Instant;
    let path = std::env::var("FORMA_COMPRESSION_SAMPLE").expect("HTML fixture path");
    let html = std::fs::read(path).unwrap();
    for (coding, levels) in [
        (Coding::Brotli, &[4, 5][..]),
        (Coding::Gzip, &[4, 5, 6][..]),
    ] {
        for &level in levels {
            for _ in 0..20 {
                std::hint::black_box(encode(&html, coding, level).unwrap());
            }
            let mut samples = Vec::new();
            let mut size = 0;
            for _ in 0..101 {
                let started = Instant::now();
                let encoded = encode(&html, coding, level).unwrap();
                samples.push(started.elapsed().as_nanos());
                size = encoded.len();
                std::hint::black_box(encoded);
            }
            samples.sort();
            println!(
                "coding={coding:?} level={level} raw={} encoded={size} median_ns={} p95_ns={}",
                html.len(),
                samples[50],
                samples[95]
            );
        }
    }
}
