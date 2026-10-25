import { cleanup, fillElement, applyProp, COMPILED_CLEANUP, COMPILED_EVENT } from './element.js';
import { describingAdoption } from './adoption-description.js';
import { getNamespace } from './namespace.js';
import { rawHtml, type TrustedHtml } from './trusted-html.js';
import { registerDisposer } from '../reactive/root.js';
import { adoptionListener } from '../reactive/adoption-events.js';
import { reportError } from '../reactive/dev.js';

/** @internal Paths use childNodes. Kind 1 owns the target's sole child slot. */
export type CompiledBinding = readonly [path: readonly number[], kind: 0 | 1 | 2, key?: string];

type Revocation = (() => void) & {
  values: unknown[] | null;
  root: HTMLElement | null;
  nodes: Element[] | null;
  document: Document | null;
  initializing: boolean;
};
type BoundElement = Element & {
  [COMPILED_EVENT]?: Revocation;
  [COMPILED_CLEANUP]?: Revocation;
  [EVENT_SLOT]?: number;
};
const EVENT_SLOT = Symbol('forma-compiled-event-slot');
const documents = new WeakMap<Document, number>();

// One bubbling listener per document. Detached trees and noncomposed shadow
// events deliberately do not enter the compiled-click contract. Walking the
// real path once also handles nested compiled roots without duplicate calls.
function dispatch(event: Event): void {
  const previous = Object.getOwnPropertyDescriptor(event, 'currentTarget');
  try {
    for (const node of event.composedPath()) {
      const el = node as BoundElement;
      const record = el[COMPILED_EVENT];
      const value = record?.values?.[el[EVENT_SLOT]!];
      if (value != null) {
        Object.defineProperty(event, 'currentTarget', { configurable: true, value: el });
        try {
          if (typeof value === 'function') value.call(el, event);
          else (value as EventListenerObject).handleEvent(event);
        } catch (error) {
          reportError(error, 'compiled event');
        }
      }
      if (event.cancelBubble) break;
    }
  } finally {
    if (previous) Object.defineProperty(event, 'currentTarget', previous);
    else delete (event as unknown as { currentTarget?: EventTarget | null }).currentTarget;
  }
}

function retain(doc: Document): void {
  const count = documents.get(doc) ?? 0;
  if (!count) doc.addEventListener('click', dispatch);
  documents.set(doc, count + 1);
}

function release(doc: Document): void {
  const count = documents.get(doc)! - 1;
  if (count) documents.set(doc, count);
  else {
    doc.removeEventListener('click', dispatch);
    documents.delete(doc);
  }
}

function cleanBinding(node: Element, kind: number): void {
  cleanup(node);
  // Unknown Node/array children may carry ordinary h() listeners. Their
  // actual live descendants must be cleaned even though the static template
  // itself has no per-element native click listeners.
  if (kind === 1 && node.firstElementChild) {
    for (const child of node.querySelectorAll('*')) cleanup(child);
  }
}

type Initialize = (bind?: (index: number, value: unknown) => void) => HTMLElement | void;

/**
 * Compiler-only HTML construction. The compiler supplies escaped, closed
 * markup and descriptors for every dynamic slot. The staged initializer
 * preserves expression evaluation interleaved with initial binding effects.
 * Its undefined-binder branch constructs the original JSX exactly once.
 * No DOM or Trusted Types policy is touched until the first CSR invocation.
 */
export function __createCompiledTemplate(
  markup: () => TrustedHtml,
  bindings: readonly CompiledBinding[],
): (initialize: Initialize) => HTMLElement {
  let template: HTMLTemplateElement | undefined;
  return (initialize) => {
    if (describingAdoption || getNamespace() !== null) return initialize() as HTMLElement;
    if (!template) {
      const next = document.createElement('template');
      next.innerHTML = rawHtml(markup(), 'template');
      template = next;
    }
    if (template.content.childNodes.length !== 1 || !template.content.firstElementChild) return initialize() as HTMLElement;
    const root = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    // Resolve all paths before a child slot can alter the cloned structure.
    const nodes: Element[] = [];
    for (const [path, kind, key] of bindings) {
      let node: Node | undefined = root;
      for (const index of path) node = Number.isInteger(index) && index >= 0 ? node?.childNodes[index] : undefined;
      if (!node || node.nodeType !== 1 || (kind === 0 && key === undefined)) return initialize() as HTMLElement;
      nodes.push(node as Element);
    }
    // The disposer is also the shared liveness record: no second row scope,
    // per-handler disposer, WeakMap entry object, or per-row registry walk.
    const revoke = function stop() {
      const self = stop as Revocation;
      const current = self.root;
      if (!current) return;
      const targets = self.nodes!;
      const doc = self.document;
      self.root = null;
      // A binding may dispose its owner during its first reader. The rest of
      // that same synchronous initializer must still evaluate/apply in order;
      // retain only its targets until the initializer's finally releases them.
      if (!self.initializing) self.nodes = null;
      self.values = null;
      self.document = null;
      if (doc) release(doc);
      cleanup(current);
      for (let i = 0; i < bindings.length; i++) {
        const kind = bindings[i]![1];
        if (kind !== 2) cleanBinding(targets[i]!, kind);
      }
    } as Revocation;
    revoke.values = null;
    revoke.root = root;
    revoke.nodes = nodes;
    revoke.document = null;
    revoke.initializing = true;
    (root as BoundElement)[COMPILED_CLEANUP] = revoke;
    registerDisposer(revoke);
    try {
      initialize((i, value) => {
        if (!revoke.initializing || !Number.isInteger(i) || i < 0 || i >= bindings.length) {
          throw new Error('FORMA_E_COMPILED_BINDING: binding outside its initializer or invalid slot');
        }
        const [, kind, key] = bindings[i]!;
        const node = revoke.nodes![i]!;
        try {
          if (kind === 0) applyProp(node, key!, value);
          else if (kind === 1) fillElement(node, null, [value]);
          else if (typeof value === 'function' ||
            (typeof value === 'object' && value !== null && typeof (value as EventListenerObject).handleEvent === 'function')) {
            const listener = adoptionListener(value as EventListenerOrEventListenerObject);
            // Capturing a wrapper can itself run code. Never publish a late
            // handler or retain a document after synchronous owner disposal.
            if (!revoke.root) return;
            (revoke.values ??= [])[i] = listener;
            (node as BoundElement)[COMPILED_EVENT] = revoke;
            (node as BoundElement)[EVENT_SLOT] = i;
            if (!revoke.document) {
              revoke.document = template!.ownerDocument;
              retain(revoke.document);
            }
          } else fillElement(node, { onClick: value }, []);
        } finally {
          // Disposal may precede this binding or happen inside its reader.
          // Apply it for its normal expression/effect semantics, then revoke
          // any newly produced native listeners. Root setup finalization also
          // drains the effects registered after its synchronous dispose call.
          if (!revoke.root && kind !== 2) cleanBinding(node, kind);
        }
      });
    } catch (error) {
      revoke();
      throw error;
    } finally {
      revoke.initializing = false;
      if (!revoke.root) revoke.nodes = null;
    }
    return root;
  };
}
