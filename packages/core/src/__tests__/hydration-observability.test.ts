/** Fixed expected markup checked against ordinary CSR and read-only prepared adoption. */
import { describe, it, expect } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { h, createShow } from 'forma/dom';
import { withAdoptionDescription, type HydrationDescriptor, type ShowDescriptor } from '../dom/adoption-description';
import { prepareAdoption } from '../dom/adoption';

function normalizeHtml(html: string): string {
  return html.replace(/<!--\/?f:[tsli]\d+-->/g, '').replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();
}
function renderClient(component: () => unknown): string {
  return createRoot(dispose => {
    try {
      const node = component();
      expect(node).toBeInstanceOf(Node);
      const container = document.createElement('div'); container.appendChild(node as Node);
      return normalizeHtml(container.innerHTML);
    } finally { dispose(); }
  });
}

const CASES: Array<[name: string, component: () => unknown, html: string]> = [
  [
    'static element tree',
    () => h('div', { class: 'container' }, h('h1', null, 'Title'), h('p', null, 'Description')),
    '<div class="container"><h1>Title</h1><p>Description</p></div>',
  ],
  [
    'element with static props',
    () => h('form', { class: 'login-form', method: 'post' },
      h('input', { type: 'email', placeholder: 'Email' }),
      h('input', { type: 'password', placeholder: 'Password' }),
      h('button', { type: 'submit', class: 'btn primary' }, 'Login'),
    ),
    '<form class="login-form" method="post"><input type="email" placeholder="Email">'
    + '<input type="password" placeholder="Password">'
    + '<button type="submit" class="btn primary">Login</button></form>',
  ],
  [
    'nested elements with mixed children',
    () => h('div', { class: 'card' },
      h('div', { class: 'card-header' }, h('h2', null, 'Card Title'), h('span', { class: 'badge' }, 'Active')),
      h('div', { class: 'card-body' }, h('p', null, 'Some content here'),
        h('ul', null, h('li', null, 'Item 1'), h('li', null, 'Item 2'))),
    ),
    '<div class="card"><div class="card-header"><h2>Card Title</h2>'
    + '<span class="badge">Active</span></div><div class="card-body">'
    + '<p>Some content here</p><ul><li>Item 1</li><li>Item 2</li></ul></div></div>',
  ],
  [
    'void elements (input, br)',
    () => h('form', null,
      h('input', { type: 'text', name: 'email' }),
      h('br', null),
      h('input', { type: 'password', name: 'password' }),
    ),
    '<form><input type="text" name="email"><br><input type="password" name="password"></form>',
  ],
  ['empty elements', () => h('div', { class: 'toast' }), '<div class="toast"></div>'],
  [
    'SVG elements keep their case-sensitive attribute names',
    () => h('svg', { viewBox: '0 0 24 24', fill: 'none' },
      h('path', { d: 'M12 2L2 22h20L12 2z', stroke: 'currentColor' })),
    '<svg viewBox="0 0 24 24" fill="none">'
    + '<path d="M12 2L2 22h20L12 2z" stroke="currentColor"></path></svg>',
  ],
  [
    'deeply nested elements',
    () => h('section', { class: 'page' },
      h('nav', { class: 'sidebar' }, h('ul', null,
        h('li', null, h('a', { href: '/home' }, 'Home')),
        h('li', null, h('a', { href: '/about' }, 'About')))),
      h('main', { class: 'content' }, h('article', null,
        h('h1', null, 'Article Title'),
        h('p', null, 'First paragraph.'),
        h('p', null, 'Second paragraph.'))),
    ),
    '<section class="page"><nav class="sidebar"><ul><li><a href="/home">Home</a></li>'
    + '<li><a href="/about">About</a></li></ul></nav><main class="content"><article>'
    + '<h1>Article Title</h1><p>First paragraph.</p><p>Second paragraph.</p></article></main></section>',
  ],
  [
    'element with data attributes',
    () => h('div', { 'data-testid': 'my-widget', 'data-value': '42', 'data-active': 'true' }, 'content'),
    '<div data-testid="my-widget" data-value="42" data-active="true">content</div>',
  ],
  [
    'element with aria attributes',
    () => h('button', { type: 'button', 'aria-label': 'Close dialog', 'aria-expanded': 'false', role: 'button' }, 'X'),
    '<button type="button" aria-label="Close dialog" aria-expanded="false" role="button">X</button>',
  ],
  [
    'reactive text signal',
    () => {
      const [name] = createSignal('World');
      return h('div', null, h('span', null, 'Hello, '), h('span', null, name));
    },
    '<div><span>Hello, </span><span>World</span></div>',
  ],
  [
    'multiple reactive signals in one tree',
    () => {
      const [firstName] = createSignal('Jane');
      const [lastName] = createSignal('Doe');
      return h('div', { class: 'profile' },
        h('span', { class: 'first' }, firstName),
        h('span', { class: 'sep' }, ' '),
        h('span', { class: 'last' }, lastName));
    },
    '<div class="profile"><span class="first">Jane</span><span class="sep"> </span>'
    + '<span class="last">Doe</span></div>',
  ],
];


