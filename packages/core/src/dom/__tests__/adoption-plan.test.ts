import { describe, expect, it, vi } from 'vitest';
import { AdoptionDom } from '../adoption-plan.js';
import { SVG_NS, MATHML_NS } from '../namespace.js';

function fixture(html: string) {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = `<main><section>${html}</section></main><aside></aside>`;
  return { doc, host: doc.querySelector('section')!, other: doc.querySelector('aside')! };
}
describe('read-only structural cursor', () => {
  it('consumes static structure, coalesced authored text, attributes and exact marker text without writes', () => {
    const { host } = fixture('before <span class="label">Hello world</span>\n<!--f:t2-->value<!--/f:t2-->');
    const initial = host.innerHTML, nodes = [...host.childNodes];
    const observer = new MutationObserver(() => {});
    observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
    const setters = [vi.spyOn(host, 'setAttribute'), vi.spyOn(host, 'appendChild'), vi.spyOn(host, 'removeChild')];
    const dom = new AdoptionDom(host), cursor = dom.children();
    cursor.text('before'); cursor.text(' ');
    const span = cursor.element('SPAN');
    dom.expectAttribute(span, 'class', 'label');
    dom.expectAttribute(span, 'title', null);
    const contents = dom.children(span);
    contents.text('Hello'); contents.text(' '); contents.text('world'); contents.finish();
    cursor.text('\n');
    expect(cursor.textRange('value')).toBe(nodes[4]);
    cursor.finish(); dom.assertUnchanged();
    expect(host.innerHTML).toBe(initial); expect([...host.childNodes]).toEqual(nodes);
    expect(observer.takeRecords()).toEqual([]);
    setters.forEach(setter => { expect(setter).not.toHaveBeenCalled(); setter.mockRestore(); });
    observer.disconnect();
  });

  it('captures exact multiple-node, shared-text and zero-width row spans without splitting',async()=>{
    const {host}=fixture('<!--f:l0-->pre<b>a</b>postpre<b>b</b>post<!--/f:l0-->');
    const original=[...host.childNodes],records:MutationRecord[]=[],observer=new MutationObserver(batch=>records.push(...batch));
    observer.observe(host,{subtree:true,attributes:true,childList:true,characterData:true});
    const dom=new AdoptionDom(host),root=dom.children(),rows=dom.within(root.range('l'));
    const a=rows.capture(()=>{rows.text('pre');const b=rows.element('b');dom.children(b).text('a');rows.text('post');});
    const empty=rows.capture(()=>{});
    const b=rows.capture(()=>{rows.text('pre');const b=rows.element('b');dom.children(b).text('b');rows.text('post');});
    rows.finish();root.finish();dom.assertUnchanged();await new Promise(resolve=>setTimeout(resolve,0));
    expect(empty.pieces).toEqual([]);expect(a.pieces.map(piece=>piece.node)).toEqual(original.slice(1,4));
    expect(b.pieces.map(piece=>piece.node)).toEqual(original.slice(3,6));
    expect(a.pieces[2]).toEqual({node:original[3],from:0,to:4,text:'postpre'});
    expect(b.pieces[0]).toEqual({node:original[3],from:4,to:7,text:'postpre'});
    expect([...host.childNodes]).toEqual(original);expect(records.concat(observer.takeRecords())).toEqual([]);observer.disconnect();
  });

  it('does not skip authored whitespace or silently accept surplus nodes', () => {
    const { host } = fixture(' <b>bold</b> ');
    const dom = new AdoptionDom(host), cursor = dom.children();
    expect(() => cursor.element('b')).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_NODE' }));
    cursor.text(' '); const b = cursor.element('b');
    const content = dom.children(b); content.text('bold'); content.finish();
    expect(() => cursor.finish()).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }));
    cursor.text(' '); cursor.finish();
    expect(() => dom.children(b).text('other')).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_VALUE' }));
    expect(() => dom.expectAttribute(b, 'title', 'missing')).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_VALUE' }));
  });

  it('does not consume a text prefix as a complete child or replace an incorrect tag', () => {
    const { host } = fixture('hello<span></span>');
    const cursor = new AdoptionDom(host).children();
    cursor.text('hell');
    expect(() => cursor.finish()).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }));
    expect(() => cursor.element('span')).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_NODE' }));
    cursor.text('o');
    expect(() => cursor.element('strong')).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_NODE' }));
    expect(host.innerHTML).toBe('hello<span></span>');
  });

  it('keeps namespace and foreign tag case exact', () => {
    const { host, doc } = fixture('<svg><clipPath></clipPath><title>SVG</title></svg>');
    // happy-dom does not assign MathML namespaces while parsing HTML. Build
    // the real namespaced nodes explicitly; native parser parity is a browser gate.
    const mathNode = doc.createElementNS(MATHML_NS, 'math');
    mathNode.append(doc.createElementNS(MATHML_NS, 'mi')); host.append(mathNode);
    const dom = new AdoptionDom(host), cursor = dom.children();
    const svg = cursor.element('svg', SVG_NS);
    const inside = dom.children(svg);
    expect(() => inside.element('clippath', SVG_NS)).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_NODE' }));
    inside.element('clipPath', SVG_NS);
    expect(() => inside.element('title')).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_NODE' }));
    const title = inside.element('title', SVG_NS);
    dom.children(title).text('SVG'); inside.finish();
    const math = cursor.element('math', MATHML_NS);
    dom.children(math).element('mi', MATHML_NS); cursor.finish();
    expect(() => dom.assertUnchanged()).not.toThrow();
  });

  it('checks namespaced attributes without confusing a same-spelled unnamespaced value', () => {
    const { host } = fixture('<svg><use></use></svg>');
    const use = host.querySelector('use')!;
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#shape');
    const dom = new AdoptionDom(host);
    dom.expectAttribute(use, 'href', '#shape', 'http://www.w3.org/1999/xlink');
    expect(() => dom.expectAttribute(use, 'href', '#shape')).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_VALUE' }));
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#other');
    expect(() => dom.assertUnchanged()).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_VALUE' }));
  });

  it('retains authored comments that only share a marker prefix', () => {
    const { host } = fixture('<!--f:side note--><!--/f:text note-->text<!--tail-->');
    const dom = new AdoptionDom(host), cursor = dom.children();
    cursor.text('text'); cursor.finish(); dom.assertUnchanged();
    expect(host.childNodes).toHaveLength(4);
  });
});

