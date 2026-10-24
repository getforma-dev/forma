import assert from 'node:assert/strict';

export function instrumentRenderCounts(source) {
  const handler = 'async fn ssr(';
  assert.equal(source.split(handler).length, 2, 'expected one SSR handler');
  const start = source.indexOf(handler), anchor = 'Ok(page) => page.into_response(),';
  const offset = source.indexOf(anchor, start);
  const nextHandler = source.indexOf('\nasync fn ', start + handler.length);
  assert(offset > start && (nextHandler === -1 || offset < nextHandler), 'SSR response instrumentation anchor drift');
  const replacement = `Ok(page) => {
            // GP_RENDER_COUNTS_INSTRUMENTATION: diagnostic binary only.
            // Capture the existing walker timer before formatting headers.
            let counts = page.counts();
            let mut response = page.into_response();
            for (name, value) in [
                ("x-gp-walk-ns", counts.walk_time.as_nanos().to_string()),
                ("x-gp-walk-bytes", counts.bytes.to_string()),
                ("x-gp-walk-nodes", counts.nodes.to_string()),
                ("x-gp-walk-rows", counts.list_iterations.to_string()),
            ] {
                response.headers_mut().insert(
                    axum::http::HeaderName::from_static(name),
                    value.parse().expect("numeric render count"),
                );
            }
            response
        },`;
  return source.slice(0, offset) + replacement + source.slice(offset + anchor.length);
}
