import { describe, it, expect } from 'vitest';
import {
  isDangerousUrl,
  isEventHandlerAttr,
  isRawHtmlAttr,
  isSafeAttrName,
  isSafeTagName,
  isUnsafeAttrWrite,
  isUrlAttr,
} from '../url-safety.js';

const TAB = String.fromCharCode(0x09);
const LF = String.fromCharCode(0x0a);
const CR = String.fromCharCode(0x0d);
const NUL = String.fromCharCode(0x00);
const SOH = String.fromCharCode(0x01);

describe('isDangerousUrl', () => {
  it('flags plain javascript:/vbscript: and data:text/html', () => {
    expect(isDangerousUrl('javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl('vbscript:msgbox(1)')).toBe(true);
    expect(isDangerousUrl('data:text/html,<script>alert(1)</script>')).toBe(true);
    expect(isDangerousUrl('JavaScript:alert(1)')).toBe(true);
  });

  // Regression: browsers strip tabs/newlines/control chars from the scheme
  // before interpreting it, so these execute despite the naive regex.
  it('flags schemes obfuscated with embedded control characters', () => {
    expect(isDangerousUrl('java' + TAB + 'script:alert(1)')).toBe(true);
    expect(isDangerousUrl('javas' + LF + 'cript:alert(1)')).toBe(true);
    expect(isDangerousUrl('java' + CR + LF + 'script:alert(1)')).toBe(true);
    expect(isDangerousUrl(NUL + 'javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl(SOH + 'javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl('  ' + TAB + ' javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl('java script:alert(1)')).toBe(true);
  });

  // FORMA-182 review S1: after rule-1 normalization a NUL would be U+FFFD,
  // which the URL parser does not ignore, so `java\0script:` would resolve
  // as a same-origin relative reference and be fetched. Refuse the raw NUL.
  it('refuses a NUL anywhere in the value, not only in the scheme', () => {
    expect(isDangerousUrl('java' + NUL + 'script:alert(1)')).toBe(true);
    expect(isDangerousUrl('/images/a' + NUL + '.png', 'img')).toBe(true);
    expect(isDangerousUrl('https://example.com/?q=' + NUL)).toBe(true);
    expect(isDangerousUrl('/images/a�.png', 'img')).toBe(false);
    expect(isUnsafeAttrWrite('img', 'src', '/images/a' + NUL + '.png')).toBe(true);
    expect(isUnsafeAttrWrite('img', 'src', '/images/a.png')).toBe(false);
  });

  it('allows ordinary URLs', () => {
    expect(isDangerousUrl('https://example.com')).toBe(false);
    expect(isDangerousUrl('/relative/path')).toBe(false);
    expect(isDangerousUrl('mailto:a@b.com')).toBe(false);
    expect(isDangerousUrl('#anchor')).toBe(false);
    expect(isDangerousUrl('data:image/png;base64,iVBOR')).toBe(false); // safe inline image
  });
});

describe('isEventHandlerAttr', () => {
  it('matches on* names case-insensitively', () => {
    expect(isEventHandlerAttr('onclick')).toBe(true);
    expect(isEventHandlerAttr('OnClick')).toBe(true);
    expect(isEventHandlerAttr('ONMOUSEOVER')).toBe(true);
  });
  it('does not match ordinary attributes', () => {
    expect(isEventHandlerAttr('class')).toBe(false);
    expect(isEventHandlerAttr('href')).toBe(false);
    expect(isEventHandlerAttr('data-on')).toBe(false);
  });
});

describe('isSafeAttrName', () => {
  it('accepts well-formed names', () => {
    expect(isSafeAttrName('href')).toBe(true);
    expect(isSafeAttrName('data-x')).toBe(true);
    expect(isSafeAttrName('xlink:href')).toBe(true);
    expect(isSafeAttrName('aria-label')).toBe(true);
  });
  it('rejects names that would inject new attributes', () => {
    expect(isSafeAttrName('x onclick=alert(1)')).toBe(false);
    expect(isSafeAttrName('x"onload="y')).toBe(false);
    expect(isSafeAttrName('x/y')).toBe(false);
    expect(isSafeAttrName('')).toBe(false);
  });
});

describe('isUrlAttr', () => {
  it('identifies URL-bearing attributes case-insensitively', () => {
    expect(isUrlAttr('href')).toBe(true);
    expect(isUrlAttr('HREF')).toBe(true);
    expect(isUrlAttr('src')).toBe(true);
    expect(isUrlAttr('formaction')).toBe(true);
    expect(isUrlAttr('xlink:href')).toBe(true);
    expect(isUrlAttr('class')).toBe(false);
  });

  // Regression (url-attrs-missing-object-data): `data` is the URL attribute of
  // <object>, which loads its target as a document. It was missing from
  // URL_ATTRS, so `<object data="data:text/html,…">` was not scheme-checked at
  // all — not even against the schemes already in the blocklist.
  it('treats the object data attribute as URL-bearing', () => {
    expect(isUrlAttr('data')).toBe(true);
    expect(isUrlAttr('DATA')).toBe(true);
    // data-* attributes are unaffected: the match is on the whole name.
    expect(isUrlAttr('data-id')).toBe(false);
  });
});

describe('isDangerousUrl data:image/svg+xml context', () => {
  const SVG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>';

  it('blocks data:image/svg+xml when no tag is supplied', () => {
    // Fail-safe default: a call site that forgets the tag gets the strict rule.
    expect(isDangerousUrl(SVG)).toBe(true);
    expect(isDangerousUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(true);
  });

  it('blocks data:image/svg+xml for document-context sinks', () => {
    for (const tag of ['iframe', 'object', 'embed', 'a', 'form', 'use', 'link', 'script']) {
      expect(isDangerousUrl(SVG, tag)).toBe(true);
    }
  });

  it('allows data:image/svg+xml for image-context sinks', () => {
    for (const tag of ['img', 'IMG', 'image', 'video', 'audio', 'source', 'body', 'td']) {
      expect(isDangerousUrl(SVG, tag)).toBe(false);
    }
  });

  it('still blocks control-char-obfuscated svg data URLs in an image sink', () => {
    const obfuscated = 'data:image/svg' + TAB + '+xml,<svg/>';
    // The normalizer strips the tab first, so the prefix still matches and the
    // image-context relaxation applies to the real scheme, not a mutated one.
    expect(isDangerousUrl(obfuscated, 'iframe')).toBe(true);
    expect(isDangerousUrl(obfuscated, 'img')).toBe(false);
  });

  it('does not relax the always-dangerous schemes for image tags', () => {
    expect(isDangerousUrl('javascript:alert(1)', 'img')).toBe(true);
    expect(isDangerousUrl('data:text/html,<script>alert(1)</script>', 'img')).toBe(true);
  });
});

describe('isUnsafeAttrWrite', () => {
  it('rejects on* attribute names in any casing', () => {
    expect(isUnsafeAttrWrite('div', 'onclick', 'x')).toBe(true);
    expect(isUnsafeAttrWrite('div', 'ONCLICK', 'x')).toBe(true);
    expect(isUnsafeAttrWrite('div', 'Onerror', 'x')).toBe(true);
  });

  it('rejects script-scheme URLs and honours the tag context', () => {
    expect(isUnsafeAttrWrite('a', 'href', 'javascript:alert(1)')).toBe(true);
    expect(isUnsafeAttrWrite('object', 'data', 'data:text/html,<script>x</script>')).toBe(true);
    expect(isUnsafeAttrWrite('iframe', 'src', 'data:image/svg+xml,<svg/>')).toBe(true);
    expect(isUnsafeAttrWrite('img', 'src', 'data:image/svg+xml,<svg/>')).toBe(false);
  });

  it('allows ordinary attribute writes', () => {
    expect(isUnsafeAttrWrite('a', 'href', 'https://example.com')).toBe(false);
    expect(isUnsafeAttrWrite('div', 'title', 'javascript:alert(1)')).toBe(false); // not a URL attr
    expect(isUnsafeAttrWrite('div', 'data-once', '1')).toBe(false);
  });

  it('rejects a script URL in each item of an SVG animation value, whatever the case of tag and name', () => {
    // FORMA-277: <animate> and <set> write their values into the attribute
    // attributeName names, which can be href, so each value is a URL.
    for (const tag of ['animate', 'set', 'SET']) {
      for (const name of ['to', 'from', 'by', 'values', 'VALUES']) {
        expect(isUnsafeAttrWrite(tag, name, 'javascript:alert(1)'), `${tag} ${name}`).toBe(true);
        expect(isUnsafeAttrWrite(tag, name, `#a; java${TAB}script:alert(1) ;#c`), `${tag} ${name} list`).toBe(true);
        expect(isUnsafeAttrWrite(tag, name, '0;data:text/html,x'), `${tag} ${name} html`).toBe(true);
        // No image context: the target is not known.
        expect(isUnsafeAttrWrite(tag, name, 'data:image/svg+xml,<svg/>'), `${tag} ${name} svg`).toBe(true);
        expect(isUnsafeAttrWrite(tag, name, `1${NUL}2`), `${tag} ${name} NUL`).toBe(true);
        expect(isUnsafeAttrWrite(tag, name, '0;10;20'), `${tag} ${name} numbers`).toBe(false);
        expect(isUnsafeAttrWrite(tag, name, 'data:image/png;base64,aA==;#b'), `${tag} ${name} png`).toBe(false);
      }
    }
    // Other animation elements cannot target a URL attribute; other names are not values.
    expect(isUnsafeAttrWrite('animateTransform', 'to', 'javascript:alert(1)')).toBe(false);
    expect(isUnsafeAttrWrite('animateMotion', 'values', 'javascript:alert(1)')).toBe(false);
    expect(isUnsafeAttrWrite('animate', 'begin', 'javascript:alert(1)')).toBe(false);
    expect(isUnsafeAttrWrite('g', 'to', 'javascript:alert(1)')).toBe(false);
  });
});

describe('isSafeTagName', () => {
  it('accepts valid HTML, SVG and custom-element tag names', () => {
    for (const tag of ['div', 'h1', 'feGaussianBlur', 'my-widget', 'ns:tag']) {
      expect(isSafeTagName(tag)).toBe(true);
    }
  });

  it('rejects tag names that would inject attributes or close the tag', () => {
    expect(isSafeTagName('div onload=alert(1)')).toBe(false);
    expect(isSafeTagName('div><script')).toBe(false);
    expect(isSafeTagName('/div')).toBe(false);
    expect(isSafeTagName('')).toBe(false);
  });
});

describe('isRawHtmlAttr', () => {
  it('identifies srcdoc as a raw-HTML sink', () => {
    expect(isRawHtmlAttr('srcdoc')).toBe(true);
    expect(isRawHtmlAttr('SRCDOC')).toBe(true);
    expect(isRawHtmlAttr('src')).toBe(false);
  });
});
