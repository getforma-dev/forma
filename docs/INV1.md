# INV1: attribute names and URL values

The native renderer and core share the vectors in
`crates/forma-ir/tests/fixtures/parity/inv1.json`. The native walker executes each
case through static and dynamic attributes; core executes static and reactive
`h()`, strict adoption expectations and later writes. Browser tests replay every
name/URL vector in Chromium, Firefox and WebKit. Changes to this policy update
both readers and the shared table together.

An ordinary attribute name must match `[A-Za-z_:][-A-Za-z0-9_:.]*` in its entirety.
The rule is ASCII: Unicode letters, empty names, leading digits, whitespace,
quotes, slashes and angle brackets are refused. This deliberately retains the
stricter existing native rule; the DOM accepting a name is insufficient. A name
starting with `xlink:` also needs a nonempty local name in that grammar with no
colon, because the browser writer uses `setAttributeNS`. Both sides omit an
empty local name, a leading digit/dash, or an extra colon. Names
beginning with `on`, in any ASCII casing, never become inline handler attributes.
Authored function event props still use the existing listener API. Typed raw
markup, style, control properties and internal island metadata retain their own
policies; an accepted name grants no raw-HTML or executable-code authority.

The URL-bearing set is `href`, `src`, `action`, `formaction`, `xlink:href`,
`poster`, `background` and `data`, matched case-insensitively. Check the **raw**
value before text normalization: a NUL anywhere refuses the value. For scheme
classification, remove U+0000–U+0020 and U+007F–U+009F, lowercase ASCII, and refuse
prefixes `javascript`, `vbscript` and `data:text/html`. This is Forma's
conservative policy, not an exact implementation of the browser URL parser.
The prefixes intentionally include near misses such as `javascript-guide` and
`data:text/htmlx`; a relative path such as `/javascript-guide` is allowed. Allowed
values are subsequently written with the ordinary value normalization/escaping
rules; the classification transform does not rewrite them.

A `data:image/svg+xml` prefix is allowed only on the existing image/media-context
tag set: `img`, `image`, `video`, `audio`, `source`, `body`, `table`, `thead`,
`tbody`, `tfoot`, `tr`, `td`, `th`. Other tags and missing context refuse it. The
context check is case-insensitive. `srcset` retains its separate image-candidate
semantics; it is not parsed as a single URL by this predicate. An ordinary
`title` or `data-href` containing URL-like text remains ordinary data.

An SVG animation value is classified as a URL too (FORMA-277): `to`, `from`,
`by` and `values` on `<animate>` and `<set>`, tag and name matched
case-insensitively, because those elements write their values into the
attribute `attributeName` names, which can be `href`. The value is split on
`;` and each item is classified as above with no image context, so
`data:image/svg+xml` is refused there; a raw NUL anywhere refuses it. This
holds whatever `attributeName` says. `animateTransform`, `animateMotion`, other
attributes of an animation element (`begin`, `attributeName`) and `to` on any
other element remain ordinary data.

Refusal means omission. Fresh core drops invalid names before reading their
values; a reactive refused URL removes its prior accepted attribute. During
strict adoption, the expected value for a rejected attribute is absence. If the
served DOM contains it, validation fails with `FORMA_E_HYDRATE_VALUE`, preserves
the served nodes and attributes, and puts that island in error. It never repairs
the initial DOM. A neighboring valid island can still activate. A served omission
adopts without initial writes, and later allowed updates use the same policy.

G2's ordinary text and attribute payloads are tested as data in both languages.
Raw `srcdoc` and `dangerouslySetInnerHTML` still require the typed trusted-value
boundary from FORMA-109; this specification is not a general HTML sanitizer.

## Verification

- Native: `walker::tests::inv1_vectors`.
- Core: `packages/core/src/dom/__tests__/inv1-vectors.test.ts`, alongside the renderer contract
  and trusted-HTML suites.
- Browser: `packages/core/e2e/inv1.spec.ts`, including a rejected-name island, a working
  neighbor, retained mutation observations, and a positive later-write control.

The JavaScript unit DOM has a stale `getAttribute('xml:lang')` cache after a
second write (its actual `Attr.value` and serialized DOM change). The unit helper
reads the attribute node, and the browser replay checks native `getAttribute`
for every vector. Rejected qualified names also use the real-browser island
replay, since the model splits no-namespace colon names differently. No production
behavior is changed to accommodate that model.
