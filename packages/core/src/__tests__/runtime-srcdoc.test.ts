/**
 * The zero-build runtime's own `srcdoc` writes (formajs#29's review, S3):
 * `data-bind:srcdoc` and `{item…}` in a list row's `srcdoc` write an
 * expression's value, or a row's data, as a document. No `trustedHtml()` can
 * reach them, so v3 refuses them before evaluation or a native sink and
 * identifies the binding through the ordinary diagnostic channel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, clearDiagnostics, getDiagnostics } from '../runtime';
import { RUNTIME_SRCDOC_CODE } from '../dom/trusted-html';

const REGISTRY = Symbol.for('@getforma/core#trusted-types');

let root: HTMLElement;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[REGISTRY];
  clearDiagnostics();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  unmount(root);
  root.remove();
  delete (globalThis as Record<symbol, unknown>)[REGISTRY];
  vi.restoreAllMocks();
});

/** The console.warn lines that carry `code`. */
const linesWith = (code: string): string[] =>
  (warn.mock.calls as unknown[][]).map((args) => String(args[0])).filter((line) => line.includes(code));

describe('the runtime\'s srcdoc bindings', () => {
  /** Mount `children` under a scope holding `state`, and return the root. */
  function mounted(state: Record<string, unknown>, ...children: Element[]): HTMLElement {
    root = document.createElement('div');
    root.setAttribute('data-forma-state', JSON.stringify(state));
    root.append(...children);
    document.body.append(root);
    mount(root);
    return root;
  }

  /** The one line the runtime's srcdoc bindings log, checked. */
  function expectOneRuntimeLine(): void {
    const lines = linesWith(RUNTIME_SRCDOC_CODE);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('FORMA_E_RUNTIME_SRCDOC');
    expect(getDiagnostics().some(d => d.code === RUNTIME_SRCDOC_CODE)).toBe(true);
    expect(linesWith('FORMA_W_RAW_SRCDOC')).toEqual([]);
  }

  it('data-bind:srcdoc is refused with its binding code while neighboring attributes work', () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.setAttribute('data-bind:srcdoc', '{doc}');
    frame.setAttribute('data-bind:title', '{title}');
    const button = document.createElement('button');
    button.setAttribute('data-on:click', "{doc = '<p>changed</p>'}");
    mounted({ doc: '<p>from data</p>', title: 'not a sink' }, frame, button);

    // Initial and changed values remain outside the raw sink.
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(frame.getAttribute('title')).toBe('not a sink');
    button.click();
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expectOneRuntimeLine();
  });

  it("a list row's srcdoc is refused with its binding code", () => {
    const list = document.createElement('ul');
    list.setAttribute('data-list', '{rows}');
    const row = document.createElement('li');
    const rowFrame = document.createElement('iframe');
    rowFrame.setAttribute('sandbox', '');
    rowFrame.setAttribute('srcdoc', '{item.d}');
    rowFrame.setAttribute('title', '{item.t}');
    row.append(rowFrame);
    list.append(row);
    mounted({ rows: [{ d: '<p>row one</p>', t: 'one' }, { d: '<p>row two</p>', t: 'two' }] }, list);

    expect([...list.querySelectorAll('iframe')].map((f) => [f.getAttribute('srcdoc'), f.getAttribute('title')]))
      .toEqual([[null, 'one'], [null, 'two']]);
    expectOneRuntimeLine();
  });

  it('reused rows update neighboring attributes while refused srcdoc stays absent', async () => {
    const list = document.createElement('ul');
    list.setAttribute('data-list', '{rows}');
    const row = document.createElement('li');
    row.setAttribute('title', '{item.t}');
    const frame = document.createElement('iframe');
    frame.setAttribute('srcdoc', '{item.d}');
    frame.setAttribute('title', '{item.t}');
    const link = document.createElement('a');
    link.setAttribute('href', '{item.url}');
    row.append(frame, link);
    list.append(row);
    const button = document.createElement('button');
    button.setAttribute('data-on:click', "{rows = [{d:'changed',t:'two',url:'javascript:void(0)'}]}");
    mounted({ rows: [{ d: 'first', t: 'one', url: '/safe' }] }, list, button);
    const original = list.firstElementChild!;
    expect(original.getAttribute('title')).toBe('one');
    expect(original.querySelector('a')!.getAttribute('href')).toBe('/safe');

    button.click();
    await Promise.resolve();
    expect(list.firstElementChild).toBe(original);
    expect(original.getAttribute('title')).toBe('two');
    expect(original.querySelector('iframe')!.getAttribute('title')).toBe('two');
    expect(original.querySelector('iframe')!.hasAttribute('srcdoc')).toBe(false);
    expect(original.querySelector('a')!.hasAttribute('href')).toBe(false);
    expectOneRuntimeLine();
  });

  it('a page with no srcdoc binding logs no raw-HTML line', () => {
    root = document.createElement('div');
    root.setAttribute('data-forma-state', JSON.stringify({ title: 'plain', rows: [{ t: 'a' }] }));
    const span = document.createElement('span');
    span.setAttribute('data-bind:title', '{title}');
    const list = document.createElement('ul');
    list.setAttribute('data-list', '{rows}');
    const row = document.createElement('li');
    row.setAttribute('title', '{item.t}');
    list.append(row);
    root.append(span, list);
    document.body.append(root);

    mount(root);

    expect(span.getAttribute('title')).toBe('plain');
    expect(list.querySelector('li')!.getAttribute('title')).toBe('a');
    expect(linesWith('FORMA_W_RAW_')).toEqual([]);
  });
});
