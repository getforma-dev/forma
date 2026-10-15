import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRUCTURAL_KINDS, compareTrees, isTransportComment, makeReport, stripTransport, structuralClass, summarize,
  type CanonNode, type ElementNode,
} from '../src/compare.mts';

const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const el = (tag: string, attrs: Record<string, string>, children: CanonNode[], ns: string | null = HTML): ElementNode => ({ kind: 'element', ns, tag, attrs, children });
const text = (t: string): CanonNode => ({ kind: 'text', text: t });
const comment = (t: string): CanonNode => ({ kind: 'comment', text: t });
const both = (server: CanonNode, client: CanonNode) => compareTrees(stripTransport(server).tree, stripTransport(client).tree);

test('identical trees compare equal with no first difference', () => {
  const tree = el('main', { id: 'app' }, [el('p', { class: 'on' }, [text('shown')]), text('tail')]);
  const result = both(tree, structuredClone(tree));
  assert.equal(result.count, 0);
  assert.equal(result.structural, 0);
  assert.equal(result.first, null);
});

test('one text node differs: a value difference naming the path and both texts', () => {
  const server = el('main', {}, [el('p', {}, [text('a')]), el('span', {}, [text('beta')])]);
  const client = el('main', {}, [el('p', {}, [text('a')]), el('span', {}, [text('')])]);
  const result = both(server, client);
  assert.equal(result.count, 1);
  assert.equal(result.structural, 0);
  // The client's empty text is dropped, so the server's text node has no counterpart: a text
  // against an empty text is a value difference, and the elements around it stay aligned.
  assert.deepEqual(result.first, { kind: 'text', path: 'main > span:nth-child(2) > #text', server: 'beta', client: '' });
  const shifted = both(el('main', {}, [text('lead'), el('p', {}, [])]), el('main', {}, [el('p', {}, [])]));
  assert.deepEqual(shifted.differences, [{ kind: 'text', path: 'main > #text', server: 'lead', client: '' }]);
});

test('one text node differs in value when both sides have the node', () => {
  const server = el('main', {}, [el('span', {}, [text('beta')])]);
  const client = el('main', {}, [el('span', {}, [text('gamma')])]);
  const result = both(server, client);
  assert.deepEqual(result.first, { kind: 'text', path: 'main > span:nth-child(1) > #text', server: 'beta', client: 'gamma' });
  assert.equal(result.structural, 0);
});

test('one attribute differs: value, missing and extra are told apart and attribute order is not a difference', () => {
  const server = el('main', {}, [el('a', { href: '/x', class: 'link' }, [])]);
  assert.deepEqual(both(server, el('main', {}, [el('a', { class: 'link', href: '/y' }, [])])).first,
    { kind: 'attribute-value', path: 'main > a:nth-child(1)[href]', server: '/x', client: '/y' });
  assert.deepEqual(both(server, el('main', {}, [el('a', { class: 'link' }, [])])).first,
    { kind: 'attribute-missing', path: 'main > a:nth-child(1)[href]', server: '/x' });
  assert.deepEqual(both(server, el('main', {}, [el('a', { class: 'link', href: '/x', title: 't' }, [])])).first,
    { kind: 'attribute-extra', path: 'main > a:nth-child(1)[title]', client: 't' });
  assert.equal(both(server, el('main', {}, [el('a', { class: 'link', href: '/x' }, [])])).count, 0);
});

