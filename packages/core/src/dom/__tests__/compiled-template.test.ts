import { afterEach, describe, expect, it, vi } from 'vitest';
import { __createCompiledTemplate, type CompiledBinding } from '../compiled-template.js';
import { trustedHtml, type TrustedHtml } from '../trusted-html.js';
import { cleanup, h } from '../element.js';
import { createRoot } from '../../reactive/root.js';
import { createSignal } from '../../reactive/signal.js';
import { onError } from '../../reactive/dev.js';
import { withAdoptionEvents } from '../../reactive/adoption-events.js';
import { withAdoptionDescription } from '../adoption-description.js';
import { SVG_NS, withNamespace } from '../namespace.js';

const disposers: Array<() => void> = [];

// Keep the earlier independent writer/lifetime controls on the staged ABI.
// Actual expression/effect interleaving is exercised directly below; this
// test utility deliberately supplies already-evaluated values.
function compile(html: string, bindings: readonly CompiledBinding[], fallback: (values: unknown[]) => HTMLElement, order?: readonly number[]) {
  const render = __createCompiledTemplate(() => trustedHtml(html), bindings);
  return (values: unknown[]) => render(bind => {
    if (!bind) return fallback(values);
    for (let position = 0; position < bindings.length; position++) {
      const index = order?.[position] ?? position;
      bind(index, values[index]);
    }
  });
}
function owned<T>(run: () => T): T {
  return createRoot(dispose => { disposers.push(dispose); return run(); });
}
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('compiler template construction and binding', () => {
  it('parses lazily once, clones fresh nodes, and evaluates readers once per initial binding', () => {
    const create = vi.spyOn(document, 'createElement');
    const render = compile('<div><span></span></div>', [[[0], 1]], () => h('p'));
    expect(create).not.toHaveBeenCalled();
    const reader = vi.fn(() => 'text');
    const a = owned(() => render([reader]));
    const b = owned(() => render([reader]));
    expect(a.outerHTML).toBe('<div><span>text</span></div>');
    expect(b).not.toBe(a);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.filter(([tag]) => tag === 'template')).toHaveLength(1);
  });

  it('describes adoption and non-HTML namespaces before accessing the DOM', () => {
    const fallback = vi.fn(values => h('a', { title: values[0] }));
    const render = compile('<a></a>', [[[], 0, 'title']], fallback);
    const create = vi.spyOn(document, 'createElement');
    const value = vi.fn(() => 'title');
    const description = withAdoptionDescription(() => render([value]));
    expect(description).toMatchObject({ type: 'element', tag: 'a' });
    expect(create).not.toHaveBeenCalled();
    expect(value).not.toHaveBeenCalled();
    const svg = owned(() => withNamespace(SVG_NS, () => render([value])));
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.filter(([tag]) => tag === 'template')).toHaveLength(0);
  });

  it.each(['<div></div><p></p>', '<div></div>text', 'text'])('falls back before binding invalid root shape %s', html => {
    const getter = vi.fn(() => 'bad');
    const fallback = vi.fn(() => h('i', null, 'fallback'));
    const render = compile(html, [[[], 0, 'title']], fallback);
    expect(render([getter]).tagName).toBe('I');
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(getter).not.toHaveBeenCalled();
  });

  it('resolves every path before binding and falls back on a missing or text target', () => {
    for (const path of [[8], [0]]) {
      const getter = vi.fn(() => 'bad');
      const fallback = vi.fn(() => h('i'));
      const render = compile('<div>text</div>', [[[], 0, 'title'], [path, 1]], fallback);
      expect(render([getter, 'ignored']).tagName).toBe('I');
      expect(getter).not.toHaveBeenCalled();
    }
  });

  it('preserves descendant-before-parent initialization with a compile-time order', () => {
    const calls: string[] = [];
    const render = compile('<div><span></span></div>', [[[], 0, 'title'], [[0], 1]], () => h('i'), [1, 0]);
    owned(() => render([() => { calls.push('parent'); return 'parent'; }, () => { calls.push('child'); return 'child'; }]));
    expect(calls).toEqual(['child', 'parent']);
  });

  it('preserves attribute caches across dynamic props separated by an event binding', () => {
    const [tick, setTick] = createSignal(0);
    const render = compile('<div></div>', [[[], 0, 'class'], [[], 2], [[], 0, 'title']], () => h('i'));
    const node = owned(() => render([() => { tick(); return 'same'; }, () => {}, () => `title-${tick()}`]));
    const write = vi.spyOn(node, 'className', 'set');
    setTick(1);
    expect(write).not.toHaveBeenCalled();
    expect(node.title).toBe('title-1');
  });

  it('keeps dynamic Node, array, primitive and empty transitions on the ordinary child writer', () => {
    const [read, write] = createSignal<unknown>('first');
    const reader = vi.fn(read);
    const render = compile('<div><span></span><b>end</b></div>', [[[0], 1]], () => h('i'));
    const node = owned(() => render([reader]));
    expect(reader).toHaveBeenCalledTimes(1);
    const em = h('em', null, 'node');
    write(em);
    expect(node.firstElementChild!.firstChild).toBe(em);
    write(['array', h('strong', null, 'element')]);
    expect(node.textContent).toBe('arrayelementend');
    write(null);
    expect(node.textContent).toBe('end');
    write('again');
    expect(node.textContent).toBe('againend');
    expect(reader).toHaveBeenCalledTimes(5);
  });

  it('cleans native listeners inside actual unknown Node/array children on owner disposal', () => {
    const click = vi.fn();
    const child = h('button', { onClick: click }, 'foreign');
    const render = compile('<div><section></section></div>', [[[0], 1]], () => h('i'));
    const node = owned(() => render([() => [child]]));
    document.body.append(node);
    child.click();
    expect(click).toHaveBeenCalledTimes(1);
    disposers.pop()!();
    document.body.append(node);
    child.click();
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('compiled click lifetime', () => {
  const row = () => compile('<div><button>a</button><button>b</button></div>', [[[0], 2], [[1], 2]], () => h('i'));

  it('shares one native listener and removes it only when the last live instance is disposed', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const render = row();
    owned(() => render([() => {}, () => {}]));
    owned(() => render([() => {}, () => {}]));
    expect(add.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
    disposers.pop()!();
    expect(remove.mock.calls.filter(([type]) => type === 'click')).toHaveLength(0);
    const dispose = disposers.pop()!;
    dispose(); dispose();
    expect(remove.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
  });

  it('gives functions the matched receiver/currentTarget and supports object listeners', () => {
    const seen: unknown[] = [];
    const object = { handleEvent(event: Event) { seen.push(this, event.currentTarget); } };
    const node = owned(() => row()([function(this: unknown, event: Event) { seen.push(this, event.currentTarget); }, object]));
    document.body.append(node);
    (node.children[0] as HTMLElement).click();
    (node.children[1] as HTMLElement).click();
    expect(seen).toEqual([node.children[0], node.children[0], object, node.children[1]]);
  });

  it('revokes only a manually cleaned target and the whole instance on root cleanup', () => {
    const first = vi.fn(); const second = vi.fn();
    const node = owned(() => row()([first, second]));
    document.body.append(node);
    cleanup(node.children[0]!);
    (node.children[0] as HTMLElement).click(); (node.children[1] as HTMLElement).click();
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1);
    cleanup(node);
    node.remove(); document.body.append(node);
    (node.children[1] as HTMLElement).click();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not mutate shared/frozen value vectors or revoke another instance using them', () => {
    const click = vi.fn();
    const values = Object.freeze([click, click]) as unknown as unknown[];
    const render = row();
    const a = owned(() => render(values)); const b = owned(() => render(values));
    document.body.append(a, b);
    cleanup(a);
    (b.firstChild as HTMLElement).click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(values).toEqual([click, click]);
  });

  it('walks nested compiled instances once and respects cancelBubble', () => {
    const calls: string[] = [];
    const inner = owned(() => row()([() => calls.push('inner'), (event: Event) => { calls.push('stop'); event.stopPropagation(); }]));
    const outer = owned(() => compile('<main><section></section></main>', [[[], 2], [[0], 1]], () => h('i'))([() => calls.push('outer'), inner]));
    document.body.append(outer);
    (inner.children[0] as HTMLElement).click();
    (inner.children[1] as HTMLElement).click();
    expect(calls).toEqual(['inner', 'outer', 'stop']);
  });

  it('captures adoption event wrappers once and preserves their invocation receiver', () => {
    const seen: unknown[] = [];
    const value = vi.fn(); const wrap = vi.fn(listener => function(this: unknown, event: Event) {
      seen.push(this, event.currentTarget);
      if (typeof listener === 'function') listener.call(this, event);
    });
    const node = owned(() => withAdoptionEvents(wrap, () => row()([value, value])));
    document.body.append(node);
    (node.children[0] as HTMLElement).click();
    expect(wrap).toHaveBeenCalledTimes(2); expect(value).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([node.children[0], node.children[0]]);
  });

  it('restores currentTarget and continues a live ancestor after a handler throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('handler'); const errors: unknown[] = []; const calls: string[] = [];
    disposers.push(onError(e => errors.push(e)));
    const inner = owned(() => row()([() => { throw error; }, () => {}]));
    const outer = owned(() => compile('<main><section></section></main>', [[[], 2], [[0], 1]], () => h('i'))([() => calls.push('outer'), inner]));
    document.body.append(outer);
    const event = new MouseEvent('click', { bubbles: true });
    inner.firstChild!.dispatchEvent(event);
    expect(errors).toEqual([error]); expect(calls).toEqual(['outer']);
    expect(Object.hasOwn(event, 'currentTarget')).toBe(false);
  });

  it('releases a partial instance when a later binding throws', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const error = new Error('binding');
    const render = compile('<div><button></button><span></span></div>', [[[0], 2], [[1], 1]], () => h('i'));
    expect(() => owned(() => render([() => {}, () => { throw error; }]))).toThrow(error);
    expect(add.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
    expect(remove.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
  });

  it('does not retain later delegated bindings after disposal inside the first reader', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const click = vi.fn();
    const render = compile('<div><span></span><button>b</button></div>', [[[0], 1], [[1], 2]], () => h('i'));
    const node = createRoot(stop => render([() => { stop(); return 'after disposal'; }, click]));
    document.body.append(node);
    (node.lastElementChild as HTMLElement).click();
    cleanup(node);
    expect(click).not.toHaveBeenCalled();
    expect(add.mock.calls.filter(([type]) => type === 'click')).toHaveLength(0);
    const later = owned(() => render([() => 'live', click]));
    document.body.append(later);
    (later.lastElementChild as HTMLElement).click();
    expect(click).toHaveBeenCalledTimes(1);
    disposers.pop()!();
    expect(remove.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
  });

  it('revokes an ancestor during dispatch without invoking it from the saved event path', () => {
    let dispose!: () => void;
    const outerClick = vi.fn();
    const outer = createRoot(stop => {
      dispose = stop; disposers.push(stop);
      const inner = row()([() => stop(), () => {}]);
      return compile('<main><section></section></main>', [[[], 2], [[0], 1]], () => h('i'))([outerClick, inner]);
    });
    document.body.append(outer);
    (outer.querySelector('button') as HTMLElement).click();
    expect(outerClick).not.toHaveBeenCalled();
    dispose();
    outer.remove(); document.body.append(outer);
    (outer.querySelector('button') as HTMLElement).click();
    expect(outerClick).not.toHaveBeenCalled();
  });

  it('keeps independent module copies from dispatching each other’s slots', async () => {
    const first = vi.fn(); const second = vi.fn();
    const a = owned(() => row()([first, first]));
    document.body.append(a);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
    const other = await import('../compiled-template.js');
    const b = other.__createCompiledTemplate(() => trustedHtml('<button>b</button>'), [[[], 2]])(bind => {
      if (!bind) return h('i');
      bind(0, second);
    });
    const { cleanup: otherCleanup } = await import('../element.js');
    disposers.push(() => otherCleanup(b));
    document.body.append(b);
    (a.firstChild as HTMLElement).click(); b.click();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not route detached or noncomposed shadow clicks through the document', () => {
    const click = vi.fn();
    const node = owned(() => row()([click, click]));
    (node.firstChild as HTMLElement).click();
    expect(click).not.toHaveBeenCalled();
    const host = document.createElement('div'); document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' }); shadow.append(node);
    node.firstChild!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: false }));
    expect(click).not.toHaveBeenCalled();
    node.firstChild!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('staged initialization and typed lazy markup', () => {
  it('does not mint or parse HTML during description, and accepts only the typed raw path', () => {
    const markup = vi.fn(() => trustedHtml('<div></div>'));
    const render = __createCompiledTemplate(markup, []);
    const describe = vi.fn((bind?: (i: number, v: unknown) => void) => {
      if (!bind) return h('div');
    });
    withAdoptionDescription(() => render(describe));
    expect(markup).not.toHaveBeenCalled();
    expect(describe).toHaveBeenCalledTimes(1);
    owned(() => render(describe)); owned(() => render(describe));
    expect(markup).toHaveBeenCalledTimes(1);
    expect(describe).toHaveBeenCalledTimes(3);
    for (const value of ['<p>untrusted</p>', { toString: () => '<p>forged</p>' }]) {
      const initialize = vi.fn();
      const unsafe = __createCompiledTemplate(() => value as unknown as TrustedHtml, []);
      expect(() => unsafe(initialize)).toThrow('FORMA_E_RAW_TEMPLATE');
      expect(initialize).not.toHaveBeenCalled();
    }
  });

  it('interleaves a prior child reader with the next authored expression', () => {
    const events: string[] = [];
    let value = 'before';
    const render = __createCompiledTemplate(() => trustedHtml('<div><span></span><span></span></div>'), [[[0], 1], [[1], 1]]);
    const node = owned(() => render(bind => {
      if (!bind) return h('i');
      events.push('first expression');
      const first = () => { events.push('first reader'); value = 'after'; return value; };
      bind(0, first);
      events.push('second expression');
      bind(1, value);
    }));
    expect(events).toEqual(['first expression', 'first reader', 'second expression']);
    expect(node.textContent).toBe('afterafter');
  });

  it('does not postpone an earlier reader until after a later expression throws', () => {
    const events: string[] = []; const error = new Error('later expression');
    const render = __createCompiledTemplate(() => trustedHtml('<div><span></span><span></span></div>'), [[[0], 1], [[1], 1]]);
    expect(() => owned(() => render(bind => {
      if (!bind) return h('i');
      bind(0, () => { events.push('reader'); return 'first'; });
      events.push('throw'); throw error;
    }))).toThrow(error);
    expect(events).toEqual(['reader', 'throw']);
  });

  it('drains native listeners and effects created after an in-setup disposal without skipping later expressions', () => {
    const [read, write] = createSignal(0);
    const reads = { first: 0, later: 0, title: 0 };
    const events: string[] = []; const native = vi.fn(); const delegated = vi.fn();
    const foreign: HTMLElement[] = [];
    const add = vi.spyOn(document, 'addEventListener');
    const render = __createCompiledTemplate(() => trustedHtml('<div><span></span><button>b</button><section></section></div>'),
      [[[0], 1], [[1], 2], [[2], 1], [[1], 0, 'onInput'], [[], 0, 'title']]);
    const node = createRoot(stop => render(bind => {
      if (!bind) return h('i');
      bind(0, () => {
        reads.first++; read(); stop(); events.push('disposed');
        const child = h('button', { onClick: native }, 'created inside disposing reader');
        foreign.push(child); return child;
      });
      events.push('later event expression'); bind(1, delegated);
      bind(2, () => {
        reads.later++; read(); events.push('later reader');
        const child = h('button', { onClick: native }, 'created after disposal');
        foreign.push(child); return [child];
      });
      bind(3, native);
      bind(4, () => { reads.title++; return String(read()); });
      events.push('finished initializer');
    }));
    document.body.append(node);
    expect(events).toEqual(['disposed', 'later event expression', 'later reader', 'finished initializer']);
    expect(add.mock.calls.filter(([type]) => type === 'click')).toHaveLength(0);
    for (const child of foreign) child.click();
    const button = node.children[1] as HTMLElement;
    button.click(); button.dispatchEvent(new Event('input', { bubbles: true }));
    expect(native).not.toHaveBeenCalled(); expect(delegated).not.toHaveBeenCalled();
    const before = { ...reads }; write(1);
    expect(reads).toEqual(before);
    cleanup(node); node.remove(); document.body.append(node);
    for (const child of foreign) child.click();
    expect(native).not.toHaveBeenCalled();
  });

  it('does not retain a document when capturing an adoption wrapper disposes the owner', () => {
    const add = vi.spyOn(document, 'addEventListener'); const click = vi.fn();
    const render = __createCompiledTemplate(() => trustedHtml('<button>b</button>'), [[[], 2]]);
    const node = createRoot(stop => withAdoptionEvents(listener => {
      stop(); return event => { if (typeof listener === 'function') listener(event); };
    }, () => render(bind => { if (!bind) return h('i'); bind(0, click); })));
    document.body.append(node); node.click();
    expect(click).not.toHaveBeenCalled();
    expect(add.mock.calls.filter(([type]) => type === 'click')).toHaveLength(0);
  });

  it('rejects an escaped binder after its synchronous initializer has ended', () => {
    let saved!: (index: number, value: unknown) => void;
    const render = __createCompiledTemplate(() => trustedHtml('<button>b</button>'), [[[], 2]]);
    const node = owned(() => render(bind => { if (!bind) return h('i'); saved = bind; bind(0, () => {}); }));
    expect(() => saved(0, () => {})).toThrow('FORMA_E_COMPILED_BINDING');
    cleanup(node);
    expect(() => saved(0, () => {})).toThrow('FORMA_E_COMPILED_BINDING');
  });
});
