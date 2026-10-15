import { afterEach, describe, expect, it, vi } from 'vitest';
import { materializeAdoption, type MaterializeContext } from '../adoption-materialize.js';
import { __adoptionChild, __adoptionConditional, describingAdoption, withAdoptionDescription } from '../adoption-description.js';
import { h, Fragment } from '../element.js';
import { createShow } from '../show.js';
import { createList } from '../list.js';
import { trustedHtml } from '../trusted-html.js';
import { SVG_NS, MATHML_NS } from '../namespace.js';
import { createRoot } from '../../reactive/root.js';
import { createSignal } from '../../reactive/signal.js';
import { createEffect } from '../../reactive/effect.js';
import { prepareAdoption } from '../adoption.js';
import { AdoptionLifecycle } from '../../reactive/adoption-lifecycle.js';

const HTML = 'http://www.w3.org/1999/xhtml';
const disposers: (() => void)[] = [];
const noRanges: MaterializeContext = {
  list: () => { throw new Error('unexpected list adapter'); },
  dynamic: () => { throw new Error('unexpected dynamic adapter'); },
  show: () => { throw new Error('unexpected Show adapter'); },
};
function owned<T>(build: () => T): T { return createRoot(dispose => { disposers.push(dispose); return build(); }); }
function build(read: () => unknown, ns: string | null = null, context = noRanges): Node | null {
  return owned(() => materializeAdoption(withAdoptionDescription(read), ns, context));
}
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('private live descriptor materialization', () => {
  it('constructs nested foreignObject HTML and SVG descendants in their actual lexical contexts', () => {
    const root = build(() => h('svg', null,
      h('foreignObject', null, h('div', null, h('a', { href: '#more' }, 'more'), h('svg', null, h('title', null, 'nested')))),
    )) as Element;
    expect([root, ...root.querySelectorAll('*')].map(el => el.namespaceURI)).toEqual([SVG_NS, SVG_NS, HTML, HTML, SVG_NS, SVG_NS]);
    expect(root.querySelector('a')).toBeInstanceOf(HTMLAnchorElement);
    expect(root.querySelector('a')!.textContent).toBe('more');
    expect(root.querySelector('title')!.textContent).toBe('nested');
  });

  it('reads encoding once through its ordinary writer before resolving MathML integration children', () => {
    const encoding = vi.fn(() => 'text/html');
    const root = build(() => h('math', null, h('annotation-xml', { encoding }, h('div', null, h('a', null, 'html')), h('svg', null, h('title', null, 'svg'))), h('mtext', null, h('a', null, 'token'), h('mglyph')))) as Element;
    expect(encoding).toHaveBeenCalledOnce();
    expect([...root.querySelectorAll('a')].every(el => el instanceof HTMLAnchorElement)).toBe(true);
    expect(root.querySelector('title')!.namespaceURI).toBe(SVG_NS);
    expect(root.querySelector('mglyph')!.namespaceURI).toBe(MATHML_NS);
  });

  it('fills actual template content and completes select values before the original refs', () => {
    const seen: string[] = [];
    const root = build(() => h('div', null,
      h('template', { ref: (el: HTMLTemplateElement) => seen.push(el.content.firstElementChild!.textContent!) }, h('b', null, 'inert')),
      h('select', { value: 'b', ref: (el: HTMLSelectElement) => seen.push(el.value) }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')),
    )) as Element;
    const template = root.querySelector('template')!;
    expect(template.childNodes).toHaveLength(0);
    expect(template.content.firstElementChild!.outerHTML).toBe('<b>inert</b>');
    expect(seen).toEqual(['inert', 'b']);
    expect(root.querySelector('select')!.value).toBe('b');
  });

  it('keeps real-element scalar child Text identity and reactive namespace resolution', () => {
    const [label, setLabel] = createSignal('one');
    const root = build(() => h('div', null, h('span', null, label), h('svg', null, () => h('title', null, label())))) as Element;
    const text = root.querySelector('span')!.firstChild;
    expect(root.querySelector('title')!.namespaceURI).toBe(SVG_NS);
    setLabel('two');
    expect(root.querySelector('span')!.firstChild).toBe(text);
    expect(text!.textContent).toBe('two');
    expect(root.querySelector('title')!.namespaceURI).toBe(SVG_NS);
    expect(root.querySelector('title')!.textContent).toBe('two');
  });

  it('invokes actual components once with exact argument count and restores mode after original throws', () => {
    const calls: unknown[][] = [];
    function component(...args: unknown[]) { calls.push(args); return h('a', null, 'link'); }
    const root = build(() => h(Fragment, null, __adoptionChild(undefined, component, []), __adoptionChild(undefined, component, ['one'])), SVG_NS)!;
    expect(calls).toEqual([[], ['one']]);
    expect([...root.childNodes].every(node => (node as Element).namespaceURI === SVG_NS)).toBe(true);
    const sentinel = { original: true };
    let caught: unknown;
    try { build(() => __adoptionChild(undefined, () => { throw sentinel; }, [])); } catch (error) { caught = error; }
    expect(caught).toBe(sentinel);
    expect(describingAdoption).toBe(false);
    expect(h('a')).toBeInstanceOf(HTMLAnchorElement);
  });

  it('delegates explicit Show caching and replacement while describing only its selected factory', () => {
    const [on, setOn] = createSignal<unknown>(false), condition = vi.fn(on);
    const yes = vi.fn(() => h('foreignObject', null, h('div', null, h('a', null, 'yes'))));
    const no = vi.fn(() => h('title', null, 'no'));
    let request!: Parameters<MaterializeContext['show']>;
    const show = vi.fn<MaterializeContext['show']>((...args) => { request = args; return document.createDocumentFragment(); });
    build(() => h('svg', null, createShow(condition, yes, no)), null, { ...noRanges, show });
    expect(show).toHaveBeenCalledOnce(); expect(condition).not.toHaveBeenCalled(); expect(yes).not.toHaveBeenCalled(); expect(no).not.toHaveBeenCalled();
    expect(request[0]()).toBe(false);
    const fallback = owned(() => request[1](false)) as Element;
    expect(fallback.namespaceURI).toBe(SVG_NS); expect(fallback.textContent).toBe('no');
    expect(yes).not.toHaveBeenCalled(); expect(no).toHaveBeenCalledOnce();
    setOn(true); expect(request[0]()).toBe(true);
    const next = owned(() => request[1](true)) as Element;
    expect(next.querySelector('a')).toBeInstanceOf(HTMLAnchorElement);
    expect(yes).toHaveBeenCalledOnce(); expect(no).toHaveBeenCalledOnce(); expect(condition).toHaveBeenCalledTimes(2);
  });

  it('delegates Lists unchanged and describes multi-node and empty row callbacks once', () => {
    const rows = vi.fn((item: number, index: () => number) => item ? h(Fragment, null, h('a', null, String(index())), h('title', null, 'row')) : null);
    let supplied: Parameters<MaterializeContext['list']> | undefined;
    const list = vi.fn<MaterializeContext['list']>((...args) => { supplied = args; return document.createDocumentFragment(); });
    const items = vi.fn(() => [1, 0]), key = vi.fn((item: number) => item);
    // The native producer admits multi-node/empty rows; this tests the private
    // descriptor without changing the ordinary CSR list's HTMLElement contract.
    const descriptor = withAdoptionDescription(() => createList(items, key, rows as unknown as (item: number, index: () => number) => HTMLElement));
    owned(() => materializeAdoption(descriptor, SVG_NS, { ...noRanges, list }));
    expect(list).toHaveBeenCalledOnce(); expect(supplied![0]).toBe(descriptor); expect(supplied![1]).toBe(SVG_NS);
    expect(items).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled(); expect(rows).not.toHaveBeenCalled();
    const first = owned(() => supplied![2](1, () => 4))!;
    expect(first.childNodes).toHaveLength(2); expect(first.firstChild!.textContent).toBe('4');
    expect([...first.childNodes].every(node => (node as Element).namespaceURI === SVG_NS)).toBe(true);
    expect(owned(() => supplied![2](0, () => 5))).toBeNull(); expect(rows).toHaveBeenCalledTimes(2);
  });

  it('delegates movable readers and expression conditionals without eager or duplicated reads', () => {
    const requests: Parameters<MaterializeContext['dynamic']>[] = [];
    const dynamic: MaterializeContext['dynamic'] = (...args) => { requests.push(args); return document.createDocumentFragment(); };
    const [value, setValue] = createSignal(1), test = vi.fn(() => value() > 0), yes = vi.fn(() => h('a', null, String(value()))), no = vi.fn(() => null);
    const reader = vi.fn(() => h('title', null, 'read'));
    build(() => h(Fragment, null, reader, __adoptionConditional(test, yes, no)), SVG_NS, { ...noRanges, dynamic });
    expect(requests).toHaveLength(2); expect(reader).not.toHaveBeenCalled(); expect(test).not.toHaveBeenCalled();
    const read = requests[0]!, conditional = requests[1]!;
    expect((owned(() => read[1](read[0]())) as Element).namespaceURI).toBe(SVG_NS); expect(reader).toHaveBeenCalledOnce();
    expect((owned(() => conditional[1](conditional[0]())) as Element).textContent).toBe('1');
    setValue(2); expect((owned(() => conditional[1](conditional[0]())) as Element).textContent).toBe('2');
    expect(test).toHaveBeenCalledTimes(2); expect(yes).toHaveBeenCalledTimes(2); expect(no).not.toHaveBeenCalled();
    setValue(0); expect(owned(() => conditional[1](conditional[0]()))).toBeNull(); expect(test).toHaveBeenCalledTimes(3); expect(no).toHaveBeenCalledOnce();
  });

  it('reuses typed raw, srcdoc and guarded URL writers instead of converting their values', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = trustedHtml('<b>trusted</b>');
    const root = build(() => h('div', null, h('section', { dangerouslySetInnerHTML: { __html: html } }), h('iframe', { srcdoc: html }), h('a', { href: 'javascript:alert(1)' }, 'link'))) as Element;
    expect(root.querySelector('section')!.innerHTML).toBe('<b>trusted</b>');
    expect(root.querySelector('iframe')!.getAttribute('srcdoc')).toBe('<b>trusted</b>');
    expect(root.querySelector('a')!.getAttribute('href')).toBeNull();
    expect(() => build(() => h('iframe', { srcdoc: '<b>untrusted</b>' as never }))).toThrow();
    expect(() => build(() => h('script', null, 'bad'))).toThrow();
    expect(() => materializeAdoption({ type: 'unsupported' }, null, noRanges)).toThrow('FORMA_E_HYDRATE_STRUCTURE');
  });

  it('uses the same reactive CSS, URL and raw sinks through later values', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [style, setStyle] = createSignal('color: red'), [url, setUrl] = createSignal('/safe');
    const [markup, setMarkup] = createSignal({ __html: trustedHtml('<b>one</b>') });
    const root = build(() => h('section', { style, dangerouslySetInnerHTML: markup }), null) as HTMLElement;
    const link = build(() => h('a', { href: url }, 'link')) as HTMLAnchorElement;
    expect(root.style.color).toBe('red'); expect(root.firstElementChild!.localName).toBe('b'); expect(link.getAttribute('href')).toBe('/safe');
    setStyle('color: blue'); setMarkup({ __html: trustedHtml('<i>two</i>') }); setUrl('javascript:bad()');
    expect(root.style.color).toBe('blue'); expect(root.innerHTML).toBe('<i>two</i>'); expect(link.getAttribute('href')).toBeNull();
  });

  it.each(['root', 'element', 'fragment'] as const)('refuses a parented Node in a fresh %s before moving any original content', kind => {
    document.body.innerHTML = '<aside><b>foreign</b></aside><main>old</main>';
    const aside = document.querySelector('aside')!, foreign = aside.firstChild!, before = document.body.innerHTML;
    const observer = new MutationObserver(() => {}); observer.observe(document.body, { childList: true, subtree: true });
    const description = withAdoptionDescription(() => kind === 'root' ? foreign : kind === 'element'
      ? h('section', null, foreign) : h(Fragment, null, foreign, { type: 'unsupported' }));
    try {
      expect(() => materializeAdoption(description, null, noRanges)).toThrow('FORMA_E_HYDRATE_STRUCTURE');
      expect(foreign.parentNode).toBe(aside); expect(document.body.innerHTML).toBe(before); expect(observer.takeRecords()).toEqual([]);
    } finally { observer.disconnect(); }
  });

  it('retains detached Node identity without interpreting or recreating its subtree', () => {
    const detached = document.createElement('b'), child = document.createTextNode('owned'); detached.append(child);
    expect(materializeAdoption(detached, null, noRanges)).toBe(detached);
    const parent = build(() => h('div', null, detached)) as Element;
    expect(parent.firstChild).toBe(detached); expect(detached.firstChild).toBe(child); expect(parent.textContent).toBe('owned');
  });

  it('keeps effect and ref callbacks ordinary inside a describing live factory and disposes them', () => {
    const doc = document.implementation.createHTMLDocument(); doc.body.innerHTML = '<section>ready</section>';
    let scope!: AdoptionLifecycle;
    const plan = prepareAdoption(doc.body.firstElementChild!, () => h('section', null, 'ready'), { scope: options => (scope = new AdoptionLifecycle(options)) });
    plan.commit(); disposers.push(() => plan.dispose());
    const [tick, setTick] = createSignal(0), nodes: Node[] = [], refs: Node[] = [];
    const generation = scope.group(() => materializeAdoption(withAdoptionDescription(() => {
      createEffect(() => { tick(); nodes.push(h('b', null, 'effect')); });
      return h('div', { ref: () => refs.push(h('i', null, 'ref')) }, h('span', null, 'factory'));
    }), null, noRanges));
    expect(generation.value).toBeInstanceOf(HTMLDivElement); expect(nodes[0]).toBeInstanceOf(HTMLElement); expect(refs[0]).toBeInstanceOf(HTMLElement);
    withAdoptionDescription(() => setTick(1)); expect(nodes).toHaveLength(2); expect(nodes[1]).toBeInstanceOf(HTMLElement);
    generation.dispose(); setTick(2); expect(nodes).toHaveLength(2); expect(describingAdoption).toBe(false);
  });
});
