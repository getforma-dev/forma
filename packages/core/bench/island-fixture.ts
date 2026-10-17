/** Manual fixture of the current compiler-registration/head-state protocol.
 * This does not generate native products or qualify the packed browser N3 gate.
 */
import assert from 'node:assert/strict';
import { createSignal, registerDisposer } from 'forma/reactive';
import { h, activateIslands, deactivateIsland, deactivateAllIslands } from 'forma/dom';
import { __islandRegistration, type IslandSchema } from '../src/dom/island-state';

interface CounterProps { label: string; count: number; tags: string[] }
const hash = '0123456789abcdef';
const schema: IslandSchema = [[
  { name: 'label', type: { kind: 'string' } },
  { name: 'count', type: { kind: 'number' } },
  { name: 'tags', type: { kind: 'array', element: { kind: 'string' } } },
]];
const propsFor = (id: number): CounterProps => ({ label: `Island ${id}`, count: id, tags: ['a', 'b', 'c'] });
export type Disposal = 'bulk' | 'individual';
export function islandMarkup(count: number) {
  const props = Array.from({ length: count }, (_, id) => propsFor(id));
  return { count,
    head: `<script type="application/json" data-island-state>${JSON.stringify({ v: 1, s: [], i: props.map(p => ({ h: hash, p })) })}</script>`,
    body: props.map((p, id) => `<div data-forma-island="${id}" data-forma-component="Counter" data-forma-state="${id}" data-forma-h="${hash}" data-forma-status="pending"><p class="count"><span class="label">${p.label}</span><!--f:t0-->${p.count}<!--/f:t0--></p><button class="btn" type="button">+1</button></div>`).join(''),
  };
}
export function parseIslandPage(markup: ReturnType<typeof islandMarkup>): Document {
  // State/claims are frozen per Document. Replacing the global body's contents
  // would benchmark cached authority refusing all later iterations.
  const doc = document.implementation.createHTMLDocument('island benchmark');
  doc.head.innerHTML = markup.head;
  doc.body.innerHTML = markup.body;
  return doc;
}
export function clearIslandPage(doc: Document): void {
  doc.head.textContent = ''; doc.body.textContent = '';
}
export function islandFixture(markup: ReturnType<typeof islandMarkup>, observed?: CounterProps[]) {
  const doc = parseIslandPage(markup);
  const work = { activated: 0, disposed: 0, clicks: 0 };
  const Counter = __islandRegistration((props: CounterProps) => {
    work.activated++; observed?.push(props);
    const [count, setCount] = createSignal(props.count);
    registerDisposer(() => { work.disposed++; });
    return h('div', null,
      h('p', { class: 'count' }, h('span', { class: 'label' }, props.label), () => String(count())),
      h('button', { class: 'btn', type: 'button', onClick: () => { work.clicks++; setCount(count() + 1); } }, '+1'));
  }, { h: hash, schema, mode: 0 });
  return { doc, work,
    async activate() { await activateIslands({ Counter }, doc); },
    dispose(mode: Disposal = 'bulk') {
      if (mode === 'bulk') deactivateAllIslands(doc);
      else for (const host of doc.querySelectorAll<HTMLElement>('[data-forma-island]')) deactivateIsland(host);
    },
  };
}
/** Untimed fixture proof, shared with the finite correctness suite. */
export async function proveIslandWork(count: number, mode: Disposal) {
  const observed: CounterProps[] = [];
  const fixture = islandFixture(islandMarkup(count), observed);
  const { doc, work } = fixture;
  const hosts = [...doc.querySelectorAll('[data-forma-island]')];
  const buttons = [...doc.querySelectorAll<HTMLButtonElement>('button')];
  const text = [...doc.querySelectorAll('.count')];
  try {
    await fixture.activate();
    assert.equal(work.activated, count, 'every declared island must execute');
    assert.deepEqual(observed.map(p => ({ ...p })), Array.from({ length: count }, (_, id) => propsFor(id)));
    assert.equal(work.disposed, 0, 'adoption must commit live owners');
    hosts.forEach((host, index) => assert.equal(doc.querySelectorAll('[data-forma-island]')[index], host));
    buttons.forEach((button, index) => assert.equal(doc.querySelectorAll('button')[index], button));
    assert.ok(hosts.every(host => host.getAttribute('data-forma-status') === 'pending'));
    await fixture.activate(); // Repeated activation of the same claims is a no-op.
    assert.equal(work.activated, count);
    buttons.forEach(button => button.click());
    assert.equal(work.clicks, count);
    text.forEach((node, id) => assert.equal(node.textContent, `Island ${id}${id + 1}`));
    fixture.dispose(mode);
    assert.equal(work.disposed, count, 'every activated owner must dispose');
    buttons.forEach(button => button.click());
    assert.equal(work.clicks, count, 'disposed listeners must be inert');
    text.forEach((node, id) => assert.equal(node.textContent, `Island ${id}${id + 1}`));
    fixture.dispose(mode);
    assert.equal(work.disposed, count, 'disposal must be idempotent');
    return { ...work };
  } finally { fixture.dispose(); clearIslandPage(doc); }
}
