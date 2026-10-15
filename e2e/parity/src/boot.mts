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
 *    registrations), records drained through a microtask and a macrotask. Hosts whose
 *    `data-forma-hydrate` defers them are activated by driving the trigger (`interaction`: a
 *    pointerdown on the host; `visible`: the host scrolled into view and two frames; `idle`: an
 *    idle callback), never skipped, and every host must hold core's disposer afterwards (a host
 *    that never activates is named). Then the positive control, on that same observer while it is
 *    still connected: one attribute, one childList and one characterData write to the served root,
 *    each of which its own records must contain; those three records are then set aside by
 *    identity, and every other record is a write activation made.
 * 3. P1, client side: core's render of the same state (`mount(() => Page(props), host)`) in a
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

/** A node's DOM path from the served root, by child position (`root > main[node 1] > …`). Runs in the page. */
export function nodePath(target: Node, root: Node): string {
  const steps: string[] = [];
  for (let node: Node | null = target; node && node !== root; node = node.parentNode) {
    const parent: Node | null = node.parentNode;
    if (!parent) { steps.unshift('(detached)'); break; }
    const index = Array.prototype.indexOf.call(parent.childNodes, node) + 1;
    steps.unshift(node.nodeType === 1 ? `${(node as Element).localName}[node ${index}]` : node.nodeType === 3 ? `#text[node ${index}]` : `#comment[node ${index}]`);
  }
  return ['root', ...steps].join(' > ');
}

/** A mutation record as data: its type, the DOM path of its target from the served root, the values. Runs in the page. */
export function describeRecord(record: MutationRecord, root: Node): Record<string, unknown> {
  const target = record.target as Element & CharacterData;
  return {
    type: record.type,
    path: nodePath(record.target, root),
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
const nodePath = ${nodePath.toString()};
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
      // The observer the zero-write claim rests on. observeDetached is a test seam: it points the
      // observer at a detached element, which the controls below must then expose.
      const target = input.observeDetached ? document.createElement('div') : root;
      const observer = new MutationObserver(list => { for (const record of list) records.push(describeRecord(record, root)); });
      observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
      await import('/_parity/entry.mjs');
      await settle();
      // Deferred hosts are activated by driving their triggers, never skipped. A host holds core's
      // disposer once its hydration ran (core sets it when hydration starts, removes it on failure).
      const hosts = Array.from(root.querySelectorAll('[data-forma-island]'));
      const waiting = () => hosts.filter(host => typeof host.__formaDispose !== 'function');
      if (waiting().length) {
        for (const host of waiting()) {
          const trigger = host.getAttribute('data-forma-hydrate');
          if (trigger === 'interaction') host.dispatchEvent(new Event('pointerdown', { bubbles: true }));
          else if (trigger === 'visible') host.scrollIntoView();
        }
        await new Promise(resolve => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => resolve(), { timeout: 1000 }) : setTimeout(resolve, 250)));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await settle();
      }
      for (const record of observer.takeRecords()) records.push(describeRecord(record, root));
      // The positive control, on the same observer while it is connected: its own records must hold
      // each of the three writes; those three are set aside by identity, anything else is a write.
      const marker = document.createComment('parity-control');
      root.setAttribute('data-parity-control', '');
      root.appendChild(marker);
      marker.data = 'parity-control-written';
      const control = { attributes: false, childList: false, characterData: false };
      for (const record of observer.takeRecords()) {
        if (record.type === 'attributes' && record.target === root && record.attributeName === 'data-parity-control') control.attributes = true;
        else if (record.type === 'childList' && Array.prototype.includes.call(record.addedNodes, marker)) control.childList = true;
        else if (record.type === 'characterData' && record.target === marker) control.characterData = true;
        else records.push(describeRecord(record, root));
      }
      observer.disconnect();
      root.removeAttribute('data-parity-control');
      marker.remove();
      const inactive = waiting().map(host => ({ path: nodePath(host, root), trigger: host.getAttribute('data-forma-hydrate') || 'load', component: host.getAttribute('data-forma-component') }));
      p2 = { records, events, control, hosts: hosts.length, activated: hosts.length - inactive.length, inactive };
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
      twinError = String((error && error.stack) || error);
    }
    window.__parityResult = { served, twin, twinError, p2, logged, violations };
  } catch (error) {
    window.__parityResult = { error: String((error && error.stack) || error), logged, violations };
  }
})();
`;
