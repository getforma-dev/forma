//! Explicit per-response compression; default `PageResponse` remains unchanged.

use super::PageResponse;
use axum::body::Body;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use std::io::{Cursor, Write};

const MIN_COMPRESS_BYTES: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Coding {
    Brotli,
    Gzip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Negotiated {
    Identity,
    Encoded { coding: Coding, identity: bool },
    NotAcceptable,
}

/// A page explicitly opted into content-encoding negotiation.
///
/// Created only by [`PageResponse::with_compression`]. Sending it preserves the
/// original page's CSP, nonce and no-store policy. Compression happens once when
/// converting it into the Axum response, and never reuses another request's body.
#[derive(Debug)]
pub struct CompressedPageResponse {
    page: PageResponse,
    negotiated: Negotiated,
}

impl CompressedPageResponse {
    pub(super) fn new(page: PageResponse, request_headers: &HeaderMap) -> Self {
        Self {
            page,
            negotiated: negotiate(request_headers),
        }
    }

    /// The render counters before compression; `bytes` still means walked HTML.
    pub fn counts(&self) -> super::RenderCounts {
        self.page.counts()
    }
}

// Reuse the asset parser's tokens/q-values. Response negotiation additionally
// implements wildcard/identity and combines all field lines. A duplicated token
// uses the lowest quality, so an explicit refusal cannot be overridden by order.
fn negotiate(headers: &HeaderMap) -> Negotiated {
    let mut qualities: [Option<f32>; 4] = [None; 4];
    for header in headers.get_all(header::ACCEPT_ENCODING) {
        let Ok(value) = header.to_str() else { continue };
        let lower = value.to_ascii_lowercase();
        for entry in crate::assets::parse_accept_encoding(&lower) {
            let index = match entry.token {
                "br" => 0,
                "gzip" => 1,
                "identity" => 2,
                "*" => 3,
                _ => continue,
            };
            let q = if entry.q.is_finite() { entry.q } else { 0.0 };
            qualities[index] = Some(qualities[index].map_or(q, |old| old.min(q)));
        }
    }
    let [br, gzip, identity, wildcard] = qualities;
    let br = br.or(wildcard).unwrap_or(0.0);
    let gzip = gzip.or(wildcard).unwrap_or(0.0);
    let identity_allowed = identity.unwrap_or(if wildcard == Some(0.0) { 0.0 } else { 1.0 }) > 0.0;
    let (coding, quality) = if br >= gzip {
        (Coding::Brotli, br)
    } else {
        (Coding::Gzip, gzip)
    };
    if quality > 0.0 && !identity.is_some_and(|q| q > quality) {
        Negotiated::Encoded {
            coding,
            identity: identity_allowed,
        }
    } else if identity_allowed {
        Negotiated::Identity
    } else {
        Negotiated::NotAcceptable
    }
}

fn encode(html: &[u8], coding: Coding, level: u32) -> std::io::Result<Vec<u8>> {
    match coding {
        Coding::Brotli => {
            let mut encoded = Vec::new();
            let parameters = brotli::enc::BrotliEncoderParams {
                quality: level as i32,
                lgwin: 20,
                ..Default::default()
            };
            brotli::BrotliCompress(&mut Cursor::new(html), &mut encoded, &parameters)?;
            Ok(encoded)
        }
        Coding::Gzip => {
            let mut encoder =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::new(level));
            encoder.write_all(html)?;
            encoder.finish()
        }
    }
}

impl IntoResponse for CompressedPageResponse {
    fn into_response(self) -> Response {
        let headers = self.page.headers();
        let mut coding = None;
        let mut status = self.page.status;
        let body = match self.negotiated {
            Negotiated::Identity => self.page.html.into_bytes(),
            Negotiated::NotAcceptable => {
                status = StatusCode::NOT_ACCEPTABLE;
                Vec::new()
            }
            Negotiated::Encoded {
                coding: selected,
                identity,
            } => {
                if identity && self.page.html.len() < MIN_COMPRESS_BYTES {
                    self.page.html.into_bytes()
                } else {
                    match encode(self.page.html.as_bytes(), selected, 4) {
                        Ok(encoded) if !identity || encoded.len() < self.page.html.len() => {
                            coding = Some(selected);
                            encoded
                        }
                        Ok(_) => self.page.html.into_bytes(),
                        Err(error) => {
                            tracing::error!(%error, "page compression failed");
                            if identity {
                                self.page.html.into_bytes()
                            } else {
                                status = StatusCode::INTERNAL_SERVER_ERROR;
                                Vec::new()
                            }
                        }
                    }
                }
            }
        };
        let length = body.len();
        let mut response = Response::new(Body::from(body));
        *response.status_mut() = status;
        let map = response.headers_mut();
        for (name, value) in headers {
            map.append(name, value);
        }
        map.append(header::VARY, HeaderValue::from_static("Accept-Encoding"));
        map.insert(header::CONTENT_LENGTH, HeaderValue::from(length));
        if let Some(coding) = coding {
            map.insert(
                header::CONTENT_ENCODING,
                HeaderValue::from_static(match coding {
                    Coding::Brotli => "br",
                    Coding::Gzip => "gzip",
                }),
            );
        }
        response
    }
}

#[cfg(test)]
mod tests;
