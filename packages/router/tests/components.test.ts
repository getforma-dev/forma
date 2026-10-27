import { afterEach, describe, expect, it, vi } from 'vitest';
import { Link } from '../src/index';

afterEach(() => vi.unstubAllGlobals());

describe('Link URL safety', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0001 javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    '/safe\0path',
    new URL('javascript:alert(1)'),
  ])('drops an unsafe href without dropping safe content: %s', href => {
    const link = Link({ href, children: 'Open', target: '_blank', class: 'navigation' });
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.textContent).toBe('Open');
    expect(link.target).toBe('_blank');
    expect(link.className).toBe('navigation');
  });

  it.each([
    '/projects?tab=active#summary', '../projects', '#summary',
    'https://example.test/projects', 'http://example.test/',
    'mailto:hello@example.test', 'tel:+15551234567',
    'data:image/png;base64,aA==', new URL('https://example.test/projects'),
  ])('preserves a legitimate native href: %s', href => {
    const link = Link({ href, children: 'Open' });
    expect(link.getAttribute('href')).toBe(String(href));
  });

  it('keeps the supplied document, children and native link attributes without an ambient document', () => {
    const target = document.implementation.createHTMLDocument('Target');
    const child = target.createElement('strong'); child.textContent = 'Download';
    vi.stubGlobal('document', undefined);
    const link = Link({ document: target, href: './file.txt', children: [child, '<safe text>'], target: '_blank', download: 'file.txt', native: true });
    expect(link.ownerDocument).toBe(target);
    expect(link.getAttribute('href')).toBe('./file.txt');
    expect(link.firstChild).toBe(child);
    expect(link.textContent).toBe('Download<safe text>');
    expect(link.children).toHaveLength(1);
    expect(link.target).toBe('_blank');
    expect(link.download).toBe('file.txt');
    expect(link.hasAttribute('data-no-router')).toBe(true);
  });
});
