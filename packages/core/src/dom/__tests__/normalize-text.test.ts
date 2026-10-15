/**
 * FORMA-182 rule 1: line endings and NUL are normalized per value before any
 * ordinary DOM text or attribute write, on every writer, to the same vectors
 * the Rust walker is tested against. The vector file is the single source of
 * truth and lives with forma-ir's packaged fixtures; a vector changed there
 * fails whichever side no longer agrees. Nothing here is generated.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createText } from '../text.js';
import { h, svg } from '../element.js';
import { childText, writeFormControlProperty } from '../form-control.js';
import { prepareAttribute } from '../adoption-attributes.js';
import { prepareAdoption } from '../adoption.js';
import { materializeAdoption } from '../adoption-materialize.js';
import { liveRanges } from '../adoption-live-ranges.js';
import { createSignal } from '../../reactive/signal.js';
import { createRoot } from '../../reactive/root.js';
import { AdoptionLifecycle } from '../../reactive/adoption-lifecycle.js';

interface ValueVector { id: string; input: string; expected: string }
interface ChildrenVector { id: string; children: string[]; expected: string }
interface TextareaVector { id: string; children: string[]; html: string; value: string }
interface UrlVector { id: string; input: string; refused: boolean; written?: string }
interface Vectors { values: ValueVector[]; children: ChildrenVector[]; textarea: TextareaVector[]; unsafeUrlNearMiss: UrlVector[] }

const VECTOR_PATH = resolve(__dirname, '../../../../../crates/forma-ir/tests/fixtures/parity/normalization.json');
const vectors = JSON.parse(readFileSync(VECTOR_PATH, 'utf8')) as Vectors;
const XLINK = 'http://www.w3.org/1999/xlink';

/** A server-rendered dynamic text range holding `text`, built with DOM calls
 * so the parser's own NUL handling never enters a test of the writers. */
function servedRange(doc: Document, text: string): HTMLElement {
  const host = doc.createElement('p');
  host.append(doc.createComment('f:t0'), doc.createTextNode(text === '' ? '​' : text), doc.createComment('/f:t0'));
  doc.body.append(host);
  return host;
}

describe('rule 1 vectors: ordinary text writers', () => {
  it.each(vectors.values)('createText writes $id normalized, static and reactive', ({ input, expected }) => {
    expect(createText(input).data).toBe(expected);
    createRoot(() => {
      const [value, setValue] = createSignal('seed');
      const node = createText(value);
      setValue(input);
      expect(node.data).toBe(expected);
    });
  });

  it.each(vectors.values)('h() children write $id normalized on the single, multiple, reactive and array paths', ({ input, expected }) => {
    expect(h('p', null, input).textContent).toBe(expected);
    expect(h('p', null, input, '|', input).textContent).toBe(`${expected}|${expected}`);
    createRoot(() => {
      const [value, setValue] = createSignal('seed');
      const scalar = h('p', null, value);
      setValue(input);
      expect(scalar.firstChild).toBeInstanceOf(Text);
      expect((scalar.firstChild as Text).data).toBe(expected);
      const [items, setItems] = createSignal<string[]>(['seed']);
      const list = h('p', null, () => items());
      setItems([input, input]);
      expect(list.childNodes.length).toBe(2);
      expect(list.textContent).toBe(expected + expected);
    });
  });

  it.each(vectors.values)('materialized later text writes $id normalized', ({ input, expected }) => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<section></section>';
    let scope!: AdoptionLifecycle;
    const plan = prepareAdoption(doc.body.firstElementChild!, () => h('section'), { scope: options => (scope = new AdoptionLifecycle(options)) });
    try {
      plan.commit();
      const ranges = liveRanges(scope, doc, () => {});
      const scalar = materializeAdoption(input, null, ranges);
      expect(scalar).toBeInstanceOf(Text);
      expect((scalar as Text).data).toBe(expected);
      const fragment = materializeAdoption([input, 7, input], null, ranges) as DocumentFragment;
      expect(fragment.textContent).toBe(`${expected}7${expected}`);
    } finally { plan.dispose(); }
  });
});

describe('rule 1 vectors: ordinary attribute writers', () => {
  it.each(vectors.values)('h() attributes write $id normalized: static, dynamic, class and xlink', ({ input, expected }) => {
    expect(h('span', { title: input, id: 'ok' }).getAttribute('title')).toBe(expected);
    expect(h('span', { class: input }).getAttribute('class')).toBe(expected);
    createRoot(() => {
      const [value, setValue] = createSignal('seed');
      const dynamic = h('span', { title: value, class: value });
      setValue(input);
      expect(dynamic.getAttribute('title')).toBe(expected);
      expect(dynamic.getAttribute('class')).toBe(expected);
    });
    const use = svg(() => h('use', { 'xlink:href': input }));
    expect(use.getAttributeNS(XLINK, 'href')).toBe(expected);
  });

  it.each(vectors.values)('adoption attribute expectations normalize $id before comparison and later writes', ({ input, expected }) => {
    const element = document.createElement('span');
    const prepared = prepareAttribute(element, 'title', input);
    expect(prepared.initial).toBe(expected);
    prepared.write(`later ${input}`);
    expect(element.getAttribute('title')).toBe(`later ${expected}`);
  });
});

