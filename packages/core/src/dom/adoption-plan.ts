/**
 * Private read-only DOM primitives for FORMA-104. These do not execute a
 * component, install a reaction, grant signal authority or commit adoption.
 * The descriptor planner will supply already-read, DOM-normalized values.
 */
const HTML_NS = 'http://www.w3.org/1999/xhtml';
type MarkerKind = 't' | 's' | 'l' | 'i';
type Marker = { kind: MarkerKind; id: number; closing: boolean };
type Code = 'FORMA_E_HYDRATE_NODE' | 'FORMA_E_HYDRATE_MARKER'
  | 'FORMA_E_HYDRATE_STRUCTURE' | 'FORMA_E_HYDRATE_VALUE';

export class AdoptionDomError extends Error {
  constructor(readonly code: Code) { super(`[forma] ${code}`); this.name = 'AdoptionDomError'; }
}
function refuse(code: Code): never { throw new AdoptionDomError(code); }

/** All four native marker operands are u16, printed without leading zeroes. */
function marker(node: Node): Marker | undefined {
  if (node.nodeType !== 8) return;
  const match = /^(\/?)f:([tsli])(\d+)$/.exec((node as Comment).data);
  // Authored comments such as "f:side note" are not framework markers.
  if (!match) return;
  const id = Number(match[3]);
  if (id > 0xffff || String(id) !== match[3]) refuse('FORMA_E_HYDRATE_MARKER');
  return { kind: match[2] as MarkerKind, id, closing: match[1] === '/' };
}

export interface AdoptionRange {
  readonly kind: MarkerKind;
  readonly id: number;
  readonly start: Comment;
  readonly end: Comment;
}
type Position = { node: Node; parent: Node | null; previous: Node | null; next: Node | null };
type Attribute = { namespace: string | null; local: string; value: string };
type ObservedNode = Position & {
  first: Node | null;
  last: Node | null;
  data: string | null;
  attributes: Attribute[] | null;
  opaque: boolean;
};
function position(node: Node): Position {
  return { node, parent: node.parentNode, previous: node.previousSibling, next: node.nextSibling };
}
function samePosition(item: Position): boolean {
  return item.node.parentNode === item.parent && item.node.previousSibling === item.previous
    && item.node.nextSibling === item.next;
}

/**
 * Snapshot before component/readers run; check again immediately before commit.
 * Nested island contents are separately owned. Their shell identity, position
 * and attributes are observed, but their descendants are deliberately opaque.
 */
export class AdoptionDom {
  private readonly document: Document;
  private readonly nodes = new Map<Node, ObservedNode>();
  private readonly ancestry: Position[] = [];
  private readonly parsed = new Set<Node>();
  private readonly ranges = new Map<Comment, AdoptionRange>();

  constructor(readonly host: Element) {
    this.document = host.ownerDocument;
    if (!this.document.contains(host)) refuse('FORMA_E_HYDRATE_STRUCTURE');
    for (let node: Node | null = host.parentNode; node && node !== this.document; node = node.parentNode) {
      this.ancestry.push(position(node));
    }
    // Explicit stack: static element depth is not the FMIR control-flow depth.
    // There is no new blanket node/depth limit on otherwise admitted output.
    const pending: Node[] = [host];
    while (pending.length) {
      const node = pending.pop()!;
      const element = node.nodeType === 1 ? node as Element : null;
      const opaque = node !== host && !!element?.hasAttribute('data-forma-island');
      this.nodes.set(node, {
        ...position(node), first: node.firstChild, last: node.lastChild,
        data: node.nodeType === 3 || node.nodeType === 8 ? (node as CharacterData).data : null,
        attributes: element ? Array.from(element.attributes, attr => ({
          namespace: attr.namespaceURI, local: attr.localName, value: attr.value,
        })) : null,
        opaque,
      });
      if (!opaque) for (let child = node.lastChild; child; child = child.previousSibling) pending.push(child);
    }
  }

  assertUnchanged(): void {
    if (this.host.ownerDocument !== this.document || !this.document.contains(this.host)
      || this.ancestry.some(item => !samePosition(item))) refuse('FORMA_E_HYDRATE_STRUCTURE');
    for (const item of this.nodes.values()) {
      const node = item.node;
      if (!samePosition(item) || (!item.opaque && (node.firstChild !== item.first || node.lastChild !== item.last))) {
        refuse('FORMA_E_HYDRATE_STRUCTURE');
      }
      if (item.data !== null && (node as CharacterData).data !== item.data) refuse('FORMA_E_HYDRATE_VALUE');
      if (item.attributes) {
        const element = node as Element;
        if (element.attributes.length !== item.attributes.length || item.attributes.some(attr =>
          element.getAttributeNS(attr.namespace, attr.local) !== attr.value)) refuse('FORMA_E_HYDRATE_VALUE');
      }
    }
  }

