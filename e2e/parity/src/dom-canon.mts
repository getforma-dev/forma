/**
 * The browser-side serializer: a DOM subtree to the canonical tree `compare.mts` reads.
 *
 * Evaluated inside the page (`page.evaluate(canonicalizeDom, element)`), so it is one
 * self-contained function with no imports and no outer references: Node's type stripping leaves
 * its source valid JavaScript and Playwright ships `toString()` of it. It is faithful: every
 * comment, every attribute and every text node as the browser holds them; `stripTransport`
 * removes transport afterwards, on the Node side, where it is unit-tested.
 *
 * A `<template>` parsed from HTML keeps its children in an inert `content` fragment, not in its
 * child list; they are serialized under one pseudo-element child, `#content`, so they are compared
 * and a template whose children were appended directly (live, not inert) differs from one whose
 * children were parsed (a structural difference, which is the truth).
 *
 * Attributes are a list of `{name, ns, value}` read from each `Attr` (the qualified name, the
 * namespace URI, the value), sorted by name and then namespace: no attribute name can meet an
 * object's prototype (`__proto__`), and an XLink `xlink:href` is not the same attribute as a
 * plain one spelled alike. Node types other than element, text and comment (a processing
 * instruction, CDATA) cannot come out of an HTML parse or `h()` and are dropped.
 */
import type { CanonAttr, CanonNode } from './compare.mts';

export function canonicalizeDom(root: Node): CanonNode {
  const visit = (node: Node): CanonNode | null => {
    if (node.nodeType === 3) return { kind: 'text', text: (node as Text).data };
    if (node.nodeType === 8) return { kind: 'comment', text: (node as Comment).data };
    if (node.nodeType !== 1) return null;
    const element = node as Element;
    const attrs: CanonAttr[] = Array.from(element.attributes, attribute => ({ name: attribute.name, ns: attribute.namespaceURI, value: attribute.value }));
    attrs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.ns ?? '') < (b.ns ?? '') ? -1 : (a.ns ?? '') > (b.ns ?? '') ? 1 : 0));
    const children: CanonNode[] = [];
    for (const child of Array.from(element.childNodes)) {
      const out = visit(child);
      if (out) children.push(out);
    }
    const content = (element as Partial<HTMLTemplateElement>).content;
    if (element.localName === 'template' && content && content.childNodes.length > 0) {
      const inert: CanonNode[] = [];
      for (const child of Array.from(content.childNodes)) {
        const out = visit(child);
        if (out) inert.push(out);
      }
      children.push({ kind: 'element', ns: null, tag: '#content', attrs: [], children: inert });
    }
    return { kind: 'element', ns: element.namespaceURI, tag: element.localName, attrs, children };
  };
  const out = visit(root);
  if (!out) throw new Error('canonicalizeDom: the root is not an element, text or comment');
  return out;
}