describe('rule 1 vectors: form controls', () => {
  it.each(vectors.values)('live control text and value writes normalize $id', ({ input, expected }) => {
    const area = document.createElement('textarea');
    writeFormControlProperty(area, 'text', input);
    expect(area.defaultValue).toBe(expected);
    expect(area.value).toBe(expected);
    const field = document.createElement('input');
    writeFormControlProperty(field, 'value', input);
    expect(field.getAttribute('value')).toBe(expected);
    const select = h('select', { multiple: true }, h('option', { value: expected }, 'a'), h('option', { value: 'other' }, 'b')) as HTMLSelectElement;
    writeFormControlProperty(select, 'value', [input]);
    expect(Array.from(select.options, option => option.selected)).toEqual([true, false]);
    expect(childText([input, '|', () => input])).toBe(`${expected}|${expected}`);
  });

  it.each(vectors.children)('textarea children compose per value $id, static and reactive', ({ children, expected }) => {
    expect((h('textarea', null, ...children) as HTMLTextAreaElement).value).toBe(expected);
    createRoot(() => {
      const [last, setLast] = createSignal('seed');
      const area = h('textarea', null, ...children.slice(0, -1), last) as HTMLTextAreaElement;
      setLast(children[children.length - 1]!);
      expect(area.value).toBe(expected);
    });
  });
});

describe('rule 1 vectors: composition is per authored value', () => {
  it.each(vectors.children)('h() children $id normalize each value before composition', ({ children, expected }) => {
    expect(h('p', null, ...children).textContent).toBe(expected);
    expect(childText(children)).toBe(expected);
  });

  it.each(vectors.textarea)('textarea vector $id parses and renders to the same value', ({ children, value }) => {
    expect((h('textarea', null, ...children) as HTMLTextAreaElement).value).toBe(value);
  });
});

describe('rule 1 vectors: strict adoption', () => {
  it.each(vectors.values)('a served normalized range matches a client value $id without a write', async ({ input, expected }) => {
    const doc = document.implementation.createHTMLDocument();
    const host = servedRange(doc, expected);
    const text = host.childNodes[1]!;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
    const plan = prepareAdoption(host, () => h('p', null, input));
    try {
      plan.commit();
      expect(plan.phase).toBe('live');
      await new Promise(resolve => setTimeout(resolve, 0));
      records.push(...observer.takeRecords());
      expect(records).toEqual([]);
      expect(host.childNodes[1]).toBe(text);
    } finally { plan.dispose(); observer.disconnect(); }
  });

  it.each(vectors.values)('a later reactive value $id is written normalized into the retained Text node', ({ input, expected }) => {
    const doc = document.implementation.createHTMLDocument();
    const host = servedRange(doc, 'seed');
    const text = host.childNodes[1] as Text;
    const [value, setValue] = createSignal('seed');
    const plan = prepareAdoption(host, () => h('p', null, value));
    try {
      plan.commit();
      setValue(input);
      expect(host.childNodes[1]).toBe(text);
      expect(text.data).toBe(expected);
    } finally { plan.dispose(); }
  });

  it('a textarea value expectation normalizes to the served default before the control oracle compares', () => {
    const doc = document.implementation.createHTMLDocument();
    const area = doc.createElement('textarea');
    area.append(doc.createTextNode('a\nb'));
    doc.body.append(area);
    const failure = vi.fn();
    const plan = prepareAdoption(area, () => h('textarea', { value: 'a\r\nb' }), { failure });
    try {
      plan.commit();
      expect(failure).not.toHaveBeenCalled();
      expect(plan.phase).toBe('live');
      expect(area.value).toBe('a\nb');
    } finally { plan.dispose(); }
  });
});

describe('rule 1 vectors: the URL policy checks the normalized string that is written', () => {
  it.each(vectors.unsafeUrlNearMiss)('$id on the static, dynamic and adoption attribute paths', ({ input, refused, written }) => {
    const anchor = h('a', { href: input, id: 'ok' });
    expect(anchor.getAttribute('id')).toBe('ok');
    expect(anchor.getAttribute('href')).toBe(refused ? null : written!);
    createRoot(() => {
      const [value, setValue] = createSignal('/seed');
      const dynamic = h('a', { href: value, id: 'ok' });
      setValue(input);
      expect(dynamic.getAttribute('href')).toBe(refused ? null : written!);
      expect(dynamic.getAttribute('id')).toBe('ok');
    });
    expect(prepareAttribute(document.createElement('a'), 'href', input).initial).toBe(refused ? null : written!);
  });
});