describe('Hydration Observability: fixed CSR and adoption markup', () => {
  it.each(CASES)('%s', async (name, component, expected) => {
    expect(renderClient(component)).toBe(expected);
    let server = expected;
    if (name === 'reactive text signal') server = expected.replace('<span>World</span>', '<span><!--f:t0-->World<!--/f:t0--></span>');
    if (name === 'multiple reactive signals in one tree') server = expected.replace('>Jane<', '><!--f:t0-->Jane<!--/f:t0--><').replace('>Doe<', '><!--f:t1-->Doe<!--/f:t1--><');
    const doc = document.implementation.createHTMLDocument(); doc.body.innerHTML = server;
    const host = doc.body.firstElementChild!, nodes: Node[] = [];
    const cursor = doc.createTreeWalker(host); for (let node = cursor.nextNode(); node; node = cursor.nextNode()) nodes.push(node);
    const mutations: MutationRecord[] = [], observer = new MutationObserver(batch => mutations.push(...batch));
    observer.observe(host, { childList: true, attributes: true, characterData: true, subtree: true });
    const plan = prepareAdoption(host, component);
    try {
      plan.commit(); await new Promise(resolve => setTimeout(resolve, 0));
      expect(normalizeHtml(host.outerHTML)).toBe(expected);
      const after: Node[] = [], walker = doc.createTreeWalker(host); for (let node = walker.nextNode(); node; node = walker.nextNode()) after.push(node);
      expect(after).toEqual(nodes); expect(mutations.concat(observer.takeRecords())).toEqual([]);
      host.setAttribute('data-observer-control', 'yes'); await new Promise(resolve => setTimeout(resolve, 0));
      expect(mutations.concat(observer.takeRecords()).length).toBeGreaterThan(0);
    } finally { observer.disconnect(); plan.dispose(); }
  });
});

describe('Hydration Observability: conditional descriptions', () => {
  it.each([true, false])('pins the selected branch for visible=%s in CSR and prepared adoption', visible => {
    const branch = visible ? '<div class="content">Visible</div>' : '<div class="placeholder">Hidden</div>';
    const component = () => createShow(() => visible, () => h('div', { class: 'content' }, 'Visible'), () => h('div', { class: 'placeholder' }, 'Hidden'));
    expect(renderClient(component)).toBe('<!--forma-show-->' + branch + '<!--/forma-show-->');
    const doc = document.implementation.createHTMLDocument(); doc.body.innerHTML = '<section><!--f:s0-->' + branch + '<!--/f:s0--></section>';
    const host = doc.body.firstElementChild!, old = host.querySelector('div');
    const plan = prepareAdoption(host, () => h('section', null, component()));
    plan.commit(); expect(host.querySelector('div')).toBe(old); expect(normalizeHtml(host.innerHTML)).toBe(branch); plan.dispose();
  });
  it('createShow describes its thunks without evaluating the condition or branches', () => {
    let reads = 0;
    const result = withAdoptionDescription(() => createShow(() => { reads++; return true; }, () => { reads++; return h('div', null, 'yes'); })) as unknown as ShowDescriptor;
    expect(result.type).toBe('show'); expect(result).not.toBeInstanceOf(Node); expect(reads).toBe(0);
    expect(result).not.toHaveProperty('initialBranch');
  });
  it('h() describes the exact element props and children without allocating a DOM element', () => {
    const result = withAdoptionDescription(() => h('div', { class: 'test' }, 'hello')) as unknown as HydrationDescriptor;
    expect(result).toEqual({ type: 'element', tag: 'div', props: { class: 'test' }, children: ['hello'] });
    expect(result).not.toBeInstanceOf(Element);
  });
});
