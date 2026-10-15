// The browser-side serializer against Chromium's own parser (TESTING.md P8: no fake DOM). Each
// case is a hand-written pair: server-shaped HTML parsed by the browser, and a client-shaped
// tree built with createElement and setAttribute, as h() builds one.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from '@playwright/test';
import { PAGE_POLICY } from '../src/browser.mts';
import { compareTrees, stripTransport, type CanonNode, type ElementNode } from '../src/compare.mts';
import { canonicalizeDom } from '../src/dom-canon.mts';

const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const MATHML = 'http://www.w3.org/1998/Math/MathML';
const XLINK = 'http://www.w3.org/1999/xlink';

let browser: Browser;
let page: Page;
before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});
after(async () => { await browser?.close(); });

/** The server side: the HTML parsed by the browser, then serialized. */
async function parsed(html: string): Promise<ElementNode> {
  await page.setContent(`<!doctype html><body><div id="root">${html}</div></body>`);
  return await page.$eval('#root', canonicalizeDom) as ElementNode;
}

/** The client side: a tree built in the page by DOM calls, then serialized. */
async function built(build: string): Promise<ElementNode> {
  await page.setContent('<!doctype html><body><div id="root"></div></body>');
  await page.evaluate(`(() => { const root = document.getElementById('root'); ${build} })()`);
  return await page.$eval('#root', canonicalizeDom) as ElementNode;
}

const only = (tree: ElementNode): CanonNode => tree.children[0]!;
const compare = (server: CanonNode, client: CanonNode) => compareTrees(stripTransport(server, 'server').tree, stripTransport(client, 'client').tree);
const plain = (name: string, value: string) => ({ name, ns: null, value });

test('the parse undoes the server\'s escaping: values are read as the DOM holds them, and equal values set by DOM calls compare equal', async () => {
  const server = await parsed('<div title="&lt;/script&gt;" class="a&amp;b" data-q="&quot;x&quot;">x &amp; y &lt;b&gt;</div>');
  assert.deepEqual(only(server), {
    kind: 'element', ns: HTML, tag: 'div',
    attrs: [plain('class', 'a&b'), plain('data-q', '"x"'), plain('title', '</script>')],
    children: [{ kind: 'text', text: 'x & y <b>' }],
  });
  const client = await built(`const d = document.createElement('div'); d.setAttribute('title', '</script>');
    d.setAttribute('data-q', '"x"'); d.setAttribute('class', 'a&b'); d.append('x & y <b>'); root.append(d);`);
  assert.equal(compare(server, client).count, 0);
});

test('faithful: every comment and text node is kept in order and attributes are sorted by name, so markers reach stripTransport', async () => {
  const server = await parsed('<p data-z="1" data-a="2">a<!--f:t0-->b<!--/f:t0-->c<!--authored--></p>');
  const p = only(server) as ElementNode;
  assert.deepEqual(p.attrs.map(attr => attr.name), ['data-a', 'data-z']);
  assert.deepEqual(p.children, [
    { kind: 'text', text: 'a' }, { kind: 'comment', text: 'f:t0' }, { kind: 'text', text: 'b' },
    { kind: 'comment', text: '/f:t0' }, { kind: 'text', text: 'c' }, { kind: 'comment', text: 'authored' },
  ]);
  const client = await built(`const p = document.createElement('p'); p.setAttribute('data-a', '2'); p.setAttribute('data-z', '1');
    p.append('abc', document.createComment('authored')); root.append(p);`);
  assert.equal(compare(server, client).count, 0);
});

test('namespaces: SVG and MathML elements carry theirs, a foreign attribute keeps its qualified name and namespace, and an HTML-namespace twin differs', async () => {
  const server = await parsed('<svg viewBox="0 0 1 1"><a xlink:href="#x"><title>t</title></a></svg><math><mi>x</mi></math>');
  const svg = server.children[0] as ElementNode;
  assert.equal(svg.ns, SVG);
  const a = svg.children[0] as ElementNode;
  assert.equal(a.ns, SVG);
  assert.deepEqual(a.attrs, [{ name: 'xlink:href', ns: XLINK, value: '#x' }]);
  assert.equal((a.children[0] as ElementNode).ns, SVG);
  assert.equal((server.children[1] as ElementNode).ns, MATHML);
  assert.deepEqual(svg.attrs, [plain('viewBox', '0 0 1 1')], 'SVG attribute case is the parser\'s adjusted case');
  const wrong = await built(`const s = document.createElementNS('${SVG}', 'svg'); s.setAttribute('viewBox', '0 0 1 1');
    const a = document.createElementNS('${SVG}', 'a'); a.setAttributeNS('${XLINK}', 'xlink:href', '#x');
    const t = document.createElement('title'); t.append('t'); a.append(t); s.append(a);
    const m = document.createElementNS('${MATHML}', 'math'); const mi = document.createElementNS('${MATHML}', 'mi'); mi.append('x'); m.append(mi);
    root.append(s, m);`);
  const result = compare(server, wrong);
  assert.equal(result.count, 1);
  assert.deepEqual(result.first, { kind: 'namespace', path: 'div > svg:nth-child(1) > a:nth-child(1) > title:nth-child(1)', server: SVG, client: HTML });
});