describe('native marker occurrence ranges', () => {
  it('preserves repeated and nested same-source show ranges by opening-node identity', () => {
    const { host } = fixture('<!--f:s0--><!--f:s0-->yes<!--/f:s0--><!--/f:s0--><!--f:s0--><!--/f:s0-->');
    const dom = new AdoptionDom(host), cursor = dom.children();
    const first = cursor.range('s'), second = cursor.range('s'); cursor.finish();
    expect(first.id).toBe(second.id); expect(first.start).not.toBe(second.start);
    const outer = dom.within(first), inner = outer.range('s'); outer.finish();
    const text = dom.within(inner); text.text('yes'); text.finish(); dom.within(second).finish();
    dom.assertUnchanged();
  });

  it('scopes repeated text and list ids by actual row/range rather than numeric lookup', () => {
    const { host } = fixture('<!--f:l1--><li><!--f:t0-->A<!--/f:t0--></li><li><!--f:t0-->B<!--/f:t0--></li><!--/f:l1--><!--f:l1--><!--/f:l1-->');
    const dom = new AdoptionDom(host), cursor = dom.children();
    const first = cursor.range('l'), rows = dom.within(first);
    const a = dom.children(rows.element('li')), b = dom.children(rows.element('li'));
    expect(a.textRange('A')).not.toBe(b.textRange('B')); a.finish(); b.finish(); rows.finish();
    dom.within(cursor.range('l')).finish(); cursor.finish();
  });

  it('accepts empty show/list ranges and the native empty-text sentinel without cleaning it', () => {
    const { host } = fixture('<!--f:s2--><!--/f:s2--><!--f:l3--><!--/f:l3--><!--f:t65535-->\u200b<!--/f:t65535-->');
    const dom = new AdoptionDom(host), cursor = dom.children();
    dom.within(cursor.range('s')).finish(); dom.within(cursor.range('l')).finish();
    const text = cursor.textRange(''); cursor.finish(); dom.assertUnchanged();
    expect(text.data).toBe('\u200b');
  });

  it.each([
    ['missing close', '<!--f:s0--><b></b>'],
    ['orphan close', '<!--/f:l1-->'],
    ['duplicate close', '<!--f:s0--><!--/f:s0--><!--/f:s0-->'],
    ['crossed kind', '<!--f:s0--><!--f:l1--><!--/f:s0--><!--/f:l1-->'],
    ['crossed id', '<!--f:s0--><!--/f:s1-->'],
    ['leading zero', '<!--f:s00--><!--/f:s00-->'],
    ['out of u16 range', '<!--f:l65536--><!--/f:l65536-->'],
    ['huge integer', '<!--f:t99999999999999999999999-->x<!--/f:t99999999999999999999999-->'],
    ['cross-parent close', '<!--f:s0--><div><!--/f:s0--></div>'],
    ['absent text node', '<!--f:t0--><!--/f:t0-->'],
    ['element in text range', '<!--f:t0--><b>x</b><!--/f:t0-->'],
    ['extra content in text range', '<!--f:t0-->x<!--authored--><!--/f:t0-->'],
  ])('refuses %s without modifying the original range', (_label, html) => {
    const { host } = fixture(html), before = host.innerHTML, children = [...host.childNodes];
    expect(() => new AdoptionDom(host).children()).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_MARKER' }));
    expect(host.innerHTML).toBe(before); expect([...host.childNodes]).toEqual(children);
  });

  it('refuses an extra duplicated range by cursor exhaustion rather than forbidding legitimate repeated ids', () => {
    const { host } = fixture('<!--f:s1--><!--/f:s1--><!--f:s1--><!--/f:s1-->');
    const dom = new AdoptionDom(host), cursor = dom.children();
    dom.within(cursor.range('s')).finish();
    expect(() => cursor.finish()).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }));
  });

  it('does not publish earlier ranges when a later pair is malformed', () => {
    const { host } = fixture('<!--f:s1--><!--/f:s1--><!--f:l2-->');
    const dom = new AdoptionDom(host);
    expect(() => dom.children()).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_MARKER' }));
    expect(dom.rangeAt(host.firstChild!)).toBeUndefined();
    expect(() => dom.children()).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_MARKER' }));
  });

  it('does not reinterpret raw or separately owned nested island contents as parent marker syntax', () => {
    const { host } = fixture('<div class="raw"><!--f:t0--></div><!--f:i3--><article data-forma-island="3"><!--/f:l9--></article><!--/f:i3-->');
    const dom = new AdoptionDom(host), cursor = dom.children();
    const raw = cursor.element('div');
    dom.expectAttribute(raw, 'class', 'raw'); // The raw planner compares markup, without opening a child cursor.
    const child = dom.within(cursor.range('i')), article = child.element('article'); child.finish(); cursor.finish();
    expect(() => dom.children(article)).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }));
    article.appendChild(host.ownerDocument.createTextNode('independent child update'));
    dom.assertUnchanged();
    // The same malformed marker cannot pass when it belongs to this island's visited tree.
    expect(() => dom.children(raw)).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_MARKER' }));
  });

  it('refuses borrowing a range or element from another snapshot', () => {
    const a = fixture('<!--f:s0--><!--/f:s0-->'), b = fixture('<!--f:s0--><!--/f:s0-->');
    const first = new AdoptionDom(a.host), second = new AdoptionDom(b.host);
    const range = first.children().range('s');
    expect(() => second.within(range)).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }));
    expect(() => second.expectAttribute(a.host, 'class', null)).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }));
    expect(() => second.expectElement(a.host, 'section')).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_NODE' }));
  });
});

