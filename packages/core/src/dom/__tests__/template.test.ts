import { trustedHtml } from '../trusted-html';
import { describe, it, expect } from 'vitest';
import { template, templateMany } from '../template';

describe('template', () => {
  it('creates a node from HTML string', () => {
    const node = template(trustedHtml('<div>hello</div>'));
    expect(node.nodeName.toLowerCase()).toBe('div');
    expect(node.textContent).toBe('hello');
  });

  it('caches templates — same HTML returns same node', () => {
    const a = template(trustedHtml('<span>cached</span>'));
    const b = template(trustedHtml('<span>cached</span>'));
    expect(a).toBe(b);
  });

  it('different HTML returns different nodes', () => {
    const a = template(trustedHtml('<p>one</p>'));
    const b = template(trustedHtml('<p>two</p>'));
    expect(a).not.toBe(b);
  });

  it('returned node should be cloned for use', () => {
    const proto = template(trustedHtml('<div class="tmpl"></div>'));
    const clone = proto.cloneNode(true) as HTMLElement;
    expect(clone).not.toBe(proto);
    expect((clone as HTMLElement).className).toBe('tmpl');
  });
});

describe('templateMany', () => {
  it('creates DocumentFragment from multi-root HTML', () => {
    const frag = templateMany(trustedHtml('<span>A</span><span>B</span>'));
    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(frag.childNodes.length).toBe(2);
  });

  it('each call returns a fresh clone', () => {
    const a = templateMany(trustedHtml('<p>x</p>'));
    const b = templateMany(trustedHtml('<p>x</p>'));
    expect(a).not.toBe(b);
  });
});
