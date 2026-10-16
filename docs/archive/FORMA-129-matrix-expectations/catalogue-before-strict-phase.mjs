/** Literal payloads. Adapters escape only the containing HTML/JSON grammar;
 * they do not sanitize or rewrite these values. Raw markup has its own lane. */
export const valuePayloads = [
  ['script', '<script>window.__hostileExec++</script>'],
  ['script-close', '</script><script>window.__hostileExec++</script>'],
  ['image-handler', '<img src="/attack/image" onerror="window.__hostileExec++">'],
  ['svg-handler', '<svg onload="window.__hostileExec++"><text>x</text></svg>'],
  ['math-parser', '<math><mtext><table><mglyph><style><!--</style><img src="/attack/math" onerror="window.__hostileExec++">'],
  ['quote-breakout', '\"><img src=/attack/quote onerror=window.__hostileExec++>'],
  ['single-quote', "'><svg onload=window.__hostileExec++>"],
  ['template-expression', '${window.__hostileExec++}'],
  ['braces-expression', '{window.__hostileExec++}'],
  ['javascript', 'javascript:window.__hostileExec++'],
  ['mixed-scheme', 'JaVaScRiPt:window.__hostileExec++'],
  ['tab-scheme', 'java\tscript:window.__hostileExec++'],
  ['newline-scheme', 'java\nscript:window.__hostileExec++'],
  ['control-prefix', '\u0001javascript:window.__hostileExec++'],
  ['entity-scheme', '&#106;avascript:window.__hostileExec++'],
  ['data-document', 'data:text/html,<script>window.__hostileExec++</script>'],
  ['svg-data', 'data:image/svg+xml,<svg onload="window.__hostileExec++"/>'],
  ['vbscript', 'vbscript:msgbox(1)'],
  ['prototype-json', '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'],
  ['selector-secret', '[data-secret^="secret-"] span'],
  ['constructor-text', "({}).constructor.constructor('window.__hostileExec++')()"],
  ['nul-markup', '<img\u0000src=/attack/nul onerror=window.__hostileExec++>'],
];

export const expressionPayloads = [
  ['constructor', 'items.constructor', 'FORMA_E_KEY_DENIED'],
  ['computed-constructor', "items['cons' + 'tructor']", 'FORMA_E_KEY_DENIED'],
  ['prototype', 'items.__proto__', 'FORMA_E_KEY_DENIED'],
  ['chain', "({}).constructor.constructor('window.__hostileExec++')()", 'FORMA_E_KEY_DENIED'],
  ['map-constructor', 'items.map(x => x).constructor', 'FORMA_E_KEY_DENIED'],
  ['callback-constructor', 'items.map(x => x.constructor)', 'FORMA_E_KEY_DENIED'],
  ['window', 'window.__hostileExec', 'FORMA_E_UNRESOLVED'],
  ['global', 'globalThis.__hostileExec', 'FORMA_E_UNRESOLVED'],
  ['document', "document.querySelector('[data-secret]')", 'FORMA_E_UNRESOLVED'],
  ['function', "Function('window.__hostileExec++')()", 'FORMA_E_CALL_DENIED'],
  ['eval', "eval('window.__hostileExec++')", 'FORMA_E_UNRESOLVED'],
  ['dynamic-import', "import('/attack/module')", 'FORMA_E_UNRESOLVED'],
  ['arrow-block', 'items.map(x => { return x; })', 'FORMA_E_UNSUPPORTED'],
];

export const valueContexts = ['state', 'computed', 'text', 'show', 'if', 'model', 'class', 'attribute', 'event', 'list-text', 'list-attribute', 'list-property', 'persist', 'ref', 'srcdoc', 'url', 'form-action', 'image-src', 'svg-xlink'];
// data-model/data-persist accept assignable state/member paths, not arbitrary
// expression programs. Every literal payload still runs through their live
// value path; inventing an expression position there would create inert tests.
export const expressionContexts = ['computed', 'text', 'show', 'if', 'class', 'attribute', 'event', 'list', 'list-row-text', 'list-row-attribute'];
export const profiles = ['none', 'typical', 'all'];

export function cases() {
  const out = [];
  for (const profile of profiles) {
    for (const [id, payload] of valuePayloads) for (const context of valueContexts) out.push({ id: `value/${id}/${context}/${profile}`, kind: 'value', payload, context, profile,
      // Existing INV1 contract: SVG data is inert in an image sink, while a
      // NUL is refused in every URL sink. Keep this oracle explicit here.
      dangerousUrl: ['javascript', 'mixed-scheme', 'tab-scheme', 'newline-scheme', 'control-prefix', 'data-document', 'vbscript', 'nul-markup'].includes(id) || id === 'svg-data' && context !== 'image-src' });
    // data-fetch parses a URL mini-DSL, not expressions. Exercise every
    // hostile executable/document scheme there without inventing inert syntax.
    // Its anchored URL mini-DSL does not admit embedded newlines; that payload
    // remains covered in all19 live value contexts instead of counting a no-op.
    for (const [id, payload] of valuePayloads.filter(([id]) => ['javascript', 'mixed-scheme', 'tab-scheme', 'control-prefix', 'data-document', 'svg-data', 'vbscript'].includes(id))) out.push({ id: `fetch/${id}/${profile}`, kind: 'fetch', context: 'fetch-url', payload, profile });
    for (const [id, payload, code] of expressionPayloads) for (const context of expressionContexts) out.push({ id: `expression/${id}/${context}/${profile}`, kind: 'expression', payload, code, context, profile });
    for (const [id, payload] of valuePayloads.filter(([id]) => ['script', 'script-close', 'image-handler', 'svg-handler', 'math-parser', 'quote-breakout', 'single-quote'].includes(id))) out.push({ id: `markup/${id}/${profile}`, kind: 'markup', payload, profile });
  }
  if (new Set(out.map(item => item.id)).size !== out.length) throw new Error('duplicate hostile case id');
  return out;
}
