/**
 * What "parity" compares (FORMA-183, DR-9; e2e/parity/README.md, 'What parity compares').
 *
 * Both sides are canonical trees of the browser's own parse (`dom-canon.mts`). Transport is removed
 * and nothing else: the walker's marker comments (`f:tN`, `f:sN`, `f:lN`, `f:iN` pairs), core's own
 * show and list anchors, the `data-forma-*` activation attributes, and the U+200B that holds an
 * empty dynamic text open. `data-forma-key` is lifted into a side table and checked against the
 * expected key text, never against the client twin, which writes no key. After removal, adjacent
 * text nodes are joined and empty ones dropped: where a text node ends is neither a value nor
 * structure (adoption's cursor handles that split and P2 proves it).
 *
 * The harness applies no normalization of its own. Rule 1 and the other value rules are the
 * writers' business on both sides and the parse is the browser's; that is P1's claim.
 */

export interface ElementNode {
  readonly kind: 'element';
  readonly ns: string | null;
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly CanonNode[];
}
export interface TextNode { readonly kind: 'text'; readonly text: string }
export interface CommentNode { readonly kind: 'comment'; readonly text: string }
export type CanonNode = ElementNode | TextNode | CommentNode;

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
  /** `data-forma-key` values by element path, lifted out of the attributes. */
  readonly keys: Readonly<Record<string, string>>;
}

/** A CSS-like path from the compared root: `tag:nth-child(n)` per level, `#text` / `#comment` leaves. */
function childPath(parent: string, node: CanonNode, position: number): string {
  const step = node.kind === 'element' ? `${node.tag}:nth-child(${position})` : node.kind === 'text' ? '#text' : '#comment';
  return parent ? `${parent} > ${step}` : step;
}

