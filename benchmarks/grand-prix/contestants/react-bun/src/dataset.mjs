// The Grand Prix dataset and page model. Every contestant ports this exactly (same rows, same
// arithmetic, same formatting algorithm, no Intl), so every server does the same work per request.
// Rust contestants port it line for line; the harness checks the output against expected().

export const ADJ = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain',
  'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly',
  'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
export const COLOR = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white',
  'black', 'orange'];
export const NOUN = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich',
  'burger', 'pizza', 'mouse', 'keyboard'];
export const OWNERS = ['maya', 'sarah', 'jordan', 'ops', 'finance'];
export const ALLOWED_ROWS = [10, 100, 1000];

export function rows(n) {
  const out = new Array(n);
  for (let i = 1; i <= n; i++) {
    out[i - 1] = {
      id: i,
      label: ADJ[(i * 7) % ADJ.length] + ' ' + COLOR[(i * 11) % COLOR.length] + ' ' + NOUN[(i * 13) % NOUN.length],
      owner: OWNERS[i % OWNERS.length],
      amount: (i * 7919) % 100000,          // integer cents
      status: i % 3 === 0 ? 'closed' : 'open',
      updated: '2026-10-' + String((i % 28) + 1).padStart(2, '0'),
    };
  }
  return out;
}

export function summary(list) {
  let total = 0, open = 0;
  for (const r of list) { total += r.amount; if (r.status === 'open') open++; }
  return { count: list.length, open, total, average: list.length ? Math.floor(total / list.length) : 0 };
}

// $1,234.56 from integer cents, no Intl: thousands separators by hand.
export function money(cents) {
  const dollars = Math.floor(cents / 100);
  const c = String(cents % 100).padStart(2, '0');
  let s = String(dollars), out = '';
  while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
  return '$' + s + out + '.' + c;
}

// What the harness expects in every response for n rows: these strings must all appear, and the
// body must hold exactly n occurrences of `<tr data-id=` (attribute quoting may vary).
export function expected(n) {
  const s = summary(rows(n));
  return { rowCount: n, mustContain: ['Dashboard', money(s.total), money(s.average), String(s.open)] };
}