test('marker-only differences are ignored: walker markers, the U+200B holder and the activation attributes against core anchors', () => {
  const server = el('main', { id: 'app' }, [
    comment('f:i0'),
    el('div', { 'data-forma-island': '0', 'data-forma-component': 'Panel', 'data-forma-status': 'pending', 'data-forma-hydrate': 'load', 'data-forma-state': '0', 'data-forma-h': 'ad58eaa81b724860', class: 'panel' }, [
      el('h3', {}, [comment('f:t0'), text('Panel'), comment('/f:t0')]),
      comment('f:s2'), el('p', { class: 'on' }, [text('shown')]), comment('/f:s2'),
      comment('f:l3'), el('li', {}, [text('row')]), comment('/f:l3'),
      el('em', {}, [comment('f:t4'), text('​'), comment('/f:t4')]),
    ]),
    comment('/f:i0'),
  ]);
  const client = el('main', { id: 'app' }, [
    el('div', { class: 'panel' }, [
      el('h3', {}, [text('Panel')]),
      comment('forma-show'), el('p', { class: 'on' }, [text('shown')]), comment('/forma-show'),
      comment('forma-list-start'), el('li', {}, [text('row')]), comment('forma-list-end'),
      el('em', {}, []),
    ]),
  ]);
  const result = both(server, client);
  assert.equal(result.count, 0, JSON.stringify(result.differences));
  assert.equal((stripTransport(server).tree as ElementNode).children.length, 1, 'the island markers are gone');
  assert.deepEqual((stripTransport(server).tree as ElementNode).children[0]!, (stripTransport(client).tree as ElementNode).children[0]!);
});

test('an authored comment is content, not a marker: it stays and a different one is a comment difference', () => {
  assert.equal(isTransportComment('f:t12'), true);
  assert.equal(isTransportComment('/f:l0'), true);
  assert.equal(isTransportComment('forma-list-end'), true);
  assert.equal(isTransportComment('f:side note'), false);
  assert.equal(isTransportComment('f:t'), false);
  assert.equal(isTransportComment('todo'), false);
  const server = el('main', {}, [comment('f:side note'), el('p', {}, [])]);
  const same = both(server, el('main', {}, [comment('f:side note'), el('p', {}, [])]));
  assert.equal(same.count, 0);
  const changed = both(server, el('main', {}, [comment('other'), el('p', {}, [])]));
  assert.deepEqual(changed.first, { kind: 'comment', path: 'main > #comment', server: 'f:side note', client: 'other' });
  assert.equal(changed.structural, 0);
});

test('the same text split across nodes equals the text in one node; empty text nodes are dropped', () => {
  const server = el('p', {}, [text('a'), comment('f:t0'), text('b'), comment('/f:t0'), text('c')]);
  const client = el('p', {}, [text('abc')]);
  assert.equal(both(server, client).count, 0);
  assert.equal(both(el('p', {}, [text(''), text('x'), text('')]), el('p', {}, [text('x')])).count, 0);
});

test('a U+200B that is not the sole content of an f:t pair is text, not transport', () => {
  const server = el('p', {}, [comment('f:t0'), text('​'), text('x'), comment('/f:t0')]);
  const client = el('p', {}, [text('x')]);
  const result = both(server, client);
  assert.equal(result.count, 1);
  assert.deepEqual(result.first, { kind: 'text', path: 'p > #text', server: '​x', client: 'x' });
  const bare = both(el('p', {}, [text('​')]), el('p', {}, []));
  assert.equal(bare.count, 1, 'a bare U+200B outside markers is text');
});

test('data-forma-key is lifted out: a key on the server side alone is no attribute difference, and a wrong or missing key is a key difference', () => {
  const server = el('ul', {}, [el('li', { 'data-forma-key': '7', class: 'row' }, [text('a')]), el('li', { 'data-forma-key': '8', class: 'row' }, [text('b')])]);
  const client = el('ul', {}, [el('li', { class: 'row' }, [text('a')]), el('li', { class: 'row' }, [text('b')])]);
  const stripped = stripTransport(server);
  assert.deepEqual(stripped.keys, { 'ul > li:nth-child(1)': '7', 'ul > li:nth-child(2)': '8' });
  assert.equal(compareTrees(stripped.tree, stripTransport(client).tree).count, 0);
  const checked = compareTrees(stripped.tree, stripTransport(client).tree, {
    serverKeys: stripped.keys,
    expectedKeys: { 'ul > li:nth-child(1)': '7', 'ul > li:nth-child(2)': '9', 'ul > li:nth-child(3)': '10' },
  });
  assert.equal(checked.count, 2);
  assert.deepEqual(checked.differences, [
    { kind: 'key', path: 'ul > li:nth-child(2)', server: '8', client: '9' },
    { kind: 'key', path: 'ul > li:nth-child(3)', server: undefined, client: '10' },
  ]);
  assert.equal(checked.structural, 0, 'a key difference is a value difference');
});

