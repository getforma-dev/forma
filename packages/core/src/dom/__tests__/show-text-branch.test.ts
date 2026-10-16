/**
 * FORMA-016 F5: a createShow branch (and a createSwitch case, and a createList
 * row) may return a string or a number, written as a Text node as h() writes
 * the same value as a child and as the walker writes the branch's DYN_TEXT.
 * null, undefined and booleans write nothing. Strict adoption of a served text
 * branch writes nothing. The vectors are the file forma-ir's walker tests read
 * (crates/forma-ir/tests/fixtures/parity/show-text-branch.json).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createShow } from '../show.js';
import { createSwitch } from '../switch.js';
import { createList } from '../list.js';
import { h } from '../element.js';
import { prepareAdoption } from '../adoption.js';
import { __adoptionConditional } from '../adoption-description.js';
import { createSignal } from '../../reactive/signal.js';
import { createRoot } from '../../reactive/root.js';

interface Vector { id: string; value: string | number | boolean | null; text: string; nothing?: boolean; clientOnly?: boolean; html?: string }
const vectors = (JSON.parse(readFileSync(
  resolve(__dirname, '../../../../../crates/forma-ir/tests/fixtures/parity/show-text-branch.json'), 'utf8',
)) as { values: Vector[] }).values;

/** Everything between the markers of a mounted control-flow fragment. */
function between(parent: Element): Node[] {
  const kids = [...parent.childNodes];
  return kids.slice(1, -1);
}
const asBranch = (value: Vector['value']) => value as unknown as Node;

describe('createShow: a scalar branch', () => {
  it.each(vectors)('writes $id as the vector says', ({ value, text, nothing }) => {
    createRoot(() => {
      const host = document.createElement('div');
      host.appendChild(createShow(() => true, () => asBranch(value)));
      expect(host.textContent).toBe(text);
      if (nothing) expect(between(host)).toHaveLength(0);
      else {
        expect(between(host)).toHaveLength(1);
        expect(between(host)[0]!.nodeType).toBe(3);
      }
    });
  });

  it('treats undefined as nothing', () => {
    createRoot(() => {
      const host = document.createElement('div');
      host.appendChild(createShow(() => true, () => undefined as unknown as Node));
      expect(between(host)).toHaveLength(0);
    });
  });

  it('swaps text, element and nothing across toggles, in both branches', () => {
    createRoot(() => {
      const [on, setOn] = createSignal(true);
      const host = document.createElement('div');
      host.appendChild(createShow(on, () => 'title' as unknown as Node, () => h('i', null, 'else')));
      expect(host.textContent).toBe('title');
      setOn(false);
      expect(host.innerHTML).toBe('<!--forma-show--><i>else</i><!--/forma-show-->');
      setOn(true);
      expect(host.textContent).toBe('title');
      expect(between(host)).toHaveLength(1);
      const [other, setOther] = createSignal<string | number | null>(null);
      const host2 = document.createElement('div');
      host2.appendChild(createShow(() => true, () => other() as unknown as Node));
      expect(between(host2)).toHaveLength(0);
    });
  });

  it('writes the text branch as the else branch too', () => {
    createRoot(() => {
      const host = document.createElement('div');
      host.appendChild(createShow(() => false, () => h('b'), () => 7 as unknown as Node));
      expect(host.textContent).toBe('7');
    });
  });
});

describe('createSwitch: a scalar case or fallback', () => {
  it('writes a string case, a number case and a fallback as text and nothing for null', () => {
    createRoot(() => {
      const [v, setV] = createSignal<string>('a');
      const host = document.createElement('div');
      host.appendChild(createSwitch(v, [
        { match: 'a', render: () => 'A' as unknown as Node },
        { match: 'b', render: () => 2 as unknown as Node },
        { match: 'c', render: () => null as unknown as Node },
      ], () => 'fallback' as unknown as Node));
      expect(host.textContent).toBe('A');
      setV('b');
      expect(host.textContent).toBe('2');
      setV('c');
      expect(host.textContent).toBe('');
      expect(between(host)).toHaveLength(0);
      setV('z');
      expect(host.textContent).toBe('fallback');
      setV('a');
      expect(host.textContent).toBe('A');
    });
  });
});

describe('createList: a scalar row', () => {
  it('writes a string or number row as a Text node, keyed and moved', () => {
    createRoot(() => {
      const [rows, setRows] = createSignal([{ id: 1, t: 'one' }, { id: 2, t: 'two' }]);
      const host = document.createElement('div');
      host.appendChild(createList(rows, r => r.id, r => r.t));
      expect(host.textContent).toBe('onetwo');
      setRows([{ id: 2, t: 'two' }, { id: 1, t: 'one' }, { id: 3, t: 'three' }]);
      expect(host.textContent).toBe('twoonethree');
      setRows([]);
      expect(host.textContent).toBe('');
    });
  });
});

describe('strict adoption of a served text branch', () => {
  const served = (inner: string) => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = `<section><!--f:s0-->${inner}<!--/f:s0--></section>`;
    return doc.body.firstElementChild!;
  };

  it.each(vectors.filter(v => !v.clientOnly && !v.nothing && v.html))(
    'adopts $id with no mutation record and keeps the server text node', async ({ value, text, html }) => {
      const host = served(html!);
      const original = host.childNodes[1]!.nextSibling;
      const records: MutationRecord[] = [];
      const observer = new MutationObserver(batch => records.push(...batch));
      observer.observe(host, { subtree: true, attributes: true, characterData: true, childList: true });
      const plan = prepareAdoption(host, () => h('section', null, () => __adoptionConditional(() => true, () => asBranch(value), () => null)));
      plan.commit();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(records.concat(observer.takeRecords())).toEqual([]);
      expect(host.textContent!.replace(/​/g, '')).toBe(text);
      expect(host.childNodes[1]!.nextSibling).toBe(original);
      plan.dispose();
      observer.disconnect();
    },
  );

  it('adopts createShow itself, the form an author writes, with no write and then toggles', async () => {
    const host = served('<!--f:t1-->Title<!--/f:t1-->');
    const original = host.childNodes[1]!.nextSibling;
    const [on, setOn] = createSignal(true);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(host, { subtree: true, attributes: true, characterData: true, childList: true });
    const plan = prepareAdoption(host, () => h('section', null, createShow(on, () => 'Title' as unknown as Node, () => h('i', null, 'no'))));
    plan.commit();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(records.concat(observer.takeRecords())).toEqual([]);
    expect(host.childNodes[1]!.nextSibling).toBe(original);
    setOn(false);
    expect(host.querySelector('i')!.textContent).toBe('no');
    setOn(true);
    expect(host.textContent).toBe('Title');
    plan.dispose();
    observer.disconnect();
  });

  it('writes the later text branch into the live range when the condition flips', () => {
    const host = served('<!--f:t1-->Title<!--/f:t1-->');
    const [on, setOn] = createSignal(true);
    const plan = prepareAdoption(host, () => h('section', null, () => __adoptionConditional(on, () => 'Title' as unknown as Node, () => 'Other' as unknown as Node)));
    plan.commit();
    setOn(false);
    expect(host.textContent).toBe('Other');
    setOn(true);
    expect(host.textContent).toBe('Title');
    plan.dispose();
  });
});
