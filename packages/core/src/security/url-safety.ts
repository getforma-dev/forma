/**
 * URL / attribute safety helpers shared by the SSR renderer (`src/ssr`), the
 * DOM runtime (`src/runtime.ts`) and the client element factory (`src/dom`).
 *
 * The subtle part is scheme detection. Browsers strip ASCII whitespace and C0
 * control characters out of a URL before resolving its scheme, so
 * `java\tscript:alert(1)`, `javas\ncript:...` and `\x01javascript:...` all
 * execute even though a naive `/^javascript:/` test does not match them. We
 * apply Forma's conservative classification normalization *before* testing.
 *
 * This module has no dependencies so it can be pulled into every build variant
 * (standard, hardened/CSP, SSR) cheaply.
 */

// C0 controls + space (0x00-0x20), DEL and C1 controls (0x7F-0x9F). These are
// Forma's conservative classification set; see docs/INV1.md.
const URL_IGNORED_CHARS_RE = /[\u0000-\u0020\u007F-\u009F]/g;

// Schemes that can execute script or smuggle an active HTML document. Kept
// intentionally narrow so legitimate `data:image/*` inline assets still render.
const DANGEROUS_SCHEME_RE = /^(?:javascript|vbscript|data:text\/html)/i;

// `data:image/svg+xml` is a *conditional* hazard, which is why it is not in the
// blanket blocklist above: through an image sink (`<img src>`, `<video poster>`,
// `<body background>`) the browser decodes it in image mode, where script and
// external references never run; through a document sink (`<iframe src>`,
// `<object data>`, `<a href>`, `<use href>`) it is parsed as a document and an
// `onload=` inside it fires. `isDangerousUrl` therefore rejects it unless the
// caller names an image-context tag — see IMAGE_CONTEXT_TAGS.
const SVG_DATA_URL_RE = /^data:image\/svg\+xml/i;

/**
 * Tags whose URL-bearing attributes are always fetched as an image or media
 * resource, never parsed as a document: `<img src>`, `<image href>` (SVG),
 * `<video poster>`/`<video src>`, `<audio src>`, `<source src>` and the legacy
 * `background` attribute on `<body>` and table elements. Only these may carry a
 * `data:image/svg+xml` value; every other tag (and any call site that does not
 * name a tag) gets the strict interpretation.
 *
 * Verified by: src/security/__tests__/url-safety.test.ts > "allows data:image/svg+xml for image-context sinks"
 */
const IMAGE_CONTEXT_TAGS = new Set([
  'img',
  'image',
  'video',
  'audio',
  'source',
  'body',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
]);

/**
 * Attributes whose values are resolved as URLs and must be scheme-checked.
 *
 * `data` is here for `<object data>`, which loads its target as a document.
 * `srcset` is deliberately absent: its value is a comma-separated candidate
 * list with descriptors (so a single scheme test would not parse it correctly),
 * and every candidate is fetched in image mode.
 */
export const URL_ATTRS = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'poster',
  'background',
  'data',
]);

/** True if `name` is a URL-bearing attribute (case-insensitive). */
export function isUrlAttr(name: string): boolean {
  return URL_ATTRS.has(name.toLowerCase());
}

/**
 * True if `value` uses a scheme that can execute script, after normalizing away
 * the whitespace and control characters that browsers ignore in a URL scheme.
 *
 * `tag` is the element the value is about to be written to (`el.localName` or
 * `VNode.tag`). It only relaxes the `data:image/svg+xml` rule, and only for the
 * image-context tags listed above; omitting it selects the strict
 * interpretation, so a call site that forgets to pass one fails safe.
 *
 * A NUL anywhere in the value is refused outright (FORMA-182 review S1):
 * no author writes one, and the U+FFFD that rule-1 normalization would turn
 * it into is not ignored by the URL parser, so `java\0script:` would be
 * written as `java�script:` and resolved and fetched as a same-origin
 * relative reference in every engine. Callers pass the raw value here and
 * write the normalized one; for every other character the strip below makes
 * the two views agree.
 *
 * Verified by: src/security/__tests__/url-safety.test.ts > "blocks data:image/svg+xml when no tag is supplied"
 * Verified by: src/security/__tests__/url-safety.test.ts > "refuses a NUL anywhere in the value, not only in the scheme"
 */
export function isDangerousUrl(value: string, tag?: string): boolean {
  if (value.includes('\0')) return true;
  const normalized = value.replace(URL_IGNORED_CHARS_RE, '');
  if (DANGEROUS_SCHEME_RE.test(normalized)) return true;
  if (SVG_DATA_URL_RE.test(normalized)) {
    return tag === undefined || !IMAGE_CONTEXT_TAGS.has(tag.toLowerCase());
  }
  return false;
}

/** True for any `on…` event-handler attribute name (case-insensitive). */
export function isEventHandlerAttr(name: string): boolean {
  return /^on/i.test(name);
}