test('a tag, a namespace, a missing node and an extra node are structural; the first and the counts are right on a mixed tree', () => {
  const server = el('main', {}, [el('p', {}, [text('one')]), el('span', {}, [text('two')]), el('b', {}, [])]);
  const client = el('main', {}, [el('div', {}, [text('one')]), el('span', {}, [text('TWO')])]);
  const result = both(server, client);
  assert.deepEqual(result.first, { kind: 'tag', path: 'main > p:nth-child(1)', server: '<p>', client: '<div>' });
  assert.equal(result.count, 3);
  assert.equal(result.structural, 2);
  assert.deepEqual(result.differences.map(d => d.kind), ['tag', 'text', 'missing']);
  const svg = both(el('svg', {}, [el('title', {}, [], SVG)], SVG), el('svg', {}, [el('title', {}, [], HTML)], SVG));
  assert.deepEqual(svg.first, { kind: 'namespace', path: 'svg > title:nth-child(1)', server: SVG, client: HTML });
  const extra = both(el('main', {}, []), el('main', {}, [el('p', {}, [])]));
  assert.deepEqual(extra.first, { kind: 'extra', path: 'main > p:nth-child(1)', client: '<p>' });
  for (const kind of ['tag', 'namespace', 'attribute-missing', 'attribute-extra', 'missing', 'extra'] as const) assert.ok(STRUCTURAL_KINDS.has(kind));
  for (const kind of ['attribute-value', 'text', 'comment', 'key'] as const) assert.ok(!STRUCTURAL_KINDS.has(kind));
});

test('a structural class ignores positions, so a hundred states dropping the same element are one class', () => {
  const a = structuralClass('m', { kind: 'missing', path: 'main > ul:nth-child(2) > li:nth-child(7)' });
  const b = structuralClass('m', { kind: 'missing', path: 'main > ul:nth-child(2) > li:nth-child(31)' });
  assert.equal(a, b);
  assert.equal(a, 'm|main > ul > li|missing');
  assert.notEqual(a, structuralClass('m', { kind: 'extra', path: 'main > ul:nth-child(2) > li:nth-child(7)' }));
});

test('the report carries module, seed, index, verdict, the first difference and both trees; the summary is one line', () => {
  const server = el('main', {}, [el('span', {}, [text('beta')])]);
  const client = el('main', {}, [el('span', {}, [text('')])]);
  const comparison = both(server, client);
  const report = makeReport({ module: 'nested-islands', seed: 'forma-183', index: 3, check: 'P1', server: { tree: server, html: '<main>…' }, client: { tree: client } }, comparison);
  assert.equal(report.verdict, 'different');
  assert.equal(report.count, 1);
  assert.equal(report.server.tree, server);
  assert.equal(report.client.tree, client);
  assert.equal(summarize(report), 'P1 nested-islands#3 different: text at main > span:nth-child(1) > #text server="beta" client="" (1 difference, 0 structural)');
  const equal = makeReport({ module: 'static-page', seed: 's', index: 0, check: 'P1' }, both(server, structuredClone(server)));
  assert.equal(equal.verdict, 'equal');
  assert.equal(summarize(equal), 'P1 static-page#0 equal');
  const refused = makeReport({ module: 'home', seed: 's', index: 1, check: 'P1', verdict: 'server-refused', refusal: { code: 'RENDER-402', path: 'rows[0].id' } }, null);
  assert.equal(summarize(refused), 'P1 home#1 server-refused: RENDER-402 at rows[0].id');
});
