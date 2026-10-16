import { describe, expect, it, vi } from 'vitest';
import * as dom from '../index.js';
import { createRoot } from '../../reactive/root.js';
import { prepareAdoption } from '../adoption.js';

type Item = { id: string | number; label: string };
const make = (values: Item[], key = (item: Item) => item.id) => dom.createKeyedRows(values, key);
const values = (): Item[] => [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];

describe('indexed whole-item replacement', () => {
  it('updates only the selected row holes without factories, indexes or unrelated effects', () => {
    const key = vi.fn((item: Item) => item.id), rows = make(values(), key);
    const rendered = vi.fn(), read = vi.fn(), indexes = vi.fn(), clicked: string[] = [];
    let dispose!: () => void;
    const host = createRoot(stop => { dispose = stop; return dom.h('ul', null, dom.createList(rows, (item, index) => {
      rendered();
      return dom.h('li', { title: () => item().label, onClick: () => clicked.push(item().label) },
        dom.h('span', null, () => { read(item().id); return item().label; }),
        dom.h('b', null, () => { indexes(); return String(index()); }));
    })); });
    const before = [...host.children], counts = [rendered.mock.calls.length, indexes.mock.calls.length];
    key.mockClear(); read.mockClear();
    rows.set('a', { id: 'a', label: 'next' });
    expect([...host.children]).toEqual(before);
    expect(host.textContent).toBe('next0B1');
    expect(before[0]!.getAttribute('title')).toBe('next');
    expect([rendered.mock.calls.length, indexes.mock.calls.length]).toEqual(counts);
    expect(key).toHaveBeenCalledTimes(1);
    expect(read.mock.calls).toEqual([['a']]);
    (before[0] as HTMLElement).click(); expect(clicked).toEqual(['next']);
    dispose(); read.mockClear();
    rows.set('a', { id: 'a', label: 'disposed' });
    expect(read).not.toHaveBeenCalled();
    (before[0] as HTMLElement).click(); expect(clicked).toEqual(['next']);
  });

  it('exposes only a read accessor to row callbacks, including untyped calls with arguments', () => {
    const rows = make(values()); let read!: () => Item, dispose!: () => void;
    const host = createRoot(stop => { dispose = stop; return dom.h('ul', null, dom.createList(rows, item => {
      if (item().id === 'a') read = item;
      return dom.h('li', null, () => item().label);
    })); });
    expect((read as any)({ id: 'changed', label: 'bypass' })).toEqual({ id: 'a', label: 'A' });
    expect(host.textContent).toBe('AB');
    rows.set('a', { id: 'a', label: 'allowed' }); expect(host.textContent).toBe('allowedB');
    dispose();
  });

  it('shares values between independently owned views and disposes only the removed view', () => {
    const rows = make(values());
    const mount = () => { let dispose!: () => void; const host = createRoot(stop => { dispose = stop; return dom.h('ul', null, dom.createList(rows, item => dom.h('li', null, () => item().label))); }); return { host, dispose }; };
    const first = mount(), second = mount();
    rows.set('a', { id: 'a', label: 'C' });
    expect([first.host.textContent, second.host.textContent]).toEqual(['CB', 'CB']);
    first.dispose(); rows.set('a', { id: 'a', label: 'D' });
    expect([first.host.textContent, second.host.textContent]).toEqual(['CB', 'DB']);
    second.dispose();
  });

  it('canonicalizes lookup keys and refuses missing, changing, duplicate and sparse keys before publication', () => {
    const rows = make([{ id: 1, label: 'A' }, { id: 'x\r\ny', label: 'B' }]);
    let dispose!: () => void;
    const host = createRoot(stop => { dispose = stop; return dom.h('ul', null, dom.createList(rows, item => dom.h('li', null, () => item().label))); });
    rows.set('1', { id: 1, label: 'C' }); rows.set('x\ny', { id: 'x\r\ny', label: 'D' });
    expect(host.textContent).toBe('CD');
    for (const act of [
      () => rows.set('missing', { id: 'missing', label: 'bad' }),
      () => rows.set(1, { id: 2, label: 'bad' }),
      () => rows.replace([{ id: 1, label: 'bad' }, { id: '1', label: 'collision' }]),
      () => rows.replace([, { id: 1, label: 'bad' }] as Item[]),
      () => rows.replace([{ id: 'ok', label: 'bad' }, { id: '\ud800', label: 'bad' }]),
    ]) { expect(act).toThrow(); expect(host.textContent).toBe('CD'); }
    dispose();
  });

  it('validates the complete structural replacement before publishing retained values, and retains getters on reorder', () => {
    const key = (item: Item) => { if (item.label === 'throw') throw Error('key failed'); return item.id; };
    const rows = make(values(), key), getters = new Map<string | number, () => Item>();
    let dispose!: () => void;
    const host = createRoot(stop => { dispose = stop; return dom.h('ul', null, dom.createList(rows, (item, index) => {
      getters.set(item().id, item);
      return dom.h('li', null, () => item().label, ':', () => String(index()));
    })); });
    const before = [...host.children], a = getters.get('a');
    expect(() => rows.replace([{ id: 'a', label: 'not published' }, { id: 'b', label: 'throw' }])).toThrow('key failed');
    expect(host.textContent).toBe('A:0B:1');
    rows.replace([{ id: 'b', label: 'Bee' }, { id: 'a', label: 'Ay' }]);
    expect([...host.children]).toEqual([before[1], before[0]]);
    expect(host.textContent).toBe('Bee:0Ay:1'); expect(getters.get('a')).toBe(a);
    rows.replace([{ id: 'a', label: 'only' }]);
    expect(() => rows.set('b', { id: 'b', label: 'gone' })).toThrow();
    expect(host.textContent).toBe('only:0'); dispose();
  });

  it('makes reference-equal set inert and rejects a nominal impostor or indexed options', () => {
    const initial = values(), rows = make(initial), read = vi.fn();
    let dispose!: () => void;
    const host = createRoot(stop => { dispose = stop; return dom.h('ul', null, dom.createList(rows, item => dom.h('li', null, () => { read(); return item().label; }))); });
    read.mockClear(); rows.set('a', initial[0]!);
    expect(read).not.toHaveBeenCalled(); expect(host.textContent).toBe('AB');
    expect(() => dom.createList({ set() {}, replace() {} } as any, () => dom.h('li'))).toThrow();
    expect(() => (dom.createList as any)(rows, () => dom.h('li'), { updateOnItemChange: 'rerender' })).toThrow();
    dispose();
  });

  it('refuses reentrant key validation without publishing either mutation', () => {
    let rows!: ReturnType<typeof make>;
    rows = make(values(), item => {
      if (item.label === 'reenter') rows.set('b', { id: 'b', label: 'nested' });
      return item.id;
    });
    let dispose!: () => void;
    const host = createRoot(stop => { dispose = stop; return dom.h('ul', null, dom.createList(rows, item => dom.h('li', null, () => item().label))); });
    expect(() => rows.set('a', { id: 'a', label: 'reenter' })).toThrow('reenter');
    expect(host.textContent).toBe('AB');
    expect(() => rows.replace([{ id: 'a', label: 'candidate' }, { id: 'b', label: 'reenter' }])).toThrow('reenter');
    expect(host.textContent).toBe('AB'); dispose();
  });

  it('does not let an inherited array index conceal a sparse candidate', () => {
    const sparse = [, { id: 'b', label: 'B' }] as Item[];
    const prototype = Object.create(Array.prototype); prototype[0] = { id: 'a', label: 'A' };
    Object.setPrototypeOf(sparse, prototype);
    expect(() => make(sparse)).toThrow('dense array');
    const rows = make(values());
    expect(() => rows.replace(sparse)).toThrow('dense array');
  });

  it('invalidates preparation if a later row changes an already observed item', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<ul><!--f:l0--><li data-forma-key="a"><!--f:t1-->A<!--/f:t1--></li><li data-forma-key="b"><!--f:t1-->B<!--/f:t1--></li><!--/f:l0--></ul>';
    const host = doc.body.firstElementChild!, rows = make(values()), before = host.innerHTML;
    expect(() => prepareAdoption(host, () => dom.h('ul', null, dom.createList(rows, item => {
      if (item().id === 'b') rows.set('a', { id: 'a', label: 'during preparation' });
      return dom.h('li', null, () => item().label);
    })))).toThrow();
    expect(host.innerHTML).toBe(before);
  });

  it('isolates a failed adopted view and keeps its neighbor live', () => {
    const doc = document.implementation.createHTMLDocument();
    const markup = '<ul><!--f:l0--><li data-forma-key="a"><!--f:t1-->A<!--/f:t1--></li><li data-forma-key="b"><!--f:t1-->B<!--/f:t1--></li><!--/f:l0--></ul>';
    doc.body.innerHTML = markup + markup;
    const [first, second] = [...doc.body.children], rows = make(values()), failure = vi.fn();
    const firstPlan = prepareAdoption(first!, () => dom.h('ul', null, dom.createList(rows, item => dom.h('li', null, () => {
      const next = item().label; if (next === 'bad') throw Error('one view failed'); return next;
    }))), { failure });
    const secondPlan = prepareAdoption(second!, () => dom.h('ul', null, dom.createList(rows, item => dom.h('li', null, () => item().label))));
    firstPlan.commit(); secondPlan.commit();
    rows.set('a', { id: 'a', label: 'bad' });
    expect(firstPlan.phase).toBe('aborted'); expect(failure).toHaveBeenCalledOnce();
    expect(secondPlan.phase).toBe('live'); expect(second!.textContent).toBe('badB');
    rows.set('a', { id: 'a', label: 'after' });
    expect(first!.textContent).toBe('AB'); expect(second!.textContent).toBe('afterB');
    firstPlan.dispose(); secondPlan.dispose();
  });

  it('does not turn an item signal into early-edit writeback authority', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<ul><!--f:l0--><li data-forma-key="a"><input value="A"></li><!--/f:l0--></ul>';
    const host = doc.body.firstElementChild!, input = host.querySelector('input')!;
    const rows = make([{ id: 'a', label: 'A' }]); input.value = 'user edit';
    const before = host.innerHTML;
    expect(() => prepareAdoption(host, () => dom.h('ul', null, dom.createList(rows, item => dom.h('li', null, dom.h('input', { value: () => item().label })))))).toThrow('FORMA_E_HYDRATE_INPUT_TARGET');
    expect(input.value).toBe('user edit'); expect(host.innerHTML).toBe(before);
  });

  it('keeps focused input, selection and listener identity when an adopted row item changes', () => {
    const host = document.createElement('ul'); document.body.appendChild(host);
    host.innerHTML = '<!--f:l0--><li data-forma-key="a"><input value="draft"><span><!--f:t1-->A<!--/f:t1--></span><button>Inspect</button></li><!--/f:l0-->';
    const rows = make([{ id: 'a', label: 'A' }]), clicked: string[] = [];
    const factory = vi.fn((item: () => Item) => dom.h('li', null,
      dom.h('input', { value: 'draft' }), dom.h('span', null, () => item().label),
      dom.h('button', { onClick: () => clicked.push(item().label) }, 'Inspect')));
    const input = host.querySelector('input')!, button = host.querySelector('button')!, before = [...host.childNodes];
    input.focus(); input.setSelectionRange(1, 4, 'backward');
    const plan = prepareAdoption(host, () => dom.h('ul', null, dom.createList(rows, factory)));
    plan.commit();
    rows.set('a', { id: 'a', label: 'changed' });
    expect([...host.childNodes]).toEqual(before); expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([1, 4, 'backward']);
    expect(factory).toHaveBeenCalledOnce(); button.click(); expect(clicked).toEqual(['changed']);
    plan.dispose(); button.click(); expect(clicked).toEqual(['changed']); host.remove();
  });

  it.each(['detached row', 'foreign owner', 'rewritten marker', 'rewritten text'] as const)('refuses a %s without touching that hole', corruption => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<ul><!--f:l0--><li data-forma-key="a"><!--f:t1-->A<!--/f:t1--></li><!--/f:l0--></ul><aside></aside>';
    const host = doc.body.firstElementChild!, row = host.querySelector('li')!, target = row.childNodes[1] as Text;
    const rows = make([{ id: 'a', label: 'A' }]), failure = vi.fn();
    const plan = prepareAdoption(host, () => dom.h('ul', null, dom.createList(rows, item => dom.h('li', null, () => item().label))), { failure });
    plan.commit();
    if (corruption === 'detached row') row.remove();
    if (corruption === 'foreign owner') doc.querySelector('aside')!.appendChild(row);
    if (corruption === 'rewritten marker') (row.firstChild as Comment).data = 'f:t999';
    if (corruption === 'rewritten text') target.data = 'external';
    const before = target.data;
    rows.set('a', { id: 'a', label: 'new' });
    expect(plan.phase).toBe('aborted'); expect(failure).toHaveBeenCalledOnce();
    expect(target.data).toBe(before); plan.dispose();
  });

  it('adopts existing keyed rows with zero writes, updates holes and keeps the existing corruption refusal', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<ul><!--f:l0--><li data-forma-key="a"><!--f:t1-->A<!--/f:t1--></li><li data-forma-key="b"><!--f:t1-->B<!--/f:t1--></li><!--/f:l0--></ul>';
    const host = doc.body.firstElementChild!;
    const rows = make(values()), before = [...host.childNodes];
    const observer = new MutationObserver(() => {}); observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
    const failure = vi.fn();
    const plan = prepareAdoption(host, () => dom.h('ul', null, dom.createList(rows, item => dom.h('li', null, () => item().label))), { failure });
    plan.commit(); expect([...host.childNodes]).toEqual(before); expect(observer.takeRecords()).toEqual([]);
    rows.set('a', { id: 'a', label: 'next' });
    expect(host.textContent).toBe('nextB'); expect(observer.takeRecords().length).toBeGreaterThan(0);
    host.querySelector('li')!.firstChild!.remove();
    observer.takeRecords(); const corrupted = host.innerHTML;
    rows.set('a', { id: 'a', label: 'refused' });
    expect(plan.phase).toBe('aborted'); expect(failure).toHaveBeenCalledOnce();
    expect(host.innerHTML).toBe(corrupted); expect(observer.takeRecords()).toEqual([]);
    plan.dispose(); observer.disconnect();
  });
});
