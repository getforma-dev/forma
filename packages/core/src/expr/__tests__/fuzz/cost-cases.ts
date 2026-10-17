/**
 * Independent minimum-charge cases for the DR-16 table. This file imports no
 * interpreter, COSTS, weigh or production budget constants. Each case describes
 * one known native call on bounded data and the table's documented row floor;
 * argument conversion and interpreter/callback work may charge more.
 *
 * Keep every row explicit: an inventory assertion may compare these names to
 * production, but the numerical oracle must still detect a removed cost row
 * when that inventory assertion is deliberately bypassed by the mutation run.
 */
export const COST_OPERATIONS = [
  'array.filter', 'array.flatMap', 'array.map', 'array.reverse', 'array.slice',
  'string.concat', 'string.endsWith', 'string.slice', 'string.startsWith',
  'string.substring', 'string.includes', 'string.indexOf', 'string.lastIndexOf',
  'string.trim', 'string.trimEnd', 'string.trimStart', 'string.toLowerCase',
  'string.toUpperCase', 'array.includes', 'array.indexOf', 'array.lastIndexOf',
  'array.every', 'array.reduce', 'array.some', 'array.concat', 'string.padEnd',
  'string.padStart', 'Object.entries', 'Object.keys', 'Object.values',
  'array.flat', 'array.join', 'array.sort', 'string.repeat', 'string.replace',
  'string.replaceAll', 'string.split', 'Array.from',
] as const;

export type CostOperation = typeof COST_OPERATIONS[number];
export interface CostCase {
  operation: CostOperation;
  source: string;
  state: Record<string, unknown>;
  expected: unknown;
  minimumCost: number;
}

/** Nonempty bounded receivers make an uncharged call observable. */
export function costCase(operation: CostOperation, length: number): CostCase {
  if (!Number.isInteger(length) || length < 1 || length > 64) throw new Error('invalid cost-case length');
  const n = length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const s = 'a'.repeat(n);
  const make = (source: string, state: Record<string, unknown>, expected: unknown, minimumCost: number): CostCase =>
    ({ operation, source, state, expected, minimumCost });
  switch (operation) {
    case 'array.filter': return make('xs.filter(x => x % 2 === 0)', { xs }, xs.filter(x => x % 2 === 0), n);
    case 'array.flatMap': return make('xs.flatMap(x => [x, x])', { xs }, xs.flatMap(x => [x, x]), n);
    case 'array.map': return make('xs.map(x => x + 1)', { xs }, xs.map(x => x + 1), n);
    case 'array.reverse': return make('xs.reverse()', { xs }, [...xs].reverse(), n);
    case 'array.slice': return make('xs.slice(1)', { xs }, xs.slice(1), n);
    case 'string.concat': return make("s.concat('x')", { s }, s + 'x', n);
    case 'string.endsWith': return make("s.endsWith('a')", { s }, true, n / 64);
    case 'string.slice': return make('s.slice(1)', { s }, s.slice(1), n / 64);
    case 'string.startsWith': return make("s.startsWith('a')", { s }, true, n / 64);
    case 'string.substring': return make('s.substring(1)', { s }, s.substring(1), n / 64);
    case 'string.includes': return make("s.includes('b')", { s }, false, n / 32);
    case 'string.indexOf': return make("s.indexOf('b')", { s }, -1, n / 32);
    case 'string.lastIndexOf': return make("s.lastIndexOf('b')", { s }, -1, n / 32);
    case 'string.trim': return make('s.trim()', { s: ` ${s} ` }, s, (n + 2) / 16);
    case 'string.trimEnd': return make('s.trimEnd()', { s: ` ${s} ` }, ` ${s}`, (n + 2) / 16);
    case 'string.trimStart': return make('s.trimStart()', { s: ` ${s} ` }, `${s} `, (n + 2) / 16);
    case 'string.toLowerCase': return make('s.toLowerCase()', { s: 'A'.repeat(n) }, s, n / 32);
    case 'string.toUpperCase': return make('s.toUpperCase()', { s }, 'A'.repeat(n), n / 16);
    // The explicit from-index is a number, whose documented text weight is3.
    case 'array.includes': return make('xs.includes(-1, 0)', { xs }, false, n / 16 + 3);
    case 'array.indexOf': return make('xs.indexOf(-1, 0)', { xs }, -1, n / 16 + 3);
    case 'array.lastIndexOf': return make('xs.lastIndexOf(-1, 0)', { xs }, -1, n / 16 + 3);
    case 'array.every': return make('xs.every(x => x >= 0)', { xs }, true, n);
    case 'array.reduce': return make('xs.reduce((a, x) => a + x, 0)', { xs }, n * (n - 1) / 2, n);
    case 'array.some': return make('xs.some(x => x < 0)', { xs }, false, n);
    case 'array.concat': return make('xs.concat(xs)', { xs }, [...xs, ...xs], 2 * n);
    case 'string.padEnd': return make("s.padEnd(size, 'b')", { s, size: n + 2 }, s + 'bb', n + 2);
    case 'string.padStart': return make("s.padStart(size, 'b')", { s, size: n + 2 }, 'bb' + s, n + 2);
    case 'Object.entries':
    case 'Object.keys':
    case 'Object.values': {
      const obj = Object.fromEntries(xs.map(i => [`k${i}`, i]));
      const expected = operation === 'Object.entries' ? Object.entries(obj)
        : operation === 'Object.keys' ? Object.keys(obj) : Object.values(obj);
      return make(`${operation}(obj)`, { obj }, expected, 16 * n);
    }
    case 'array.flat': return make('xs.flat()', { xs: xs.map(x => [x, x]) }, xs.flatMap(x => [x, x]), 3 * n);
    // n slots +3n numeric text units, then n one-character separators.
    case 'array.join': return make("xs.join(',')", { xs }, xs.join(','), 5 * n);
    case 'array.sort': return make('xs.sort()', { xs }, [...xs].sort(), 3 * n * Math.log2(n + 1));
    case 'string.repeat': return make('s.repeat(2)', { s }, s + s, 2 * n);
    case 'string.replace': return make("s.replace('a', 'bb')", { s }, 'bb' + s.slice(1), n + 1);
    case 'string.replaceAll': return make("s.replaceAll('a', 'bb')", { s }, 'bb'.repeat(n), 2 * n + 1);
    case 'string.split': return make("s.split('a')", { s }, Array(n + 1).fill(''), n / 32 + n + 1);
    // {length:n}:6 key characters +1 member +3 numeric units, plus n slots.
    case 'Array.from': return make('Array.from(shape)', { shape: { length: n } }, Array(n).fill(undefined), 10 + n);
    default: { const neverOperation: never = operation; throw new Error(`unhandled cost row ${neverOperation}`); }
  }
}
