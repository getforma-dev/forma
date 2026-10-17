import { describe, it, expect, vi } from 'vitest';
import { prepareAdoption } from '../adoption';
import { h, cleanup } from '../element';

function target(tag = 'button'): Element {
  const doc = document.implementation.createHTMLDocument();
  const element = doc.createElement(tag);
  doc.body.appendChild(element);
  return element;
}

// The retired applyDynamicProps/element-controller implementation is archived.
// Strict listeners belong to the prepared owner; plan disposal is the boundary.
describe('prepared adoption listener cleanup', () => {
  it('hydrated event listeners fire only after commit', () => {
    const el = target(), handler = vi.fn();
    const plan = prepareAdoption(el, () => h('button', { onClick: handler }));
    try {
      el.dispatchEvent(new Event('click'));
      expect(handler).not.toHaveBeenCalled();
      plan.commit();
      el.dispatchEvent(new Event('click'));
      expect(handler).toHaveBeenCalledOnce();
    } finally { plan.dispose(); }
  });

  it('after owner disposal, event listeners no longer fire', () => {
    const el = target(), handler = vi.fn();
    const plan = prepareAdoption(el, () => h('button', { onClick: handler }));
    plan.commit();
    el.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledOnce();
    plan.dispose();
    el.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('one owner disposal revokes every adopted listener on the element', () => {
    const el = target('div'), click = vi.fn(), mouseover = vi.fn();
    const plan = prepareAdoption(el, () => h('div', { onClick: click, onMouseover: mouseover }));
    plan.commit();
    el.dispatchEvent(new Event('click'));
    el.dispatchEvent(new Event('mouseover'));
    expect(click).toHaveBeenCalledOnce();
    expect(mouseover).toHaveBeenCalledOnce();
    plan.dispose();
    el.dispatchEvent(new Event('click'));
    el.dispatchEvent(new Event('mouseover'));
    expect(click).toHaveBeenCalledOnce();
    expect(mouseover).toHaveBeenCalledOnce();
  });

  it('keeps ordinary h listener cleanup independent of an adopted owner', () => {
    const ordinaryClick = vi.fn(), adoptedClick = vi.fn();
    const ordinary = h('button', { onClick: ordinaryClick }), adopted = target();
    const plan = prepareAdoption(adopted, () => h('button', { onClick: adoptedClick }));
    try {
      plan.commit();
      ordinary.click();
      adopted.dispatchEvent(new Event('click'));
      expect(ordinaryClick).toHaveBeenCalledOnce();
      expect(adoptedClick).toHaveBeenCalledOnce();
      cleanup(ordinary);
      ordinary.click();
      adopted.dispatchEvent(new Event('click'));
      expect(ordinaryClick).toHaveBeenCalledOnce();
      expect(adoptedClick).toHaveBeenCalledTimes(2);
      plan.dispose();
      adopted.dispatchEvent(new Event('click'));
      expect(adoptedClick).toHaveBeenCalledTimes(2);
    } finally { cleanup(ordinary); plan.dispose(); }
  });

  it('owner disposal is idempotent', () => {
    const el = target(), handler = vi.fn();
    const plan = prepareAdoption(el, () => h('button', { onClick: handler }));
    plan.commit();
    plan.dispose();
    expect(() => plan.dispose()).not.toThrow();
    el.dispatchEvent(new Event('click'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('element can receive a new adopted owner after disposal', () => {
    const el = target(), first = vi.fn(), second = vi.fn();
    const one = prepareAdoption(el, () => h('button', { onClick: first }));
    one.commit();
    el.dispatchEvent(new Event('click'));
    expect(first).toHaveBeenCalledOnce();
    one.dispose();
    const two = prepareAdoption(el, () => h('button', { onClick: second }));
    try {
      two.commit();
      el.dispatchEvent(new Event('click'));
      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
    } finally { two.dispose(); }
  });
});
