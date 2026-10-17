import { describe, expect, it, vi } from 'vitest';
import { prepareAdoption } from '../adoption.js';
import { __adoptionConditional } from '../adoption-description.js';
import { h } from '../element.js';
import { createShow } from '../show.js';
import { createSignal } from '../../reactive/signal.js';

function fixture(content: string) {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = `<div>${content}</div><aside></aside>`;
  const host = doc.body.firstElementChild!;
  const observer = new MutationObserver(() => {});
  observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
  return { doc, host, observer };
}

describe('retained live text reads', () => {
  it('keeps the same normalized value without rewriting the owned Text', () => {
    const { host, observer } = fixture('<!--f:t0-->A\nB<!--/f:t0-->');
    const target = host.childNodes[1], [value, setValue] = createSignal('A\r\nB');
    const read = vi.fn(value), failure = vi.fn();
    const plan = prepareAdoption(host, () => h('div', null, read), { failure });
    try {
      plan.commit();
      setValue('A\nB');
      expect(read).toHaveBeenCalledTimes(2);
      expect(plan.phase).toBe('live');
      expect(failure).not.toHaveBeenCalled();
      expect(host.childNodes[1]).toBe(target);
      expect(target!.textContent).toBe('A\nB');
      expect(observer.takeRecords()).toEqual([]);
    } finally { plan.dispose(); observer.disconnect(); }
  });

  it.each(['detached text', 'foreign parent', 'rewritten marker', 'rewritten text'] as const)(
    'refuses %s even when a new read normalizes to the previous text', corruption => {
      const { doc, host, observer } = fixture('<!--f:t0-->A\nB<!--/f:t0-->');
      const target = host.childNodes[1] as Text, [value, setValue] = createSignal('A\r\nB');
      const read = vi.fn(value), failure = vi.fn();
      const plan = prepareAdoption(host, () => h('div', null, read), { failure });
      try {
        plan.commit();
        if (corruption === 'detached text') target.remove();
        if (corruption === 'foreign parent') doc.querySelector('aside')!.appendChild(target);
        if (corruption === 'rewritten marker') (host.firstChild as Comment).data = 'f:t999';
        if (corruption === 'rewritten text') target.data = 'external';
        const before = host.innerHTML, textBefore = target.data;
        observer.takeRecords();
        setValue('A\nB');
        expect(read).toHaveBeenCalledTimes(2);
        expect(plan.phase).toBe('aborted');
        expect(failure).toHaveBeenCalledOnce();
        expect(host.innerHTML).toBe(before);
        expect(target.data).toBe(textBefore);
        expect(observer.takeRecords()).toEqual([]);
        setValue('later');
        expect(read).toHaveBeenCalledTimes(2);
        expect(failure).toHaveBeenCalledOnce();
        expect(target.data).toBe(textBefore);
      } finally { plan.dispose(); observer.disconnect(); }
    },
  );

  it('keeps the native empty sentinel through equal empty reads, then keeps ordinary empty text', () => {
    const { host, observer } = fixture('<!--f:t0-->\u200b<!--/f:t0-->');
    const target = host.childNodes[1] as Text, [value, setValue] = createSignal<unknown>(null);
    const read = vi.fn(value), failure = vi.fn();
    const plan = prepareAdoption(host, () => h('div', null, read), { failure });
    try {
      plan.commit();
      for (const empty of [false, '', true, undefined]) {
        setValue(empty);
        expect(target.data).toBe('\u200b');
        expect(observer.takeRecords()).toEqual([]);
      }
      expect(read).toHaveBeenCalledTimes(5);
      setValue('next');
      expect(target.data).toBe('next');
      setValue(false);
      expect(target.data).toBe('');
      observer.takeRecords();
      setValue(null);
      expect(target.data).toBe('');
      expect(observer.takeRecords()).toEqual([]);
      expect(host.childNodes[1]).toBe(target);
      expect(plan.phase).toBe('live');
      expect(failure).not.toHaveBeenCalled();
    } finally { plan.dispose(); observer.disconnect(); }
  });

  it.each([
    ['text', 'show'], ['text', 'conditional'],
    ['show', 'text'], ['show', 'conditional'],
    ['conditional', 'text'], ['conditional', 'show'],
  ] as const)('refuses a live %s to %s shape change without replacing the owned range', (initial, next) => {
    type Kind = 'text' | 'show' | 'conditional';
    const markup = initial === 'text' ? '<!--f:t0-->before<!--/f:t0-->' : '<!--f:s0--><b>before</b><!--/f:s0-->';
    const { host, observer } = fixture(markup), nodes = [...host.childNodes];
    const [kind, setKind] = createSignal<Kind>(initial), click = vi.fn(), failure = vi.fn();
    const read = vi.fn(() => {
      switch (kind()) {
        case 'text': return 'before';
        case 'show': return createShow(() => true, () => h('b', null, 'before'));
        case 'conditional': return __adoptionConditional(() => true, () => h('b', null, 'before'), () => null);
      }
    });
    const plan = prepareAdoption(host, () => h('div', { onClick: click }, read), { failure });
    try {
      plan.commit();
      host.dispatchEvent(new Event('click'));
      expect(click).toHaveBeenCalledOnce();
      expect(observer.takeRecords()).toEqual([]);
      setKind(next);
      expect(read).toHaveBeenCalledTimes(2);
      expect(plan.phase).toBe('aborted');
      expect(failure).toHaveBeenCalledOnce();
      expect([...host.childNodes]).toEqual(nodes);
      expect(host.innerHTML).toBe(markup);
      expect(observer.takeRecords()).toEqual([]);
      host.dispatchEvent(new Event('click'));
      expect(click).toHaveBeenCalledOnce();
      setKind(initial);
      expect(read).toHaveBeenCalledTimes(2);
      expect(failure).toHaveBeenCalledOnce();
    } finally { plan.dispose(); observer.disconnect(); }
  });
});