test('an XLink attribute set without its namespace (setAttribute) is an attribute-namespace difference from the parsed one', async () => {
  const server = await parsed('<svg><use xlink:href="#a"></use></svg>');
  const namespaced = await built(`const s = document.createElementNS('${SVG}', 'svg'); const u = document.createElementNS('${SVG}', 'use');
    u.setAttributeNS('${XLINK}', 'xlink:href', '#a'); s.append(u); root.append(s);`);
  assert.equal(compare(server, namespaced).count, 0);
  const unnamespaced = await built(`const s = document.createElementNS('${SVG}', 'svg'); const u = document.createElementNS('${SVG}', 'use');
    u.setAttribute('xlink:href', '#a'); s.append(u); root.append(s);`);
  assert.deepEqual(compare(server, unnamespaced).differences,
    [{ kind: 'attribute-namespace', path: 'div > svg:nth-child(1) > use:nth-child(1)[xlink:href]', server: XLINK, client: 'null' }]);
});

test('an attribute named __proto__ survives the parse and the serialization, and a twin without it differs', async () => {
  const server = await parsed('<div __proto__="x" constructor="c"></div>');
  assert.deepEqual((only(server) as ElementNode).attrs, [plain('__proto__', 'x'), plain('constructor', 'c')]);
  const client = await built(`const d = document.createElement('div'); d.setAttribute('constructor', 'c'); root.append(d);`);
  assert.deepEqual(compare(server, client).differences, [{ kind: 'attribute-missing', path: 'div > div:nth-child(1)[__proto__]', server: 'x' }]);
});

test('a parsed template\'s inert content is compared under #content, and children appended directly differ structurally', async () => {
  const server = await parsed('<template><b>x</b></template>');
  assert.deepEqual(only(server), {
    kind: 'element', ns: HTML, tag: 'template', attrs: [],
    children: [{ kind: 'element', ns: null, tag: '#content', attrs: [], children: [{ kind: 'element', ns: HTML, tag: 'b', attrs: [], children: [{ kind: 'text', text: 'x' }] }] }],
  });
  const inert = await built(`const t = document.createElement('template'); const b = document.createElement('b'); b.append('x'); t.content.append(b); root.append(t);`);
  assert.equal(compare(server, inert).count, 0);
  const live = await built(`const t = document.createElement('template'); const b = document.createElement('b'); b.append('x'); t.append(b); root.append(t);`);
  const result = compare(server, live);
  assert.ok(result.structural > 0, JSON.stringify(result.differences));
});

test('the parser\'s own rules are what is compared: the first line feed of a textarea is dropped by the parse, not by the harness', async () => {
  const server = await parsed('<textarea>\nX</textarea><pre>\n\nY</pre>');
  assert.deepEqual((server.children[0] as ElementNode).children, [{ kind: 'text', text: 'X' }]);
  assert.deepEqual((server.children[1] as ElementNode).children, [{ kind: 'text', text: '\nY' }]);
});

test('a root that is not an element, text or comment is refused', async () => {
  await page.setContent('<!doctype html><body></body>');
  await assert.rejects(page.evaluate(canonicalizeDom, await page.evaluateHandle(() => document)), /not an element, text or comment/);
});

test('the served page\'s policy enforces Trusted Types: an innerHTML write throws, the forma policy is allowed', async () => {
  const canary = await browser.newPage();
  try {
    await canary.route('http://parity.invalid/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/canary.mjs') {
        return route.fulfill({ contentType: 'text/javascript', body: `
          const out = {};
          try { document.body.innerHTML = '<b>x</b>'; out.sink = 'written'; } catch (error) { out.sink = error.name; }
          try { trustedTypes.createPolicy('forma', { createHTML: s => s }); out.policy = 'created'; } catch (error) { out.policy = error.name; }
          window.__canary = out;` });
      }
      return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': PAGE_POLICY }, body: '<!doctype html><script type="module" src="/canary.mjs"></script><body></body>' });
    });
    await canary.goto('http://parity.invalid/');
    await canary.waitForFunction(() => (window as unknown as { __canary?: unknown }).__canary !== undefined);
    assert.deepEqual(await canary.evaluate(() => (window as unknown as { __canary: unknown }).__canary), { sink: 'TypeError', policy: 'created' });
  } finally {
    await canary.close();
  }
});
