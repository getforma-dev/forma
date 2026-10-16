/**
 * What "parity" compares (FORMA-183, DR-9; e2e/parity/README.md, 'What parity compares').
 *
 * Both sides are canonical trees of the browser's own parse (`dom-canon.mts`). Transport is removed
 * and nothing else, and only where it is transport:
 * - on both sides, the walker's marker comments (`f:tN`, `f:sN`, `f:lN`, `f:iN` pairs) and core's
 *   own show and list anchors;
 * - on the server side only, the six `data-forma-*` activation attributes, and `data-forma-key`,
 *   lifted into a side table that is checked against the expected key text. The client twin never
 *   writes any of them, so on the client side they are ordinary attributes and a difference;
 * - on the server side only, the U+200B that holds an empty dynamic text open. The wire cannot tell
 *   it from a dynamic text whose value is U+200B (the walker writes the same bytes for both), so a
 *   server holder matches client text "" or "​" and every holder compared is counted in the
 *   report as `holderAmbiguous`, never silently.
 * After removal, adjacent text nodes are joined and empty ones dropped: where a text node ends is
 * neither a value nor structure (adoption's cursor handles that split and P2 proves it).
 *
 * The harness applies no normalization of its own: no trimming, no line-ending or NUL rewriting,
 * no case folding. Rule 1 and the other value rules are the writers' business on both sides and
 * the parse is the browser's; that is P1's claim.
 */

/** One attribute: its qualified name, its namespace (`null` for an ordinary attribute) and its value. */
export interface CanonAttr { readonly name: string; readonly ns: string | null; readonly value: string }
export interface ElementNode {
  readonly kind: 'element';
  readonly ns: string | null;
  readonly tag: string;
  /** Sorted by name, then namespace: a list, so no attribute name can collide with an object's prototype. */
  readonly attrs: readonly CanonAttr[];
  readonly children: readonly CanonNode[];
}
export interface TextNode {
  readonly kind: 'text';
  readonly text: string;
  /** Server side only: the UTF-16 offsets in `text` of U+200B characters that were empty-text holders. */
  readonly holders?: readonly number[];
}
export interface CommentNode { readonly kind: 'comment'; readonly text: string }
export type CanonNode = ElementNode | TextNode | CommentNode;

export type Side = 'server' | 'client';

/** The walker's marker grammar: `f:` + kind + decimal digits, with `/` for the closing one. */
export const SERVER_MARKER = /^\/?f:[tsli][0-9]+$/;
/** Core's own anchors on the browser-only build path (createShow, createList). */
export const CLIENT_ANCHORS: ReadonlySet<string> = new Set(['forma-show', '/forma-show', 'forma-list-start', 'forma-list-end']);
/** The activation set the walker writes on an island root (docs/ARCHITECTURE.md 3.4, set A). */
export const TRANSPORT_ATTRIBUTES: ReadonlySet<string> = new Set([
  'data-forma-island', 'data-forma-component', 'data-forma-status', 'data-forma-hydrate', 'data-forma-state', 'data-forma-h',
]);
export const KEY_ATTRIBUTE = 'data-forma-key';
const HOLDER = '​';

export function isTransportComment(text: string): boolean {
  return SERVER_MARKER.test(text) || CLIENT_ANCHORS.has(text);
}

export interface Stripped {
  readonly tree: CanonNode;
  /** Server side: `data-forma-key` values by element path, lifted out of the attributes. Client side: empty. */
  readonly keys: ReadonlyMap<string, string>;
}

/**
 * A CSS path from the compared root: `tag:nth-child(n)` per level, where `n` counts element
 * siblings only, as CSS does (so the path selects the node in DevTools whatever text or comments
 * precede it, and removing transport comments never changes it); `#text` / `#comment` leaves.
 */
function childPath(parent: string, node: CanonNode, position: number): string {
  const step = node.kind === 'element' ? `${node.tag}:nth-child(${position})` : node.kind === 'text' ? '#text' : '#comment';
  return parent ? `${parent} > ${step}` : step;
}

/** Each child's position among its element siblings (1-based); 0 for a text or comment. */
function positions(children: readonly CanonNode[]): number[] {
  let elements = 0;
  return children.map(child => (child.kind === 'element' ? ++elements : 0));
}

