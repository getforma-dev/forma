/** Runs inside the real page; never evaluates source outside Forma's parser. */
export async function runBrowserCase(input) {
  const runtime = window.FormaRuntime;
  const root = document.getElementById('root');
  const attr = text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const binding = source => attr(`{${source}}`);
  const eq = (actual, expected, label) => {
    if (actual !== expected) throw new Error(`${input.id} ${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  };
  const node = () => root.querySelector('#out');
  runtime.clearDiagnostics();
  localStorage.clear();
  window.__hostileExec = 0;
  window.__outsideReads = 0;
  const state = { value: input.payload, result: 'untouched', items: [1], rows: [{ id: 'row', value: input.payload }] };
  let extra = '';
  let markup;
  const p = source => `<p id="out" data-text="${binding(source)}">untouched</p>`;
  if (input.kind === 'value') {
    switch (input.context) {
      case 'state': markup = '<p id="out">state witness</p>'; break;
      case 'text': markup = p('value'); break;
      case 'computed': extra = ` data-computed="derived = value"`; markup = p('derived'); break;
      case 'show': markup = `<p id="out" data-show="{value.length === 0}">bound</p>`; break;
      case 'if': markup = `<p id="out" data-if="{value.length === 0}">must be removed</p>`; break;
      case 'model': markup = '<textarea id="out" data-model="{value}"></textarea>'; break;
      case 'class': markup = '<p id="out" data-class:active="{value.length > 0}">bound</p>'; break;
      case 'attribute': markup = '<p id="out" data-bind:title="{value}">bound</p>'; break;
      case 'event': markup = '<button id="trigger" data-on:click="{result = value}">run</button>' + p('result'); break;
      case 'list-text': markup = '<ul data-list="{rows}"><li id="out">{item.value}</li></ul>'; break;
      case 'list-attribute': markup = '<ul data-list="{rows}"><li id="out" title="{item.value}">bound</li></ul>'; break;
      case 'list-property': markup = '<ul data-list="{rows}"><li><textarea id="out" data-model="{item.value}"></textarea></li></ul>'; break;
      case 'persist': markup = '<p data-persist="{value}"></p>' + p('value'); break;
      case 'ref': markup = '<textarea data-ref="source" data-model="{value}"></textarea>' + p('$refs.source.value'); break;
      case 'srcdoc': markup = '<iframe id="out" data-bind:srcdoc="{value}"></iframe>' + p('value').replace('id="out"', 'id="proof"'); break;
      case 'url': markup = '<a id="out" data-bind:href="{value}">link</a>'; break;
      case 'form-action': markup = '<form id="out" data-bind:action="{value}"></form>'; break;
      case 'image-src': markup = '<img id="out" data-bind:src="{value}">'; break;
      case 'svg-xlink': markup = '<svg><a id="out" data-bind:xlink:href="{value}">svg link</a></svg>'; break;
      default: throw new Error('unknown value context');
    }
  } else if (input.kind === 'expression') {
    const expression = input.payload;
    switch (input.context) {
      case 'computed': extra = ` data-computed="derived = ${attr(expression)}"`;
        // Compiler/validator refusals leave no getter. Runtime refusals must
        // still be reached through a live lazy-computed consumer.
        markup = input.compileRefusal ? '<p id="out">computed compile refusal</p>' : p('derived'); break;
      case 'text': markup = p(expression); break;
      case 'show': markup = `<p id="out" data-show="${binding(expression)}">untouched</p>`; break;
      case 'if': markup = `<p id="out" data-if="${binding(expression)}">untouched</p>`; break;
      case 'class': markup = `<p id="out" data-class:active="${binding(expression)}">untouched</p>`; break;
      case 'attribute': markup = `<p id="out" data-bind:title="${binding(expression)}">untouched</p>`; break;
      case 'event': markup = `<button id="trigger" data-on:click="${binding(`result = ${expression}`)}">run</button>` + p('result'); break;
      case 'list': markup = `<ul id="out" data-list="${binding(expression)}"><li>row</li></ul>`; break;
      case 'list-row-text': markup = `<ul data-list="{rows}"><li id="out" data-text="${binding(expression)}">untouched</li></ul>`; break;
      case 'list-row-attribute': markup = `<ul data-list="{rows}"><li id="out" data-bind:title="${binding(expression)}">untouched</li></ul>`; break;
      default: throw new Error('unknown expression context');
    }
  } else if (input.kind === 'fetch') markup = `<div id="out" data-fetch="${attr(`GET ${input.payload} → fetched |error:failed`)}"></div>` + p('failed').replace('id="out"', 'id="fetch-error"');
  else if (input.kind === 'markup') markup = input.payload;
  else throw new Error('unknown hostile case kind');
  markup = `<div data-forma-state="${attr(JSON.stringify(state))}"${extra}><p id="alive" data-text="{1 + 2}">unbound</p>${markup}</div>`;
  const grants = input.profile === 'all' ? { dom: true, navigate: true, fetch: { methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], paths: ['/'], cookies: true } }
    : input.profile === 'typical' ? { fetch: { methods: ['GET'], paths: ['/api/widget/'], cookies: false } } : {};
  window.__observeHostile = true;
  const handle = runtime.mountMarkup(root, runtime.trustedHtml(markup), { tier: 'reviewed', grants });
  try {
    root.querySelector('#trigger')?.click();
    // Let real image/SVG/parser events run while the mounted tree is retained.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    eq(root.querySelector('#alive')?.textContent, '3', 'live mount control');
    if (input.kind === 'expression' && input.context === 'computed') {
      eq(typeof root.firstElementChild.__formaScope.getters.derived, input.compileRefusal ? 'undefined' : 'function', 'computed getter phase');
    }
    const codes = runtime.getDiagnostics().map(item => item.code);
    const expectedCode = input.kind === 'expression' ? input.code : input.kind === 'fetch' ? 'FORMA_E_GRANT_FETCH' : input.kind === 'value' && input.context === 'srcdoc' ? 'FORMA_E_RUNTIME_SRCDOC' : null;
    if (expectedCode ? codes.length === 0 || codes.some(code => code !== expectedCode) : codes.length !== 0) {
      throw new Error(`${input.id}: expected only ${expectedCode ?? 'no diagnostics'}, actual ${JSON.stringify(codes)}`);
    }
    if (input.kind === 'fetch') {
      eq(node().getAttribute('data-fetch'), `GET ${input.payload} → fetched |error:failed`, 'fetch payload bytes');
      if (!codes.includes('FORMA_E_GRANT_FETCH')) throw new Error(`${input.id}: missing fetch refusal: ${codes}`);
      if (!root.querySelector('#fetch-error').textContent.startsWith('data-fetch denied:')) throw new Error(`${input.id}: fetch error target was not bound`);
    } else if (input.kind === 'expression') {
      if (!codes.includes(input.code)) throw new Error(`${input.id}: expected ${input.code}, actual ${JSON.stringify(codes)}`);
    } else if (input.kind === 'value') {
      if (input.context === 'srcdoc') {
        eq(node().hasAttribute('srcdoc'), false, 'srcdoc refused');
        eq(root.querySelector('#proof').textContent, input.payload, 'same bytes inert text');
        if (!codes.includes('FORMA_E_RUNTIME_SRCDOC')) throw new Error(`missing srcdoc refusal: ${codes}`);
      } else if (['url', 'form-action', 'image-src', 'svg-xlink'].includes(input.context)) {
        const name = { url: 'href', 'form-action': 'action', 'image-src': 'src', 'svg-xlink': 'xlink:href' }[input.context];
        eq(node().getAttribute(name), input.dangerousUrl ? null : input.payload, 'URL guard');
      } else {
        if (codes.length) throw new Error(`${input.id}: unexpected diagnostics ${JSON.stringify(runtime.getDiagnostics())}`);
        switch (input.context) {
          case 'state': eq(root.firstElementChild.__formaScope.getters.value(), input.payload, 'parsed state value'); break;
          case 'if': eq(node(), null, 'if removed its false branch'); break;
          case 'show': eq(node().style.display, 'none', 'show bound'); break;
          case 'class': eq(node().classList.contains('active'), true, 'class bound'); break;
          case 'model': case 'list-property': eq(node().value, input.payload, 'model value'); break;
          case 'attribute': case 'list-attribute': eq(node().getAttribute('title'), input.payload, 'attribute value'); break;
          case 'persist': eq(localStorage.getItem('forma:value'), JSON.stringify(input.payload), 'persist actually wrote'); eq(node().textContent, input.payload, 'persist value'); break;
          default: eq(node()?.textContent, input.payload, 'inert payload value');
        }
      }
    }
    eq(window.__hostileExec, 0, 'unauthorized execution');
    eq(window.__outsideReads, 0, 'unauthorized outside-root read');
    eq(Object.prototype.polluted, undefined, 'prototype remains clean');
    return { id: input.id, codes, executed: window.__hostileExec, outsideReads: window.__outsideReads, live: true, nodes: root.querySelectorAll('*').length };
  } finally { window.__observeHostile = false; handle.unmount(); }
}
