/** Private preparation of CSS and typed raw content. Inputs have already been
 * read by the owning preparation scope. Only returned write methods mutate the
 * live element; this module never installs reactions or invokes a reader. */
import { applyStyleObj, parseCssString } from './element.js';
import { AdoptionDomError } from './adoption-plan.js';
import { rawHtml } from './trusted-html.js';

export interface PreparedStyle { write(next: unknown): void }
export interface PreparedRaw {
  /** Initial raw content is opaque; false leaves fallback children to the walker. */
  readonly ownsContent: boolean;
  /** The owner disposes fallback/nested ownership only before a real replacement. */
  write(next: unknown, beforeReplace?: () => void): void;
}
function mismatch(): never { throw new AdoptionDomError('FORMA_E_HYDRATE_VALUE'); }
function context(element: Element): Element {
  // A fresh document has no active custom-element registry or browsing context.
  // Namespace/tag, MathML integration encoding and nearest HTML form are
  // the finite fragment-parser inputs used here; copy no executable content.
  const document = element.ownerDocument.implementation.createHTMLDocument();
  const mirror = document.createElementNS(element.namespaceURI, element.localName);
  if (element.namespaceURI === 'http://www.w3.org/1998/Math/MathML' && element.localName === 'annotation-xml') {
    const encoding = element.getAttribute('encoding');
    if (encoding !== null) mirror.setAttribute('encoding', encoding);
  }
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.namespaceURI === 'http://www.w3.org/1999/xhtml' && parent.localName === 'form') {
      document.createElement('form').appendChild(mirror); break;
    }
  }
  return mirror;
}
function cssOf(element: Element): CSSStyleDeclaration {
  const style = (element as HTMLElement | SVGElement).style;
  if (!style) throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');
  return style;
}
function declarations(value: unknown): Record<string, string> {
  if (value == null || value === false) return Object.create(null) as Record<string, string>;
  const input = typeof value === 'string' ? parseCssString(value) : value;
  if (!input || typeof input !== 'object' || Array.isArray(input)) mismatch();
  const result: Record<string, string> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    const field = Object.getOwnPropertyDescriptor(input, key)!;
    if (!field.enumerable) continue;
    if (typeof key !== 'string' || key === 'cssText' || key in Object.prototype || !('value' in field)) mismatch();
    const item: unknown = field.value;
    if (typeof item !== 'string' && !(typeof item === 'number' && Number.isFinite(item))) mismatch();
    result[key] = String(item);
  }
  return result;
}
function applyDeclarations(element: Element, fields: Record<string, string>, keys: string[]): string[] {
  const style = cssOf(element);
  // CSSOM methods/readonly metadata are not declarations. Unknown CSS names
  // retain the shared writer's ordinary behavior; no new CSS grammar is added.
  for (const key of Object.keys(fields)) {
    const member: unknown = (style as unknown as Record<string, unknown>)[key];
    if (member !== undefined && typeof member !== 'string') mismatch();
  }
  return applyStyleObj(element, fields, keys);
}
function normalizedStyle(element: Element): string {
  const style = cssOf(element);
  return JSON.stringify(Array.from({ length: style.length }, (_, i) => style.item(i)).sort()
    .map(key => [key, style.getPropertyValue(key), style.getPropertyPriority(key)]));
}
/** Compare browser-normalized declarations using the existing CSSOM policy.
 * Object fields are own data, strings/finite numbers only. This direct-hydrate
 * facade support does not make compiler-diagnosed object styles native products. */
export function prepareStyle(element: Element, initial: unknown): PreparedStyle {
  const expected = context(element), first = declarations(initial);
  let keys = applyDeclarations(expected, first, []), previous = normalizedStyle(expected);
  if (normalizedStyle(element) !== previous) mismatch();
  return {
    write(next) {
      // Existing reactive style policy ignores nullish/false updates. An empty
      // string/object explicitly removes this binding's previous declarations.
      if (next == null || next === false) return;
      const fields = declarations(next), mirror = context(element);
      applyDeclarations(mirror, fields, []);
      const normalized = normalizedStyle(mirror);
      if (normalized === previous) return;
      keys = applyDeclarations(element, fields, keys);
      previous = normalized;
    },
  };
}
function typedMarkup(value: unknown): string {
  if (value === null || typeof value !== 'object') return rawHtml(value, 'innerHTML');
  const field = Object.getOwnPropertyDescriptor(value, '__html');
  // Refuse inherited/accessor fields without invoking them. rawHtml supplies
  // the existing coded typed-policy refusal, before any parser/cache fast path.
  return rawHtml(field && 'value' in field ? field.value : undefined, 'innerHTML');
}
/** Validate in the real element's fragment-parsing context, keeping the
 * TrustedHTML object typed at both detached and later live sinks. Raw marker
 * text is opaque; the caller must not ask AdoptionDom to parse these children. */
export function prepareRaw(element: Element, initial: unknown): PreparedRaw {
  const ownsContent = initial != null && initial !== false;
  let previous: string | null = null;
  if (ownsContent) {
    const sink = typedMarkup(initial), expected = context(element);
    expected.innerHTML = sink;
    if (expected.innerHTML !== element.innerHTML) mismatch();
    previous = String(sink);
  }
  return {
    ownsContent,
    write(next, beforeReplace) {
      if (next == null || next === false) {
        if (element.firstChild) { beforeReplace?.(); element.replaceChildren(); }
        previous = null;
        return;
      }
      const sink = typedMarkup(next), markup = String(sink);
      if (markup === previous) return;
      beforeReplace?.();
      element.innerHTML = sink;
      previous = markup;
    },
  };
}
