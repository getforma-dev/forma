/**
 * The harness's boot module: the one JavaScript entry the synthesized manifest gives route `/`, so
 * the server's own document loads it with its own nonce and integrity under its own policy. It is
 * the same bytes for every module and state (the manifest's integrity is computed once); what
 * varies arrives from `/_parity/input.json`, `/_parity/entry.mjs` and `/_parity/twin.mjs`.
 *
 * In order, on one fresh Document per state:
 * 1. P1, server side: the served root (`[data-forma-ssr]`) serialized as the browser parsed it,
 *    before any script has touched it.
 * 2. P2 (pages with islands): a MutationObserver armed over the served root, the module's
 *    production entry imported (its evaluation is `activateIslands` with the compiled
 *    registrations), records drained through a microtask and a macrotask; then the positive
 *    control: the same observer configuration must see one deliberate write.
 * 3. P3 (a module that names a setter): the entry's `__parityTransition` called with the next
 *    state's props, a microtask and a macrotask, and the served root serialized again (the adopted
 *    DOM as the islands left it), for comparison with the next state's own server render.
 * 4. P1, client side: core's render of the same state (`mount(() => Page(props), host)`) in a
 *    fresh host, serialized.
 * Console errors, uncaught errors and policy violations are recorded with the step they happened in.
 */
import { canonicalizeDom } from './dom-canon.mts';
import type { Schema } from './generate.mts';
import { CORE_URL } from './bundle.mts';

/** Revive dates (epoch milliseconds on the wire) into `Date` by the schema, as core's decoder does. Runs in the page. */
export function reviveByType(value: unknown, type: { kind: string; element?: unknown; inner?: unknown; object?: number }, schema: Schema): unknown {
  if (value === null || value === undefined) return value;
  switch (type.kind) {
    case 'date': return new Date(value as number);
    case 'optional': return reviveByType(value, type.inner as typeof type, schema);
    case 'array': return (value as unknown[]).map(item => reviveByType(item, type.element as typeof type, schema));
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const field of schema[type.object as number] ?? []) {
        const inner = (value as Record<string, unknown>)[field.name];
        if (inner !== undefined) out[field.name] = reviveByType(inner, field.type as typeof type, schema);
      }
      return out;
    }
    default: return value;
  }
}

/** A mutation record as data: its type, the DOM path of its target from the served root, the values. Runs in the page. */
export function describeRecord(record: MutationRecord, root: Node): Record<string, unknown> {
  const steps: string[] = [];
  for (let node: Node | null = record.target; node && node !== root; node = node.parentNode) {
    const parent: Node | null = node.parentNode;
    if (!parent) { steps.unshift('(detached)'); break; }
    const index = Array.prototype.indexOf.call(parent.childNodes, node) + 1;
    steps.unshift(node.nodeType === 1 ? `${(node as Element).localName}[node ${index}]` : node.nodeType === 3 ? `#text[node ${index}]` : `#comment[node ${index}]`);
  }
  const target = record.target as Element & CharacterData;
  return {
    type: record.type,
    path: ['root', ...steps].join(' > '),
    attribute: record.attributeName,
    oldValue: record.oldValue,
    value: record.type === 'attributes' ? target.getAttribute(record.attributeName!) : record.type === 'characterData' ? target.data : null,
    added: Array.from(record.addedNodes, node => node.nodeName),
    removed: Array.from(record.removedNodes, node => node.nodeName),
  };
}

export const BOOT_SOURCE = `// FORMA-183 parity harness boot (e2e/parity/src/boot.mts)
import { mount } from '${CORE_URL}';
const canonicalizeDom = ${canonicalizeDom.toString()};
const reviveByType = ${reviveByType.toString()};
const describeRecord = ${describeRecord.toString()};
const step = { name: 'boot' };
const logged = [];
const violations = [];
const original = console.error.bind(console);
console.error = (...args) => {
  logged.push({ step: step.name, text: args.map(a => (a instanceof Error ? a.message : String(a))).join(' ') });
  original(...args);
};
window.addEventListener('error', event => logged.push({ step: step.name, text: 'uncaught: ' + event.message }));
window.addEventListener('unhandledrejection', event => logged.push({ step: step.name, text: 'unhandled rejection: ' + String(event.reason) }));
document.addEventListener('securitypolicyviolation', event => violations.push({ step: step.name, text: event.violatedDirective + ' ' + event.blockedURI }));
// The name and message first, then the stack: Firefox's and WebKit's stacks do not begin with the message.
const describeError = error => (error instanceof Error ? error.name + ': ' + error.message + '\\n' + (error.stack || '') : String(error));
const settle = async () => { await new Promise(resolve => queueMicrotask(resolve)); await new Promise(resolve => setTimeout(resolve, 0)); };
(async () => {
  try {
    const input = await (await fetch('/_parity/input.json')).json();
    const root = document.querySelector('[data-forma-ssr]');
    if (!root) throw new Error('the served document has no [data-forma-ssr] root');
    step.name = 'served';
    const served = canonicalizeDom(root);
    let p2 = null;
    if (input.entry) {
      step.name = 'P2';
      const records = [];
      const events = [];
      root.addEventListener('forma:error', event => events.push(JSON.stringify(event.detail)));
      const observer = new MutationObserver(list => { for (const record of list) records.push(describeRecord(record, root)); });
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
      await import('/_parity/entry.mjs');
      await settle();
      for (const record of observer.takeRecords()) records.push(describeRecord(record, root));
      observer.disconnect();
      const control = new MutationObserver(() => {});
      control.observe(root, { subtree: true, attributes: true });
      root.setAttribute('data-parity-control', '');
      const caught = control.takeRecords().length;
      control.disconnect();
      root.removeAttribute('data-parity-control');
      // Hosts whose hydration ran and holds a disposer (core sets it when it starts, removes it on failure).
      const hosts = Array.from(root.querySelectorAll('[data-forma-island]'));
      p2 = { records, events, caught, hosts: hosts.length, activated: hosts.filter(host => typeof host.__formaDispose === 'function').length };
    }
    let p3 = null;
    if (input.next !== undefined && p2) {
      step.name = 'P3';
      try {
        const entry = await import('/_parity/entry.mjs');
        if (typeof entry.__parityTransition !== 'function') throw new Error('the production entry exports no __parityTransition');
        entry.__parityTransition(reviveByType(input.next, { kind: 'object', object: 0 }, input.schema));
        await settle();
        p3 = { live: canonicalizeDom(root) };
      } catch (error) {
        p3 = { error: describeError(error) };
      }
    }
    step.name = 'P1';
    let twin = null;
    let twinError = null;
    try {
      const { Page } = await import('/_parity/twin.mjs');
      const props = reviveByType(input.state, { kind: 'object', object: 0 }, input.schema);
      const host = document.createElement('div');
      document.body.append(host);
      mount(() => (input.props === 'none' ? Page() : Page(props)), host);
      twin = canonicalizeDom(host);
    } catch (error) {
      twinError = describeError(error);
    }
    window.__parityResult = { served, twin, twinError, p2, p3, logged, violations };
  } catch (error) {
    window.__parityResult = { error: describeError(error), logged, violations };
  }
})();
`;