describe('final exact DOM observation recheck', () => {
  it.each([
    ['removed host', (host: Element, _other: Element) => host.remove()],
    ['connected reparenting', (host: Element, other: Element) => other.appendChild(host)],
    ['connected ancestor reparenting', (host: Element, other: Element) => other.appendChild(host.parentNode!)],
    ['replaced equivalent child', (host: Element, _other: Element) => (host.firstChild! as ChildNode).replaceWith(host.firstChild!.cloneNode(true))],
    ['inserted first child', (host: Element, _other: Element) => host.prepend('extra')],
    ['inserted last child', (host: Element, _other: Element) => host.append('extra')],
    ['reordered children', (host: Element, _other: Element) => host.prepend(host.lastChild!)],
  ])('refuses %s even if document membership alone would pass', (_label, change) => {
    const { host, other } = fixture('<b>A</b><i>B</i>');
    const dom = new AdoptionDom(host); change(host, other);
    expect(() => dom.assertUnchanged()).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }));
  });

  it.each([
    ['text', (host: Element) => { host.querySelector('b')!.firstChild!.nodeValue = 'changed'; }],
    ['marker', (host: Element) => { (host.firstChild as Comment).data = 'f:s2'; }],
    ['attribute', (host: Element) => { host.querySelector('b')!.setAttribute('title', 'changed'); }],
    ['new attribute', (host: Element) => { host.querySelector('b')!.setAttribute('class', 'added'); }],
    ['removed attribute', (host: Element) => { host.querySelector('b')!.removeAttribute('title'); }],
  ])('refuses changed %s while retaining all node identities', (_label, change) => {
    const { host } = fixture('<!--f:s0--><b title="original">A</b><!--/f:s0-->');
    const dom = new AdoptionDom(host); change(host);
    expect(() => dom.assertUnchanged()).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_VALUE' }));
  });

  it('detects children inserted into an originally empty observed element', () => {
    const { host } = fixture('<b></b>'); const dom = new AdoptionDom(host);
    host.firstChild!.appendChild(host.ownerDocument.createTextNode('later'));
    expect(() => dom.assertUnchanged()).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }));
  });

  it('refuses initial detached or shadow-root targets without acquiring ownership', () => {
    const { doc, host } = fixture('original'); host.remove();
    expect(() => new AdoptionDom(host)).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }));
    const parent = doc.createElement('div'); doc.body.append(parent);
    parent.attachShadow({ mode: 'open' }).append(host);
    expect(host.isConnected).toBe(true);
    expect(() => new AdoptionDom(host)).toThrowError(expect.objectContaining({ code: 'FORMA_E_HYDRATE_STRUCTURE' }));
  });

  it('validates a deep static tree iteratively without imposing a control-flow depth limit', () => {
    const { host, doc } = fixture(''); let parent: Element = host;
    for (let index = 0; index < 300; index++) { const child = doc.createElement('div'); parent.append(child); parent = child; }
    parent.append('leaf');
    const dom = new AdoptionDom(host); let cursor = dom.children();
    for (let index = 0; index < 300; index++) { const child = cursor.element('div'); cursor.finish(); cursor = dom.children(child); }
    cursor.text('leaf'); cursor.finish(); expect(() => dom.assertUnchanged()).not.toThrow();
  });
});

