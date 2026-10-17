# Static-route fixture transition

These three originals preserve exact bytes from the source commit recorded in `manifest.json`, including SHA-256 and length. No binary fixture or frozen corpus is changed.

- `island_state.rs` previously declared an island module with an empty JavaScript list. Its active synthetic file set now includes an actual no-op module and matching digest. All projection, error-code, budget and escaping assertions stay intact; the new `static_routes` suite separately requires LOAD-109 for the old invalid combination.
- `service_worker_on.rs` formerly expected registration on a Browser page with no JS. Its positive registration case now names the existing embedded JS fixture and real manifest digest. The new policy suite proves static SSR emits no registration while the enabled worker delivery endpoint stays available. Existing off/retirement tests are unchanged.
- `typed_pages.rs` formerly exercised executable request JSON on a route with no JS. Only that test now declares a metadata-only empty JS resource; every original JSON/CSS/RawHtml/policy assertion stays. Actual resource integrity/browser qualification has separate tests, and the new static suite explicitly refuses configuration on a zero-JS route.

These changes preserve supported behavior controls while making retired combinations explicit refusals. They do not establish compiler entry filtering, actual zero-JS browser networking, or overall FORMA-105 acceptance.