/** Remove transport from one side's tree. The side decides what is transport (see the file header). */
export function stripTransport(root: CanonNode, side: Side, rootPath = ''): Stripped {
  const keys = new Map<string, string>();
  const server = side === 'server';
  const strip = (node: CanonNode, path: string): CanonNode => {
    if (node.kind !== 'element') return node;
    const attrs: CanonAttr[] = [];
    for (const attr of node.attrs) {
      if (server && attr.ns === null && TRANSPORT_ATTRIBUTES.has(attr.name)) continue;
      if (server && attr.ns === null && attr.name === KEY_ATTRIBUTE) { keys.set(path || node.tag, attr.value); continue; }
      attrs.push(attr);
    }
    const kept: CanonNode[] = [];
    const source = node.children;
    for (let i = 0; i < source.length; i++) {
      const child = source[i]!;
      if (child.kind === 'comment') {
        const open = server ? /^f:t([0-9]+)$/.exec(child.text) : null;
        if (open) {
          // An empty dynamic text is held open by one U+200B between its markers: kept as a holder.
          const close = `/f:t${open[1]}`;
          let end = i + 1;
          while (end < source.length && !(source[end]!.kind === 'comment' && (source[end] as CommentNode).text === close)) end++;
          const inside = source.slice(i + 1, end);
          if (inside.length === 1 && inside[0]!.kind === 'text' && (inside[0] as TextNode).text === HOLDER) {
            kept.push({ kind: 'text', text: HOLDER, holders: [0] });
            i = end;
          }
          continue;
        }
        if (isTransportComment(child.text)) continue;
      }
      kept.push(child);
    }
    // Join adjacent text (carrying holder offsets), drop empty text, then descend into elements.
    const joined: CanonNode[] = [];
    for (const child of kept) {
      const last = joined[joined.length - 1];
      if (child.kind === 'text') {
        if (child.text === '') continue;
        if (last && last.kind === 'text') {
          const holders = [...(last.holders ?? []), ...(child.holders ?? []).map(offset => offset + last.text.length)];
          joined[joined.length - 1] = holders.length
            ? { kind: 'text', text: last.text + child.text, holders }
            : { kind: 'text', text: last.text + child.text };
          continue;
        }
      }
      joined.push(child);
    }
    const at = positions(joined);
    const children = joined.map((child, index) => strip(child, childPath(path, child, at[index]!)));
    return { kind: 'element', ns: node.ns, tag: node.tag, attrs, children };
  };
  const tree = strip(root, rootPath || (root.kind === 'element' ? root.tag : ''));
  return { tree, keys };
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export type DiffKind =
  | 'tag' | 'namespace' | 'attribute-missing' | 'attribute-extra' | 'missing' | 'extra'
  | 'attribute-value' | 'attribute-namespace' | 'text' | 'comment' | 'key'
  // P2: a mutation record during activation, and an activation error (console or forma:error).
  | 'mutation' | 'activation-error';
/** A difference in what nodes exist; the stop rule (e2e/parity/README.md, 'The stop rule') counts these. */
export const STRUCTURAL_KINDS: ReadonlySet<DiffKind> = new Set(['tag', 'namespace', 'attribute-missing', 'attribute-extra', 'missing', 'extra']);

export interface Difference {
  readonly kind: DiffKind;
  readonly path: string;
  readonly server?: string;
  readonly client?: string;
}

export interface Comparison {
  readonly differences: readonly Difference[];
  readonly first: Difference | null;
  readonly count: number;
  readonly structural: number;
  /** Server holders compared: each matched client "" or "​" (or neither), a wire ambiguity. */
  readonly holderAmbiguous: number;
}

/** The server text as a reader sees it: a holder is an empty dynamic text and shows as nothing. */
function shown(node: TextNode): string {
  if (!node.holders?.length) return node.text;
  const holders = new Set(node.holders);
  let out = '';
  for (let i = 0; i < node.text.length; i++) if (!holders.has(i)) out += node.text[i];
  return out;
}

/** Whether a server text equals a client text: each holder is "" or "​" on the client, and nothing else varies. */
function textEquals(server: TextNode, client: string): boolean {
  if (!server.holders?.length) return server.text === client;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  let pattern = '^';
  let from = 0;
  for (const offset of server.holders) {
    pattern += `${escape(server.text.slice(from, offset))}\\u200B?`;
    from = offset + 1;
  }
  pattern += `${escape(server.text.slice(from))}$`;
  return new RegExp(pattern, 'u').test(client);
}

function summary(node: CanonNode): string {
  if (node.kind === 'text') return `#text ${JSON.stringify(shown(node))}`;
  if (node.kind === 'comment') return `<!--${node.text}-->`;
  const attrs = node.attrs.map(a => ` ${a.ns ? `{${a.ns}}` : ''}${a.name}=${JSON.stringify(a.value)}`).join('');
  return `<${node.tag}${attrs}>`;
}

export interface CompareOptions {
  /** Expected `data-forma-key` text by element path; when given, the server's lifted keys are checked against it. */
  readonly expectedKeys?: ReadonlyMap<string, string>;
  readonly serverKeys?: ReadonlyMap<string, string>;
}

/**
 * Attributes match by (namespace, qualified name). The same qualified name in another namespace is
 * an `attribute-namespace` difference (a value kind: the node exists on both sides, but a namespaced
 * attribute such as XLink's `xlink:href` does not act as an ordinary one); what remains is missing
 * or extra.
 */
function compareAttributes(a: ElementNode, e: ElementNode, path: string, differences: Difference[]): void {
  const key = (attr: CanonAttr) => `${attr.ns ?? ''}\u0000${attr.name}`;
  const client = new Map(e.attrs.map(attr => [key(attr), attr]));
  const serverOnly: CanonAttr[] = [];
  for (const attr of a.attrs) {
    const other = client.get(key(attr));
    if (!other) { serverOnly.push(attr); continue; }
    client.delete(key(attr));
    if (attr.value !== other.value) differences.push({ kind: 'attribute-value', path: `${path}[${attr.name}]`, server: attr.value, client: other.value });
  }
  const clientOnly = [...client.values()];
  for (const attr of serverOnly) {
    const index = clientOnly.findIndex(other => other.name === attr.name);
    if (index >= 0) {
      const other = clientOnly.splice(index, 1)[0]!;
      differences.push({ kind: 'attribute-namespace', path: `${path}[${attr.name}]`, server: String(attr.ns), client: String(other.ns) });
      if (attr.value !== other.value) differences.push({ kind: 'attribute-value', path: `${path}[${attr.name}]`, server: attr.value, client: other.value });
      continue;
    }
    differences.push({ kind: 'attribute-missing', path: `${path}[${attr.name}]`, server: attr.value });
  }
  for (const attr of clientOnly) differences.push({ kind: 'attribute-extra', path: `${path}[${attr.name}]`, client: attr.value });
}

/** Preorder; the first disagreement is `first`, the walk continues for the count. */
export function compareTrees(server: CanonNode, client: CanonNode, options: CompareOptions = {}): Comparison {
  const differences: Difference[] = [];
  let holderAmbiguous = 0;
  const textAgainst = (sc: TextNode, clientText: string, path: string): void => {
    holderAmbiguous += sc.holders?.length ?? 0;
    if (!textEquals(sc, clientText)) differences.push({ kind: 'text', path, server: shown(sc), client: clientText });
  };
  const walk = (a: CanonNode, b: CanonNode, path: string): void => {
    if (a.kind !== b.kind) { differences.push({ kind: 'tag', path, server: summary(a), client: summary(b) }); return; }
    if (a.kind === 'text') { textAgainst(a, (b as TextNode).text, path); return; }
    if (a.kind === 'comment') {
      if (a.text !== (b as CommentNode).text) differences.push({ kind: 'comment', path, server: a.text, client: (b as CommentNode).text });
      return;
    }
    const e = b as ElementNode;
    if (a.tag !== e.tag) { differences.push({ kind: 'tag', path, server: summary(a), client: summary(e) }); return; }
    if (a.ns !== e.ns) differences.push({ kind: 'namespace', path, server: String(a.ns), client: String(e.ns) });
    compareAttributes(a, e, path, differences);
    // Two cursors: a text present on one side only is a text-versus-empty value difference,
    // not a structural one, and the cursors stay aligned on the elements around it.
    const ap = positions(a.children), ep = positions(e.children);
    let i = 0, j = 0;
    while (i < a.children.length || j < e.children.length) {
      const sc = a.children[i], cc = e.children[j];
      if (sc && sc.kind === 'text' && (!cc || cc.kind !== 'text')) {
        textAgainst(sc, '', childPath(path, sc, ap[i]!));
        i++;
        continue;
      }
      if (cc && cc.kind === 'text' && (!sc || sc.kind !== 'text')) {
        differences.push({ kind: 'text', path: childPath(path, cc, ep[j]!), server: '', client: cc.text });
        j++;
        continue;
      }
      if (sc && cc) walk(sc, cc, childPath(path, sc, ap[i]!));
      else if (sc) differences.push({ kind: 'missing', path: childPath(path, sc, ap[i]!), server: summary(sc) });
      else if (cc) differences.push({ kind: 'extra', path: childPath(path, cc, ep[j]!), client: summary(cc) });
      i++;
      j++;
    }
  };
  walk(server, client, server.kind === 'element' ? server.tag : '');
  if (options.expectedKeys) {
    const serverKeys = options.serverKeys ?? new Map<string, string>();
    for (const [path, expected] of options.expectedKeys) {
      const actual = serverKeys.get(path);
      if (actual !== expected) differences.push({ kind: 'key', path, server: actual, client: expected });
    }
  }
  return {
    differences,
    first: differences[0] ?? null,
    count: differences.length,
    structural: differences.filter(d => STRUCTURAL_KINDS.has(d.kind)).length,
    holderAmbiguous,
  };
}

/** The class a structural difference belongs to: module, path without positions, kind. */
export function structuralClass(module: string, difference: Difference): string {
  return `${module}|${difference.path.replace(/:nth-child\([0-9]+\)/g, '')}|${difference.kind}`;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** `no-setter`: P3 for a module that names no transition setter (counted, not skipped). */
export type Verdict = 'equal' | 'different' | 'expected-divergent' | 'server-refused' | 'error' | 'no-setter';

export interface Report {
  readonly module: string;
  readonly seed: string;
  readonly index: number;
  readonly check: 'P1' | 'P2' | 'P3';
  readonly verdict: Verdict;
  readonly serverPath?: 'typed' | 'low-level';
  readonly first: Difference | null;
  readonly count: number;
  readonly structural: number;
  /** Server holders compared (each matched client "" or "​"): a wire ambiguity, counted, never silent. */
  readonly holderAmbiguous: number;
  readonly differences: readonly Difference[];
  readonly server: { readonly tree: CanonNode | null; readonly html?: string; readonly keys?: Readonly<Record<string, string>> };
  readonly client: { readonly tree: CanonNode | null };
  readonly expected?: { readonly ticket: string; readonly note?: string };
  readonly refusal?: { readonly code: string; readonly path?: string; readonly message?: string };
  readonly error?: string;
  readonly state?: unknown;
  /** P3: the state the page was activated at and the state the setter moved it to. */
  readonly transition?: { readonly from: number; readonly to: number };
  /** P2: island hosts on the page, and how many hold core's disposer after activation. */
  readonly activation?: { readonly hosts: number; readonly activated: number };
  /** The typed path's bind or load refusals, when the low-level path rendered in its place. */
  readonly bind?: readonly { readonly code: string; readonly path: string; readonly message: string }[];
  /** P1, when not equal: the compiler's diagnostics for the module's page, which often explain a difference. */
  readonly compiler?: readonly string[];
}

export function makeReport(
  base: Pick<Report, 'module' | 'seed' | 'index' | 'check'> & Partial<Report>,
  comparison: Comparison | null,
): Report {
  const verdict: Verdict = base.verdict ?? (comparison ? (comparison.count === 0 ? 'equal' : 'different') : 'error');
  return {
    first: comparison?.first ?? null,
    count: comparison?.count ?? 0,
    structural: comparison?.structural ?? 0,
    holderAmbiguous: comparison?.holderAmbiguous ?? 0,
    differences: comparison?.differences ?? [],
    server: { tree: null },
    client: { tree: null },
    ...base,
    verdict,
  };
}

function short(value: string | undefined): string {
  if (value === undefined) return '∅';
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…"` : text;
}

/** One line a developer reads first: `P1 nested-islands#3 different: text at main > … server="beta" client=""`. */
export function summarize(report: Report): string {
  const ambiguous = report.holderAmbiguous ? ` (${report.holderAmbiguous} holder-ambiguous)` : '';
  const head = `${report.check} ${report.module}#${report.index} ${report.verdict}`;
  if (report.verdict === 'equal') return `${head}${ambiguous}`;
  if (report.verdict === 'server-refused') return `${head}: ${report.refusal?.code ?? '?'} at ${report.refusal?.path ?? '?'}`;
  if (report.verdict === 'error') return `${head}: ${report.error ?? '?'}`;
  const first = report.first;
  if (!first) return report.error ? `${head}: ${report.error}` : `${head}${ambiguous}`;
  return `${head}: ${first.kind} at ${first.path} server=${short(first.server)} client=${short(first.client)}` +
    ` (${report.count} difference${report.count === 1 ? '' : 's'}, ${report.structural} structural)${ambiguous}`;
}
