// Prospective laboratory-1 semantic validation. Encoded response bytes are retained unchanged.
import assert from 'node:assert/strict';
import { ALLOWED_ROWS, expected, rows, money } from '../shared/dataset.mjs';

const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const rawTextTags = new Set(['script','style','textarea','title','xmp','iframe','noembed','noframes']);
const inertTags = new Set([...rawTextTags,'template','noscript']);
const entities = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:'\u00a0', dollar:'$' };
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, entity) => {
    if (!entity.startsWith('#')) return entities[entity] ?? all;
    const number = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    assert(number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff), 'invalid HTML character reference');
    return String.fromCodePoint(number);
  });
}
function attributes(source) {
  const result = {};
  const matcher = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(matcher)) {
    const key = match[1].toLowerCase();
    assert(!Object.hasOwn(result, key), `duplicate HTML attribute: ${key}`);
    result[key] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}
const normalized = text => decode(text).replace(/\s+/g, ' ').trim();

// A deliberately small validator for the committed six-cell table contract,
// not a general HTML renderer. Tags in comments, scripts and inert templates
// cannot stand in for server-rendered rows; framework marker comments are free.
export function assertSSRPage(count, html) {
  assert(ALLOWED_ROWS.includes(count), 'SSR row workload is not registered');
  assert.equal(typeof html, 'string');
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+|</g) ?? [];
  const stack = [], rendered = []; let row = null, cell = null, visibleText = '';
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    const tag = token.match(/^<(\/)?([a-z][a-z0-9:-]*)\b([\s\S]*?)>$/i);
    const inert = stack.some(element => element.inert);
    if (!tag) {
      if (!inert) { visibleText += token; if (cell) cell.text += token; }
      continue;
    }
    const closing = Boolean(tag[1]), name = tag[2].toLowerCase();
    // Raw script/style text can contain apparent opening tags. Only the matching
    // end tag ends a raw-text element; it never enters the semantic tree.
    const raw = stack.at(-1);
    if (raw && rawTextTags.has(raw.name) && !(closing && name === raw.name)) continue;
    if (closing) {
      const index = stack.findLastIndex(element => element.name === name);
      if (index < 0) continue;
      if (!inert && name === 'td' && cell) { row.cells.push(normalized(cell.text)); cell = null; }
      if (!inert && name === 'tr' && row) { if (cell) throw Error('SSR cell is not closed'); rendered.push(row); row = null; }
      stack.splice(index);
      continue;
    }
    const attrs = attributes(tag[3]);
    const hidden = stack.some(element => element.hidden) || Object.hasOwn(attrs, 'hidden') || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style ?? '');
    const element = { name, hidden, inert: inert || inertTags.has(name) };
    if (!element.inert && name === 'tr') {
      assert(!row, 'nested SSR rows are invalid');
      const inBody = stack.some(element => element.name === 'tbody');
      if (Object.hasOwn(attrs, 'data-id') || inBody) {
        assert(stack.some(element => element.name === 'table'), 'SSR rows must belong to a table');
        assert(!hidden, 'SSR rows must be visible');
        assert(Object.hasOwn(attrs, 'data-id'), 'SSR data row is missing its ID');
        row = { id: attrs['data-id'], cells: [] };
      }
    }
    if (!element.inert && name === 'td' && row) {
      assert(!cell && stack.at(-1)?.name === 'tr', 'SSR cells must be direct row children');
      assert(!hidden, 'SSR cells must be visible'); cell = { text: '' };
    } else if (!element.inert && cell) {
      assert(!hidden, 'SSR cell text must be visible');
      assert.equal(name, 'span', 'SSR cell contains unexpected markup');
    }
    if (!voidTags.has(name) && !/\/\s*>$/.test(token)) stack.push(element);
  }
  assert(!row && !cell, 'unclosed SSR rows or cells');
  assert.equal(rendered.length, count, 'SSR row count differs');
  const wanted = rows(count);
  for (let index = 0; index < count; index++) {
    const r = wanted[index];
    assert.equal(rendered[index].id, String(r.id), `SSR ordered row ID differs at row ${index + 1}`);
    assert.deepEqual(rendered[index].cells, [String(r.id), r.label, r.owner, money(r.amount), r.status, r.updated], `SSR cells differ at row ${index + 1}`);
  }
  for (const item of expected(count).mustContain) assert(normalized(visibleText).includes(item), `SSR data missing: ${item}`);
  return { rowCount: rendered.length, contract: 'laboratory-1-rows-v1' };
}
