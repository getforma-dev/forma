/** Strict list descriptions, native marker authority and later reconciliation. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSignal, createRoot, createEffect } from 'forma/reactive';
import { createList } from '../list';
import { createShow } from '../show';
import { withAdoptionDescription, type HydrationDescriptor, type ListDescriptor } from '../adoption-description';
import { AdoptionDom } from '../adoption-plan';
import { h } from '../element';
import { connect, fixture, prepareAndCommit, expectRefusal, refusalAttempt } from './helpers/prepared-fixture';

describe('createList description contract', () => {
  it('describes the exact original readers/options without invoking a row', () => {
    const items = vi.fn(() => [{ id: 1 }]), keyFn = vi.fn((item: { id: number }) => item.id), renderFn = vi.fn((item: { id: number }) => h('li', null, String(item.id)));
    const result = withAdoptionDescription(() => createList(items, keyFn, renderFn, { updateOnItemChange: 'rerender' })) as unknown as ListDescriptor;
    expect(result).toEqual({ type: 'list', items, keyFn, renderFn, options: { updateOnItemChange: 'rerender' } });
    expect(result).not.toBeInstanceOf(DocumentFragment); expect(items).not.toHaveBeenCalled(); expect(keyFn).not.toHaveBeenCalled(); expect(renderFn).not.toHaveBeenCalled();
  });
  it('returns a DocumentFragment outside the private description scope', () => {
    createRoot(dispose => { try { expect(createList(() => [{ id: 1 }], item => item.id, item => h('li', null, String(item.id)))).toBeInstanceOf(DocumentFragment); } finally { dispose(); } });
  });
  it('keeps retired private list guards absent from the public facade', async () => {
    const facade = await import('../hydrate'); expect(facade).not.toHaveProperty('isListDescriptor'); expect(facade).not.toHaveProperty('collectMarkers'); expect(facade).not.toHaveProperty('adoptNode');
  });
  it.each([[null,'STRUCTURE'], [undefined,'STRUCTURE'], ['hello','NODE'], [{type:'element',tag:'div',props:null,children:[]},'NODE'], [{type:'show',condition:()=>true,whenTrue:()=>null},'MARKER'], [{type:'other'},'STRUCTURE']] as const)('refuses a non-list value against an owned list range: %j', (value,code) => {
    const host=fixture('<ul><!--f:l0--><li>A</li><!--/f:l0--></ul>');
    expect(refusalAttempt(host,()=>h('ul',null,value))).toThrow('FORMA_E_HYDRATE_'+code);
  });
});

describe('strict native list marker ranges', () => {
  it('collects a single f:l/closing pair by exact original comments', () => {
    const root=fixture('<ul><!--f:l0--><li data-forma-key="a">A</li><!--/f:l0--></ul>'),dom=new AdoptionDom(root);dom.children();const range=dom.rangeAt(root.firstChild!);
    expect(range?.kind).toBe('l'); expect(range?.id).toBe(0); expect(range?.start).toBe(root.firstChild);expect(range?.end).toBe(root.lastChild);dom.release();
  });
  it('collects multiple list marker pairs without mixing their identities',()=>{
    const root=fixture('<ul><!--f:l0--><li>A</li><!--/f:l0--><!--f:l1--><li>B</li><!--/f:l1--></ul>'),dom=new AdoptionDom(root);dom.children();
    expect(dom.rangeAt(root.childNodes[0]!)?.end).toBe(root.childNodes[2]);expect(dom.rangeAt(root.childNodes[3]!)?.end).toBe(root.childNodes[5]);dom.release();
  });
  it('refuses orphan list start markers without repairing the range',()=>{
    const root=fixture('<ul><!--f:l0--><li>orphan</li></ul>');expect(refusalAttempt(root,()=>h('ul',null,createList(()=>[],()=>0,()=>h('li'))))).toThrow('FORMA_E_HYDRATE_MARKER');
  });
  it('coexists with paired text and show markers',()=>{
    const root=fixture('<div><!--f:t0-->Hello<!--/f:t0--><!--f:s0--><span></span><!--/f:s0--><!--f:l0--><li></li><!--/f:l0--></div>'),dom=new AdoptionDom(root);dom.children();
    expect([0,3,6].map(index=>dom.rangeAt(root.childNodes[index]!)?.kind)).toEqual(['t','s','l']);dom.release();
  });
});

describe('strict prepared list adoption', () => {
  it('adopts SSR items by data-forma-key and attaches reconciler', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR DOM: <ul><!--f:l0--><li data-forma-key="a">A</li><li data-forma-key="b">B</li><!--/f:l0--></ul>
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const liA = document.createElement('li');
      liA.setAttribute('data-forma-key', 'a');
      liA.textContent = 'A';
      const liB = document.createElement('li');
      liB.setAttribute('data-forma-key', 'b');
      liB.textContent = 'B';
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(liA);
      ssrEl.appendChild(liB);
      ssrEl.appendChild(endComment);

      const [items, setItems] = createSignal([
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any, index: () => number) => {
          return h('li', { 'data-forma-key': item.id }, item.text);
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      connect(ssrEl);
      prepareAndCommit(ssrEl, () => desc);

      // SSR nodes should be reused (same references)
      const children = Array.from(ssrEl.children);
      expect(children).toContain(liA);
      expect(children).toContain(liB);

      // Now update items — reconciler should add new item
      setItems([
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
      ]);

      // After reconciliation, there should be 3 <li> elements
      const lis = ssrEl.querySelectorAll('li');
      expect(lis.length).toBe(3);
      expect(lis[2]!.textContent).toBe('C');
    });

    dispose?.();
  });

  it('handles empty SSR list and subsequent update populates it', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR DOM: <ul><!--f:l0--><!--/f:l0--></ul>
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(endComment);

      const [items, setItems] = createSignal<{ id: string; text: string }[]>([]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any, index: () => number) => {
          return h('li', { 'data-forma-key': item.id }, item.text);
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      connect(ssrEl);
      prepareAndCommit(ssrEl, () => desc);

      // Initially empty
      expect(ssrEl.querySelectorAll('li').length).toBe(0);

      // Add items
      setItems([
        { id: 'x', text: 'X' },
        { id: 'y', text: 'Y' },
      ]);

      const lis = ssrEl.querySelectorAll('li');
      expect(lis.length).toBe(2);
      expect(lis[0]!.textContent).toBe('X');
      expect(lis[1]!.textContent).toBe('Y');
    });

    dispose?.();
  });

  it('refuses extra/missing initial keyed rows without repairing them', () => {
    let dispose: (() => void) | undefined;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createRoot((d) => {
      dispose = d;

      // SSR DOM has items a, b, c
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const liA = document.createElement('li');
      liA.setAttribute('data-forma-key', 'a');
      liA.textContent = 'A';
      const liB = document.createElement('li');
      liB.setAttribute('data-forma-key', 'b');
      liB.textContent = 'B';
      const liC = document.createElement('li');
      liC.setAttribute('data-forma-key', 'c');
      liC.textContent = 'C';
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(liA);
      ssrEl.appendChild(liB);
      ssrEl.appendChild(liC);
      ssrEl.appendChild(endComment);

      // Client has items a, d (b and c removed, d is new)
      const [items, setItems] = createSignal([
        { id: 'a', text: 'A' },
        { id: 'd', text: 'D' },
      ]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any, index: () => number) => {
          return h('li', { 'data-forma-key': item.id }, item.text);
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      connect(ssrEl);
      // FORMA-181 checkpoint C: keys present on one side only are a key refusal, not a count.
      expectRefusal(ssrEl, () => desc, 'FORMA_E_HYDRATE_KEY');
      expect(Array.from(ssrEl.querySelectorAll('li'))).toEqual([liA, liB, liC]);
      setItems([]); expect(Array.from(ssrEl.querySelectorAll('li'))).toEqual([liA, liB, liC]);

    });

    warnSpy.mockRestore();
    dispose?.();
  });

  // FORMA-181 checkpoint C: the original refused this order (archived in
  // docs/archive/2026-10-15-pre-key-adoption/); keyed rows now bind by key without a move.
  it('adopts initial reordered keys in place and reconciles only on a real update', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR DOM has items a, b, c
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const liA = document.createElement('li');
      liA.setAttribute('data-forma-key', 'a');
      liA.textContent = 'A';
      const liB = document.createElement('li');
      liB.setAttribute('data-forma-key', 'b');
      liB.textContent = 'B';
      const liC = document.createElement('li');
      liC.setAttribute('data-forma-key', 'c');
      liC.textContent = 'C';
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(liA);
      ssrEl.appendChild(liB);
      ssrEl.appendChild(liC);
      ssrEl.appendChild(endComment);

      // Client has items in reversed order: c, b, a
      const [items, setItems] = createSignal([
        { id: 'c', text: 'C' },
        { id: 'b', text: 'B' },
        { id: 'a', text: 'A' },
      ]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any, index: () => number) => {
          return h('li', { 'data-forma-key': item.id }, item.text);
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      connect(ssrEl);
      prepareAndCommit(ssrEl, () => desc);
      // Adoption moved nothing: the served order stays until the list source changes.
      expect(Array.from(ssrEl.querySelectorAll('li'))).toEqual([liA, liB, liC]);
      setItems([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }]);
      expect(Array.from(ssrEl.querySelectorAll('li'))).toEqual([liA, liB, liC]);
      setItems([{ id: 'c', text: 'C' }, { id: 'b', text: 'B' }, { id: 'a', text: 'A' }]);
      expect(Array.from(ssrEl.querySelectorAll('li'))).toEqual([liC, liB, liA]);

    });

    dispose?.();
  });

  it('adopts SSR items with numeric keys (keyFn returns number, getAttribute returns string)', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR DOM uses string keys from data-forma-key attribute
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const li1 = document.createElement('li');
      li1.setAttribute('data-forma-key', '1');
      li1.textContent = 'One';
      const li2 = document.createElement('li');
      li2.setAttribute('data-forma-key', '2');
      li2.textContent = 'Two';
      const li3 = document.createElement('li');
      li3.setAttribute('data-forma-key', '3');
      li3.textContent = 'Three';
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(li1);
      ssrEl.appendChild(li2);
      ssrEl.appendChild(li3);
      ssrEl.appendChild(endComment);

      // Client items use numeric IDs — keyFn returns number
      const [items, setItems] = createSignal([
        { id: 1, text: 'One' },
        { id: 2, text: 'Two' },
        { id: 3, text: 'Three' },
      ]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id, // returns number, not string
        renderFn: (item: any, index: () => number) => {
          return h('li', { 'data-forma-key': String(item.id) }, item.text);
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      connect(ssrEl);
      prepareAndCommit(ssrEl, () => desc);

      // All SSR nodes should be reused despite numeric vs string key mismatch
      const lis = ssrEl.querySelectorAll('li');
      expect(lis.length).toBe(3);
      expect(lis[0]).toBe(li1); // reused, not re-rendered
      expect(lis[1]).toBe(li2);
      expect(lis[2]).toBe(li3);

      // Subsequent update with numeric keys should also work
      setItems([
        { id: 3, text: 'Three' },
        { id: 1, text: 'One' },
      ]);

      const lis2 = ssrEl.querySelectorAll('li');
      expect(lis2.length).toBe(2);
      expect(lis2[0]).toBe(li3); // reused and reordered
      expect(lis2[1]).toBe(li1); // reused and reordered
      // li2 removed
      expect(ssrEl.contains(li2)).toBe(false);
    });

    dispose?.();
  });

  it('subsequent reconciliation after adoption works correctly', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR DOM: <ul><!--f:l0--><li data-forma-key="1">One</li><!--/f:l0--></ul>
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const li1 = document.createElement('li');
      li1.setAttribute('data-forma-key', '1');
      li1.textContent = 'One';
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(li1);
      ssrEl.appendChild(endComment);

      const [items, setItems] = createSignal([{ id: '1', text: 'One' }]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any, index: () => number) => {
          return h('li', { 'data-forma-key': item.id }, item.text);
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      connect(ssrEl);
      prepareAndCommit(ssrEl, () => desc);

      // Initial state: 1 item, SSR node reused
      expect(ssrEl.querySelectorAll('li').length).toBe(1);
      expect(ssrEl.querySelector('li')).toBe(li1);

      // Update: replace item
      setItems([{ id: '2', text: 'Two' }]);

      const lis = ssrEl.querySelectorAll('li');
      expect(lis.length).toBe(1);
      expect(lis[0]!.textContent).toBe('Two');
      expect(lis[0]).not.toBe(li1); // new node, old removed

      // Update: add more items
      setItems([
        { id: '2', text: 'Two' },
        { id: '3', text: 'Three' },
      ]);

      const lis2 = ssrEl.querySelectorAll('li');
      expect(lis2.length).toBe(2);
      expect(lis2[0]!.textContent).toBe('Two');
      expect(lis2[1]!.textContent).toBe('Three');

      // Update: clear all
      setItems([]);
      expect(ssrEl.querySelectorAll('li').length).toBe(0);
    });

    dispose?.();
  });
});

// ---------------------------------------------------------------------------
// Adopted rows: bindings, disposal, duplicate keys
// ---------------------------------------------------------------------------

describe('adopted list rows', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** SSR list: <ul><!--f:l0--><li data-forma-key=…>…</li>…<!--/f:l0--></ul> */
  function ssrList(rows: [string, string][]): { ul: HTMLElement; lis: HTMLElement[] } {
    const ul = document.createElement('ul');
    ul.appendChild(document.createComment('f:l0'));
    const lis = rows.map(([key, text]) => {
      const li = document.createElement('li');
      li.setAttribute('data-forma-key', key);
      li.textContent = text;
      ul.appendChild(li);
      return li;
    });
    ul.appendChild(document.createComment('/f:l0'));
    document.body.appendChild(ul);
    return { ul, lis };
  }

  function listParent(listDesc: ListDescriptor): HydrationDescriptor {
    return { type: 'element', tag: 'ul', props: null, children: [listDesc] };
  }

  it('attaches event handlers from renderFn to adopted SSR rows', () => {
    // renderFn is re-run in hydration mode (no DOM built) and its descriptor is
    // walked against the server row, so handlers attach to rows the server sent
    // — not only to rows created later.
    let dispose: (() => void) | undefined;
    const clicked: string[] = [];

    createRoot((d) => {
      dispose = d;
      const { ul, lis } = ssrList([['a', 'A'], ['b', 'B']]);
      const [items] = createSignal([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any) =>
          h('li', { 'data-forma-key': item.id, onClick: () => clicked.push(item.id) }, item.text),
      };

      prepareAndCommit(ul, () => listParent(listDesc));

      // Same nodes, no re-render.
      expect(Array.from(ul.querySelectorAll('li'))).toEqual(lis);

      lis[0]!.dispatchEvent(new Event('click'));
      lis[1]!.dispatchEvent(new Event('click'));
      expect(clicked).toEqual(['a', 'b']);
    });

    dispose?.();
  });

  it('binds reactive text inside an adopted row', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;
      const { ul, lis } = ssrList([['a', 'A']]);
      lis[0]!.innerHTML = '<!--f:t0-->A<!--/f:t0-->';
      const [items] = createSignal([{ id: 'a' }]);
      const [label, setLabel] = createSignal('A');

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any) => h('li', { 'data-forma-key': item.id }, label),
      };

      prepareAndCommit(ul, () => listParent(listDesc));

      setLabel('A2');
      expect(lis[0]!.textContent).toBe('A2');
    });

    dispose?.();
  });

  it('disposes the effects of a row removed after adoption', () => {
    // Covers both row origins: rows adopted from SSR and rows created later by
    // the reconcile effect. Neither used to own a reactive root, so their
    // bindings stayed subscribed forever and kept writing to detached DOM.
    const spy = vi.fn();
    let dispose: (() => void) | undefined;
    const [tick, setTick] = createSignal(0);

    createRoot((d) => {
      dispose = d;
      const { ul } = ssrList([['a', 'A'], ['b', 'B']]);
      const [items, setItems] = createSignal([{ id: 'a' }, { id: 'b' }]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any) => {
          createEffect(() => { tick(); spy(item.id); });
          return h('li', { 'data-forma-key': item.id }, item.id.toUpperCase());
        },
      };

      prepareAndCommit(ul, () => listParent(listDesc));
      expect(spy).toHaveBeenCalledTimes(2);

      // Adopted row 'b' leaves.
      setItems([{ id: 'a' }]);
      spy.mockClear();
      setTick(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('a');

      // Row 'c' is created by the reconcile effect, then leaves.
      setItems([{ id: 'a' }, { id: 'c' }]);
      setItems([{ id: 'a' }]);
      spy.mockClear();
      setTick(2);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('a');
    });

    dispose?.();
  });

  it('disposes every row when the island root is disposed', () => {
    const spy = vi.fn();
    let dispose!: () => void;
    const [tick, setTick] = createSignal(0);
    const [items, setItems] = createSignal([{ id: 'a' }, { id: 'b' }]);

    createRoot((d) => {
      dispose = d;
      const { ul } = ssrList([['a', 'A'], ['b', 'B']]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any) => {
          createEffect(() => { tick(); spy(item.id); });
          return h('li', { 'data-forma-key': item.id }, item.id.toUpperCase());
        },
      };

      prepareAndCommit(ul, () => listParent(listDesc));
      expect(spy).toHaveBeenCalledTimes(2);
    });

    // Row 'c' is created by the reconcile effect AFTER the root callback has
    // returned, so it has no lexical parent root — only the list's own
    // teardown registration can reach it.
    setItems([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(spy).toHaveBeenCalledTimes(3);

    dispose();
    spy.mockClear();
    setTick(1);
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('refuses a duplicate initial data-forma-key row without dropping a ghost', () => {
    let dispose: (() => void) | undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createRoot((d) => {
      dispose = d;
      // The server emitted key "a" twice. Only one row can be matched to the
      // item with that key; the other is tracked by nothing afterwards.
      const { ul, lis } = ssrList([['a', 'A'], ['a', 'A duplicate'], ['b', 'B']]);
      const [items, setItems] = createSignal([{ id: 'a' }, { id: 'b' }]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any) => h('li', { 'data-forma-key': item.id }, item.id),
      };

      // FORMA-181 checkpoint C: a repeated served key is a key refusal before any row is walked.
      expectRefusal(ul, () => listParent(listDesc), 'FORMA_E_HYDRATE_KEY');
      expect(Array.from(ul.querySelectorAll('li'))).toEqual(lis);
      setItems([]); expect(Array.from(ul.querySelectorAll('li'))).toEqual(lis);

    });

    warn.mockRestore();
    dispose?.();
  });

  it('adopts a list that is a show branch with no wrapper element', () => {
    // createShow(cond, () => createList(...)) puts the f:lN region directly
    // between the show markers, so the strict planner must consume the nested range.
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const root = document.createElement('div');
      root.innerHTML =
        '<!--f:s0--><!--f:l0--><li data-forma-key="a">A</li><!--/f:l0--><!--/f:s0-->';
      document.body.appendChild(root);

      const [visible] = createSignal(true);
      const [items, setItems] = createSignal([{ id: 'a', text: 'A' }]);
      const renderFn = (item: any) => h('li', { 'data-forma-key': item.id }, item.text);

      const showDesc = withAdoptionDescription(() => createShow(
        visible,
        () => createList(items as () => any[], (item: any) => item.id, renderFn) as unknown as Node,
      ));

      const parentDesc = {
        type: 'element' as const,
        tag: 'div',
        props: null,
        children: [showDesc],
      } as unknown as HydrationDescriptor;
      prepareAndCommit(root, () => parentDesc);

      const original = root.querySelector('li')!;
      expect(original.textContent).toBe('A');

      // The reconcile effect must be bound to the SSR region.
      setItems([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
      const lis = root.querySelectorAll('li');
      expect(lis.length).toBe(2);
      expect(lis[0]).toBe(original);
      expect(lis[1]!.textContent).toBe('B');
    });

    dispose?.();
  });
});
