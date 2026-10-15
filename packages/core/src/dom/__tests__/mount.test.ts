import { describe, it, expect, vi, afterEach } from 'vitest';
import * as reactive from 'forma/reactive';
import { createSignal, createEffect } from 'forma/reactive';
import { mount } from '../mount';
import { h } from '../element';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('mount SSR refusal', () => {
  it.each([
    ['empty', 'element'], ['empty', 'selector'],
    ['content', 'element'], ['content', 'selector'],
  ] as const)('refuses a marked %s root by %s before component/root/effects/listeners or DOM writes', async (shape, addressing) => {
    const target = document.createElement('div');
    target.id = 'app';
    target.setAttribute('data-forma-ssr', shape === 'empty' ? '' : 'false');
    target.setAttribute('data-forma-status', 'pending');
    if (shape === 'content') {
      const input = document.createElement('input');
      input.value = 'edited';
      target.append(input, document.createComment('f:t0'), document.createTextNode('server'));
    }
    document.body.appendChild(target);
    const original = target.outerHTML;
    const nodes = [...target.childNodes];
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
    const root = vi.spyOn(reactive, 'createUnownedRoot');
    const listen = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const effect = vi.fn();
    const component = vi.fn(() => {
      createEffect(effect);
      return h('button', { onClick: effect }, 'client');
    });
    try {
      expect(() => mount(component, addressing === 'selector' ? '#app' : target))
        .toThrow('FORMA_E_MOUNT_SSR');
      await Promise.resolve();
      mutations.push(...observer.takeRecords());
      expect(component).not.toHaveBeenCalled();
      expect(root).not.toHaveBeenCalled();
      expect(effect).not.toHaveBeenCalled();
      expect(listen).not.toHaveBeenCalled();
      expect(mutations).toEqual([]);
      expect(target.outerHTML).toBe(original);
      expect([...target.childNodes]).toEqual(nodes);
      expect(document.getElementById('app')).toBe(target);
      expect(target.querySelector('input')?.value).toBe(shape === 'content' ? 'edited' : undefined);
    } finally {
      observer.disconnect();
    }
  });
});

describe('Browser mount', () => {
  it('still works normally without data-forma-ssr', () => {
    const container = document.createElement('div');
    const unmount = mount(() => h('p', { class: 'fresh' }, 'Hello'), container);
    expect(container.children.length).toBe(1);
    expect(container.children[0]!.tagName).toBe('P');
    expect(container.children[0]!.getAttribute('class')).toBe('fresh');
    expect(container.children[0]!.textContent).toBe('Hello');
    unmount();
    expect(container.innerHTML).toBe('');
  });

  it('keeps reactive updates and disposes bindings with idempotent unmount', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const [value, setValue] = createSignal('initial');
    const clicked = vi.fn();
    const unmount = mount(() => h('button', { onClick: clicked }, value), container);
    const button = container.querySelector('button')!;
    setValue('updated');
    expect(button.textContent).toBe('updated');
    button.click();
    expect(clicked).toHaveBeenCalledTimes(1);
    unmount();
    unmount();
    expect(container.childNodes.length).toBe(0);
    setValue('after disposal');
    expect(button.textContent).toBe('updated');
    expect(button.isConnected).toBe(false);
  });

  it('retains the missing-selector refusal without running the component', () => {
    const component = vi.fn(() => h('p', null, 'never'));
    expect(() => mount(component, '#missing')).toThrow('mount: container not found');
    expect(component).not.toHaveBeenCalled();
  });
});