  expectElement(node: Node, tag: string, namespace: string | null = null): Element {
    if (!this.nodes.has(node) || node.nodeType !== 1) refuse('FORMA_E_HYDRATE_NODE');
    const element = node as Element, ns = namespace ?? HTML_NS;
    if (element.namespaceURI !== ns || element.localName !== (ns === HTML_NS ? tag.toLowerCase() : tag)) {
      refuse('FORMA_E_HYDRATE_NODE');
    }
    return element;
  }

  /** Expected attribute values are normalized by the shared prop policy first. */
  expectAttribute(element: Element, local: string, value: string | null, namespace: string | null = null): void {
    if (!this.nodes.has(element)) refuse('FORMA_E_HYDRATE_STRUCTURE');
    if (element.getAttributeNS(namespace, local) !== value) refuse('FORMA_E_HYDRATE_VALUE');
  }

  children(parent: Node = this.host): AdoptionCursor {
    this.parse(parent);
    return new AdoptionCursor(this, parent.firstChild, null);
  }

  within(range: AdoptionRange): AdoptionCursor {
    if (this.ranges.get(range.start) !== range) refuse('FORMA_E_HYDRATE_STRUCTURE');
    return new AdoptionCursor(this, range.start.nextSibling, range.end);
  }

  rangeAt(start: Node): AdoptionRange | undefined {
    return this.ranges.get(start as Comment);
  }

  /**
   * Parse only a visited parent's immediate children. A raw HTML region is
   * validated as raw markup, never interpreted as compiler marker syntax.
   * Opening-node identity matters: repeated SHOW/LIST source uses and list
   * rows legitimately repeat the same numeric operands.
   */
  private parse(parent: Node): void {
    const observed = this.nodes.get(parent);
    if (!observed || observed.opaque) refuse('FORMA_E_HYDRATE_STRUCTURE');
    if (this.parsed.has(parent)) return;
    const stack: { marker: Marker; start: Comment }[] = [];
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      const token = marker(node);
      if (!token) continue;
      if (!token.closing) stack.push({ marker: token, start: node as Comment });
      else {
        const opening = stack.pop();
        if (!opening || opening.marker.kind !== token.kind || opening.marker.id !== token.id) {
          refuse('FORMA_E_HYDRATE_MARKER');
        }
        if (token.kind === 't') {
          // Native empty text uses one U+200B Text node, never an absent node.
          const text = opening.start.nextSibling;
          if (!text || text.nodeType !== 3 || text.nextSibling !== node) refuse('FORMA_E_HYDRATE_MARKER');
        }
        this.ranges.set(opening.start, Object.freeze({
          kind: token.kind, id: token.id, start: opening.start, end: node as Comment,
        }));
      }
    }
    if (stack.length) refuse('FORMA_E_HYDRATE_MARKER');
    this.parsed.add(parent);
  }
}

/** Exact structural consumption; no placeholder, repair, whitespace skip or write. */
export class AdoptionCursor {
  private offset = 0;
  constructor(private readonly dom: AdoptionDom, private next: Node | null, private readonly end: Node | null) {}

  private current(): Node | null {
    while (this.next !== this.end && this.next?.nodeType === 8 && !marker(this.next)) this.next = this.next.nextSibling;
    return this.next === this.end ? null : this.next;
  }

  element(tag: string, namespace: string | null = null): Element {
    const node = this.current();
    if (!node || this.offset) refuse('FORMA_E_HYDRATE_NODE');
    const element = this.dom.expectElement(node, tag, namespace);
    this.next = node.nextSibling;
    return element;
  }

  /** Adjacent authored text descriptors may share one parser-coalesced Text. */
  text(value: string): void {
    if (!value) return;
    const node = this.current();
    if (!node || node.nodeType !== 3) refuse('FORMA_E_HYDRATE_NODE');
    const data = (node as Text).data;
    if (data.slice(this.offset, this.offset + value.length) !== value) refuse('FORMA_E_HYDRATE_VALUE');
    this.offset += value.length;
    if (this.offset === data.length) { this.offset = 0; this.next = node.nextSibling; }
  }

  range(kind: MarkerKind): AdoptionRange {
    const node = this.current();
    const range = node && this.dom.rangeAt(node);
    if (!range || this.offset || range.kind !== kind) refuse('FORMA_E_HYDRATE_MARKER');
    this.next = range.end.nextSibling;
    return range;
  }

  textRange(value: string): Text {
    const range = this.range('t');
    const text = range.start.nextSibling as Text;
    if (text.data !== (value === '' ? '\u200b' : value)) refuse('FORMA_E_HYDRATE_VALUE');
    return text;
  }

  finish(): void {
    this.current();
    if (this.next !== this.end || this.offset) refuse('FORMA_E_HYDRATE_STRUCTURE');
  }
}
