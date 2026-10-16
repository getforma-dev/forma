/**
 * FORMA-182 rule 6's attribute table, the compiled side (findings F2 and F3):
 * a static `true` is bare on an HTML boolean attribute and the word "true" on
 * any other; a reactive boolean lands in a TYPE_BOOL slot, which the walker
 * writes by the same rule; an attribute whose server value is the empty string
 * is written as a static `name=""` (a client slot cannot hold an empty
 * default), where it used to be dropped. The walker, core and the three-engine
 * replay read the same file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, emitDeclaredPage, readVectors } from './helpers/value-rules';
import { renderDefaults } from './helpers/render';
import { HTML_BOOLEAN_ATTRIBUTES } from '../src/value-rules';

interface CompiledVector { id: string; tag?: string; setup?: string; attribute: string; value: string; dom: string | null }
const table = readVectors<{ booleanAttributes: string[]; compiled: CompiledVector[] }>('attributes.json');
afterEach(cleanup);

const head = `import { h, createSignal } from '@getforma/core';\n`;
function page(tag: string, attribute: string, value: string, setup = ''): string {
  const element = tag === 'input' ? `h('input', { id: 'ok', '${attribute}': ${value} })` : `h('${tag}', { id: 'ok', '${attribute}': ${value} }, 'x')`;
  return `${head}${setup}\nexport function Page(props: {}) { return h('main', null, ${element}); }`;
}
/** The attribute's value on the element with id "ok" in the rendered HTML: '' when bare, null when absent. */
function attributeOf(html: string, attribute: string): string | null {
  const tag = /<\w+ id="ok"([^>]*)>/.exec(html)?.[1] ?? '';
  const name = attribute.replace(/[-]/g, '\\-');
  const match = new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s>]|$)`).exec(tag);
  return match ? (match[1] ?? '') : null;
}

describe('rule 6 attribute table: what the compiled page serves', () => {
  it.each(table.compiled)('$id: $attribute reads $dom', ({ tag = 'p', setup, attribute, value, dom }) => {
    const { binary, codes } = emitDeclaredPage(page(tag, attribute, value, setup));
    expect(codes).toEqual([]);
    expect(attributeOf(renderDefaults(binary, { stripMarkers: true }), attribute)).toBe(dom);
  });

  it('the compiler\'s HTML boolean set is the shared one', () => {
    expect([...HTML_BOOLEAN_ATTRIBUTES].sort()).toEqual([...table.booleanAttributes].sort());
  });

  it.each(table.booleanAttributes)('%s: a static true is bare; its data- twin is the word', name => {
    for (const [attribute, dom] of [[name, ''], [`data-${name}`, 'true']] as const) {
      const { binary } = emitDeclaredPage(page('p', attribute, 'true'));
      expect(attributeOf(renderDefaults(binary, { stripMarkers: true }), attribute), attribute).toBe(dom);
    }
  });
});