describe('inert template content snapshots',()=>{
  it('retains template fragment identities without interpreting raw marker-like comments',async()=>{
    const {host}=fixture('<template><b data-forma-island="raw">kept<!--f:s0--></b><template><i>inner</i></template></template>');
    const template=host.firstElementChild as HTMLTemplateElement,fragment=template.content,original=[...fragment.childNodes];
    const records:MutationRecord[]=[],observer=new MutationObserver(batch=>records.push(...batch));
    observer.observe(fragment,{subtree:true,childList:true,characterData:true,attributes:true});
    const dom=new AdoptionDom(host),cursor=dom.children();cursor.element('template');cursor.finish();dom.assertUnchanged();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(template.content).toBe(fragment);expect([...fragment.childNodes]).toEqual(original);expect(records.concat(observer.takeRecords())).toEqual([]);observer.disconnect();
  });
  it.each([
    ['text',(template:HTMLTemplateElement)=>{template.content.querySelector('b')!.firstChild!.nodeValue='changed';},'FORMA_E_HYDRATE_VALUE'],
    ['same-markup replacement',(template:HTMLTemplateElement)=>{const b=template.content.querySelector('b')!;b.replaceWith(b.cloneNode(true));},'FORMA_E_HYDRATE_STRUCTURE'],
    ['nested template text',(template:HTMLTemplateElement)=>{(template.content.querySelector('template') as HTMLTemplateElement).content.firstChild!.firstChild!.nodeValue='changed';},'FORMA_E_HYDRATE_VALUE'],
    ['inert island-looking descendants',(template:HTMLTemplateElement)=>{template.content.querySelector('b')!.append('changed');},'FORMA_E_HYDRATE_STRUCTURE'],
  ] as const)('refuses changed %s captured before component execution',(_name,change,code)=>{
    const {host}=fixture('<template><b data-forma-island="raw">kept</b><template><i>inner</i></template></template>');
    const dom=new AdoptionDom(host);change(host.firstElementChild as HTMLTemplateElement);
    expect(()=>dom.assertUnchanged()).toThrowError(expect.objectContaining({code}));
  });
  it('keeps a separately owned connected child island opaque, including its templates',()=>{
    const {host}=fixture('<article data-forma-island="1"><template><b>kept</b></template></article>');
    const dom=new AdoptionDom(host);(host.querySelector('template') as HTMLTemplateElement).content.firstChild!.textContent='changed';
    expect(()=>dom.assertUnchanged()).not.toThrow();
  });
});


describe('mixed inert and opaque snapshot traversal',()=>{
  it.each([
    ['connected opaque child',0,null],
    ['ordinary sibling',1,'FORMA_E_HYDRATE_VALUE'],
    ['inert island-looking child',2,'FORMA_E_HYDRATE_VALUE'],
    ['nested template child',3,'FORMA_E_HYDRATE_VALUE'],
  ] as const)('keeps %s ownership while interleaving both traversal states',(_label,index,code)=>{
    const {host}=fixture('<template><b data-forma-island="inert">inert</b><template><i>deep</i></template></template><article data-forma-island="connected"><em>opaque</em></article><p>owned</p>');
    const template=host.firstElementChild as HTMLTemplateElement;
    const nested=template.content.querySelector('template') as HTMLTemplateElement;
    const targets=[host.querySelector('em')!.firstChild!,host.querySelector('p')!.firstChild!,template.content.querySelector('b')!.firstChild!,nested.content.querySelector('i')!.firstChild!];
    const dom=new AdoptionDom(host);dom.assertUnchanged();
    targets[index].nodeValue='changed';
    if(code)expect(()=>dom.assertUnchanged()).toThrowError(expect.objectContaining({code}));
    else expect(()=>dom.assertUnchanged()).not.toThrow();
  });
});
