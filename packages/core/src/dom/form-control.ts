/** Shared live-property writes for client construction and SSR adoption. */
export function isFormControlProperty(el: Element, key: string): boolean {
  if (key === 'value') {
    return el instanceof HTMLInputElement
      || el instanceof HTMLTextAreaElement
      || el instanceof HTMLSelectElement
      || el instanceof HTMLOptionElement;
  }
  return (key === 'checked' && el instanceof HTMLInputElement)
    || (key === 'selected' && el instanceof HTMLOptionElement);
}

/**
 * Attributes represent defaults, not the live state after user interaction.
 * Compare against the actual property rather than an attribute cache: a user
 * may have edited it even when the next binding result equals its last result.
 */
export function writeFormControlProperty(el: Element, key: string, value: unknown): void {
  // Reactive textarea children are controlled in3.x. Keep their RCDATA
  // default text and live value coherent, including after a later user edit.
  if (key === 'text') {
    const area = el as HTMLTextAreaElement, next = value == null ? '' : String(value);
    if (area.defaultValue !== next) area.defaultValue = next;
    if (area.value !== next) area.value = next;
    return;
  }
  if (key === 'value') {
    const control = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLOptionElement;
    if (control instanceof HTMLSelectElement && control.multiple && Array.isArray(value)) {
      const selected = new Set(value.map(String));
      for (const option of Array.from(control.options)) {
        const next = selected.has(option.value);
        if (option.selected !== next) option.selected = next;
      }
      return;
    }
    const next = value == null ? '' : String(value);
    // Browsers only allow clearing a file input programmatically.
    if (control instanceof HTMLInputElement && control.type === 'file' && next !== '') return;
    // Keep the existing markup/default-value contract; it is not a substitute
    // for the live-property write below once the browser's dirty flag is set.
    if (value == null) el.removeAttribute('value');
    else if (el.getAttribute('value') !== next) el.setAttribute('value', next);
    // An option has no live value apart from its attribute: its `value` setter
    // writes the attribute, so assigning '' for null would make it submit ''
    // instead of its text.
    // Verified by: src/dom/__tests__/form-control-adoption.test.ts > "an option bound to undefined or null submits its text, client-rendered and adopted"
    if (control instanceof HTMLOptionElement) return;
    if (control.value !== next) control.value = next;
    return;
  }

  const next = Boolean(value);
  if (key === 'checked') {
    const input = el as HTMLInputElement;
    if (input.checked !== next) input.checked = next;
  } else {
    const option = el as HTMLOptionElement;
    if (option.selected !== next) option.selected = next;
  }
  // Preserve the boolean-attribute contract for markup/default state as well.
  const attribute = key === 'checked' ? 'checked' : 'selected';
  if (next) el.setAttribute(attribute, '');
  else el.removeAttribute(attribute);
}

// ---------------------------------------------------------------------------
// A textarea's reactive text: bound by the element as controlled live/default state
// ---------------------------------------------------------------------------

/**
 * Whether `children` are text the element should bind as one value: at least
 * one reactive function, and otherwise only strings, numbers, booleans and
 * nullish holes. Anything else (an element, a show or list region) is left to
 * the ordinary child walk.
 */
export function isReactiveTextOnly(children: unknown[]): boolean {
  let reactive = false;
  for (const child of children) {
    if (typeof child === 'function') reactive = true;
    else if (child != null && typeof child !== 'string' && typeof child !== 'number' && typeof child !== 'boolean') return false;
  }
  return reactive;
}

/** The text of `children`: a function's current result, nothing for nullish and booleans. */
export function childText(children: unknown[]): string {
  let text = '';
  for (const child of children) {
    const value = typeof child === 'function' ? (child as () => unknown)() : child;
    if (value != null && typeof value !== 'boolean') text += String(value);
  }
  return text;
}