export function stripTransport(root: CanonNode, rootPath = ''): Stripped {
  const keys: Record<string, string> = {};
  const strip = (node: CanonNode, path: string): CanonNode => {
    if (node.kind !== 'element') return node;
    const attrs: Record<string, string> = {};
    for (const name of Object.keys(node.attrs).sort()) {
      if (TRANSPORT_ATTRIBUTES.has(name)) continue;
      if (name === KEY_ATTRIBUTE) { keys[path || node.tag] = node.attrs[name]!; continue; }
      attrs[name] = node.attrs[name]!;
    }
    const kept: CanonNode[] = [];
    const source = node.children;
    for (let i = 0; i < source.length; i++) {
      const child = source[i]!;
      if (child.kind === 'comment') {
        const open = /^f:t([0-9]+)$/.exec(child.text);
        if (open) {
          // An empty dynamic text is held open by one U+200B between its markers: transport, not text.
          const close = `/f:t${open[1]}`;
          let end = i + 1;
          while (end < source.length && !(source[end]!.kind === 'comment' && (source[end] as CommentNode).text === close)) end++;
          const inside = source.slice(i + 1, end);
          if (inside.length === 1 && inside[0]!.kind === 'text' && (inside[0] as TextNode).text === HOLDER) {
            i = end;
            continue;
          }
          continue;
        }
        if (isTransportComment(child.text)) continue;
        kept.push(child);
        continue;
      }
      kept.push(child);
    }
    // Join adjacent text, drop empty text, then descend into elements with their final positions.
    const joined: CanonNode[] = [];
    for (const child of kept) {
      const last = joined[joined.length - 1];
      if (child.kind === 'text') {
        if (child.text === '') continue;
        if (last && last.kind === 'text') { joined[joined.length - 1] = { kind: 'text', text: last.text + child.text }; continue; }
      }
      joined.push(child);
    }
    const children = joined.map((child, index) => strip(child, childPath(path, child, index + 1)));
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
  | 'attribute-value' | 'text' | 'comment' | 'key';
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
}

function summary(node: CanonNode): string {
  if (node.kind === 'text') return `#text ${JSON.stringify(node.text)}`;
  if (node.kind === 'comment') return `<!--${node.text}-->`;
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}=${JSON.stringify(v)}`).join('');
  return `<${node.tag}${attrs}>`;
}

export interface CompareOptions {
  /** Expected `data-forma-key` text by element path; when given, the server's lifted keys are checked against it. */
  readonly expectedKeys?: Readonly<Record<string, string>>;
  readonly serverKeys?: Readonly<Record<string, string>>;
}

/** Preorder; the first disagreement is `first`, the walk continues for the count. */
export function compareTrees(server: CanonNode, client: CanonNode, options: CompareOptions = {}): Comparison {
  const differences: Difference[] = [];
  const walk = (a: CanonNode, b: CanonNode, path: string): void => {
    if (a.kind !== b.kind) { differences.push({ kind: 'tag', path, server: summary(a), client: summary(b) }); return; }
    if (a.kind === 'text') {
      if (a.text !== (b as TextNode).text) differences.push({ kind: 'text', path, server: a.text, client: (b as TextNode).text });
      return;
    }
    if (a.kind === 'comment') {
      if (a.text !== (b as CommentNode).text) differences.push({ kind: 'comment', path, server: a.text, client: (b as CommentNode).text });
      return;
    }
    const e = b as ElementNode;
    if (a.tag !== e.tag) { differences.push({ kind: 'tag', path, server: summary(a), client: summary(e) }); return; }
    if (a.ns !== e.ns) differences.push({ kind: 'namespace', path, server: String(a.ns), client: String(e.ns) });
    const names = [...new Set([...Object.keys(a.attrs), ...Object.keys(e.attrs)])].sort();
    for (const name of names) {
      const sv = a.attrs[name], cv = e.attrs[name];
      if (sv === undefined) differences.push({ kind: 'attribute-extra', path: `${path}[${name}]`, client: cv });
      else if (cv === undefined) differences.push({ kind: 'attribute-missing', path: `${path}[${name}]`, server: sv });
      else if (sv !== cv) differences.push({ kind: 'attribute-value', path: `${path}[${name}]`, server: sv, client: cv });
    }
    // Two cursors: a text present on one side only is a text-versus-empty value difference,
    // not a structural one, and the cursors stay aligned on the elements around it.
    let i = 0, j = 0;
    while (i < a.children.length || j < e.children.length) {
      const sc = a.children[i], cc = e.children[j];
      if (sc && sc.kind === 'text' && (!cc || cc.kind !== 'text')) {
        differences.push({ kind: 'text', path: childPath(path, sc, i + 1), server: sc.text, client: '' });
        i++;
        continue;
      }
      if (cc && cc.kind === 'text' && (!sc || sc.kind !== 'text')) {
        differences.push({ kind: 'text', path: childPath(path, cc, j + 1), server: '', client: cc.text });
        j++;
        continue;
      }
      if (sc && cc) walk(sc, cc, childPath(path, sc, i + 1));
      else if (sc) differences.push({ kind: 'missing', path: childPath(path, sc, i + 1), server: summary(sc) });
      else if (cc) differences.push({ kind: 'extra', path: childPath(path, cc, j + 1), client: summary(cc) });
      i++;
      j++;
    }
  };
  walk(server, client, server.kind === 'element' ? server.tag : '');
  if (options.expectedKeys) {
    const serverKeys = options.serverKeys ?? {};
    for (const [path, expected] of Object.entries(options.expectedKeys)) {
      const actual = serverKeys[path];
      if (actual !== expected) differences.push({ kind: 'key', path, server: actual, client: expected });
    }
  }
  return {
    differences,
    first: differences[0] ?? null,
    count: differences.length,
    structural: differences.filter(d => STRUCTURAL_KINDS.has(d.kind)).length,
  };
}

/** The class a structural difference belongs to: module, path without positions, kind. */
export function structuralClass(module: string, difference: Difference): string {
  return `${module}|${difference.path.replace(/:nth-child\([0-9]+\)/g, '')}|${difference.kind}`;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type Verdict = 'equal' | 'different' | 'expected-divergent' | 'server-refused' | 'error';

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
  readonly differences: readonly Difference[];
  readonly server: { readonly tree: CanonNode | null; readonly html?: string; readonly keys?: Readonly<Record<string, string>> };
  readonly client: { readonly tree: CanonNode | null };
  readonly expected?: { readonly ticket: string; readonly note?: string };
  readonly refusal?: { readonly code: string; readonly path?: string; readonly message?: string };
  readonly error?: string;
  readonly state?: unknown;
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
  const head = `${report.check} ${report.module}#${report.index} ${report.verdict}`;
  if (report.verdict === 'equal') return head;
  if (report.verdict === 'server-refused') return `${head}: ${report.refusal?.code ?? '?'} at ${report.refusal?.path ?? '?'}`;
  if (report.verdict === 'error') return `${head}: ${report.error ?? '?'}`;
  const first = report.first;
  if (!first) return head;
  return `${head}: ${first.kind} at ${first.path} server=${short(first.server)} client=${short(first.client)}` +
    ` (${report.count} difference${report.count === 1 ? '' : 's'}, ${report.structural} structural)`;
}