/**
 * True if `value` written to attribute `name` on a `<tag>` element would be a
 * URL with a script scheme: a URL attribute (judged against `tag`), or an SVG
 * animation value attribute any `;`-separated item of which is one (`values`
 * is a list; a split of the other three can only refuse more).
 *
 * The animation value attributes (FORMA-277) are `to`, `from`, `by` and
 * `values` on `<set>` and on every `<animate…>` element (`animate`,
 * `animateTransform`, `animateMotion`, `animateColor`: a tag that is
 * `animate` followed by letters, digits or `_` only), tag and name in any
 * case. An animation element's `attributeName` can name a URL attribute
 * (`href`, `xlink:href`), so its values are judged as URLs, item by item.
 * They are judged whatever `attributeName` says, so the order the two are
 * written in, or a later change of `attributeName` by a binding or an
 * update, cannot let a value through. Each item is judged with no image
 * context, since the target is not known, so `data:image/svg+xml` is refused
 * there too. Numbers, coordinates, transforms and colours are never script
 * URLs, so animations of other attributes keep their values.
 *
 * This is `isUnsafeAttrWrite`'s URL half, called on its own by the sinks that
 * refuse an `on*` name themselves first: h(), hydration adoption,
 * `data-bind:`, row attributes and the preview frame's strip.
 *
 * Verified by: src/__tests__/renderer-contract.test.ts > "drops every script scheme written to <%s %s>"
 * Verified by: src/__tests__/renderer-contract.test.ts > "keeps ordinary animation values on <%s %s>"
 * Verified by: src/__tests__/renderer-contract.test.ts > "judges only the value attributes of <set> and every <animate*> element: other tags and attributes keep the text"
 * Verified by: src/security/__tests__/url-safety.test.ts > "keeps the values real animations use on every animation element"
 */
export function isDangerousUrlAttr(tag: string, name: string, value: string): boolean {
  return isUrlAttr(name)
    ? isDangerousUrl(value, tag)
    : /^(to|from|by|values) (set|animate\w*)$/i.test(name + ' ' + tag) && value.split(';').some((item) => isDangerousUrl(item));
}

/**
 * True when writing `value` to attribute `name` on a `<tag>` element would
 * create an XSS sink, so the write must be skipped. Shared by every client-side
 * attribute write: the expression interpreter's `$el` attribute writes and the
 * reconciler's update call it whole, and the sinks that refuse an `on*` name
 * themselves call its URL half, `isDangerousUrlAttr`. So those paths drop
 * exactly what the SSR walker drops — otherwise a payload the server refused
 * to emit is re-added on the client at hydration.
 *
 * Verified by: src/dom/__tests__/element-url-safety.test.ts > "drops a javascript: href written through h()"
 */
export function isUnsafeAttrWrite(tag: string, name: string, value: string): boolean {
  return isEventHandlerAttr(name) || isDangerousUrlAttr(tag, name, value);
}

/**
 * Attributes whose value the browser parses as HTML rather than as text.
 * Attribute escaping does NOT neutralize these: the parser entity-decodes the
 * attribute and then parses the result as a document, so an escaped payload
 * still executes. They are supported (a sandboxed `<iframe srcdoc>` is a
 * legitimate pattern) but treated as a trusted-content sink like
 * `dangerouslySetInnerHTML`: callers must provide TrustedHtml.
 *
 * Verified by: src/dom/__tests__/element-url-safety.test.ts > "srcdoc requires trustedHtml and strings are refused before the sink"
 */
export const RAW_HTML_ATTRS = new Set(['srcdoc']);

/** True if `name` is an attribute whose value is parsed as HTML. */
export function isRawHtmlAttr(name: string): boolean {
  return RAW_HTML_ATTRS.has(name.toLowerCase());
}

// A well-formed HTML attribute name: starts with a letter/`_`/`:`, followed by
// letters, digits, `-`, `_`, `:` or `.`. Rejects whitespace, `=`, quotes and
// `/`, which is what an attacker needs to break out and inject a new attribute.
const SAFE_ATTR_NAME_RE = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;

/** True if `name` is safe to emit verbatim as an attribute name. */
export function isSafeAttrName(name: string): boolean {
  if (!SAFE_ATTR_NAME_RE.test(name)) return false;
  // The xlink writer uses setAttributeNS, which needs one nonempty local name.
  const local = name.startsWith('xlink:') ? name.slice(6) : null;
  return local === null || (SAFE_ATTR_NAME_RE.test(local) && !local.includes(':'));
}

/**
 * True if `tag` is safe to emit verbatim as an element name. A tag is
 * interpolated into markup with no escaping, so the same charset that stops an
 * attribute name from breaking out of its position stops a tag name from
 * introducing an attribute (`div onload=x`) or closing the tag (`div><script`).
 * This deliberately accepts an ASCII subset, matching the native writer.
 * Unicode names are refused even where the DOM itself would accept them.
 *
 * Verified by: src/security/__tests__/url-safety.test.ts > "rejects tag names that would inject attributes or close the tag"
 */
export function isSafeTagName(tag: string): boolean {
  return SAFE_ATTR_NAME_RE.test(tag);
}
