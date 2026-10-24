/**
 * THE COST TABLE (DR-16). What each allowlisted native may cost, read from its
 * receiver and arguments BEFORE it runs, and charged to one allocation budget
 * (`LIMITS.ALLOC_BUDGET`), one per task in the runtime (FORMA-028).
 *
 * The step budget counts interpreter nodes, not the work inside a native, so a
 * single `Array.from({length: 12000000})` used to build a 139 MB array in a
 * 300 ms task before its result was refused. A cost here is computed without
 * running the native, so the refusal comes first.
 *
 * Units: one per array slot or string character a call produces or converts,
 * one-sixteenth per element it only scans or shares. Every call is charged, in
 * order: the text weight of each argument (most natives convert an argument to
 * a string or a number, and an array becomes text through `join`), unless the
 * native is in `DATA_ARGS`, or is a string method, which reads a string
 * argument for a 32nd of a unit a character; then its row below, if it has
 * one. A native with no row costs only the text of its arguments.
 *
 * The operators that build or read strings are charged with the weights below
 * (`GROW`, `READ`, `PARSE`, `FLAT`), in interp.ts (FORMA-028).
 *
 * Verified by: src/expr/__tests__/native-cost.test.ts > "every allowlisted native refuses an argument heavier than the budget before it runs"
 * Verified by: src/expr/__tests__/native-cost.test.ts > "every size-driven cost refuses a hostile size before the native runs"
 */

import { LIMITS } from './ast';
import { exprError } from './errors';

// Captured once, like the allowlist's intrinsics, so a page script that later
// replaces one of them cannot make a cost read low.
const isArray = Array.isArray;
const keysOf = Object.keys;
const valuesOf = Object.values;
const log2 = Math.log2;
const max = Math.max;
const min = Math.min;
const toNumber = Number;
const toText = String;
const NONE: unknown[] = [];

/**
 * Whether the text holds a character whose case mapping costs more than
 * Latin-1's: outside Latin-1 and outside the general punctuation, currency
 * signs and letterlike symbols that map to themselves (U+2000 to U+20CF,
 * U+2100 to U+2125: curly quotes, dashes, `…`, `€`, `™`). Or a character
 * outside ASCII. Bound once, so neither a later page script nor a per-call
 * argument list is involved.
 */
const costly = RegExp.prototype.exec.bind(/[^\x00-\xff\u2000-\u20cf\u2100-\u2125]/);
const nonAscii = RegExp.prototype.exec.bind(/[^\x00-\x7f]/);

/**
 * Whether a character (the first `costly` found) belongs to a script whose
 * ordinary text lowercased at 4 to 19 ns a character at 4x CPU throttling,
 * stored two bytes a character (FORMA-028): Latin Extended-A and B, the
 * combining marks, Greek, Cyrillic, Armenian, Hebrew, Arabic, the Indic
 * scripts, Thai, Tibetan, Latin Extended Additional (Vietnamese), the CJK
 * blocks and kana, Hangul, and the emoji planes. Turkish `İ` (U+0130) is in
 * Latin Extended-A and so in this tier, though it lowercases to two characters
 * and measured 27 to 30 ns. Testing one character costs nothing; a full scan
 * of two-byte text measured 6 to 7 ns a character, most of what lowercasing
 * it costs, so the tier is read from the first character outside Latin-1.
 * Text that opens with one such character is priced 1/16 whatever follows;
 * SECURITY.md states the bound that leaves (about 160 ms a task).
 */
const middle = RegExp.prototype.test.bind(/[\u0100-\u024f\u0300-\u0fff\u1e00-\u1eff\u2e80-\u9fff\uac00-\ud7af\ud83c-\ud83e]/);

/**
 * Per character a `+`, `+=` or template literal produces (FORMA-028). Joining
 * keeps the pieces as a rope; the first read of it copies the whole, which
 * through the runtime measured 0.3 to 0.7 ns a produced character at 4x, and
 * a default sort of such strings 1.3 to 2 ns: about a 128th of an
 * `Array.from` slot for the copy, the sort's comparisons charged by its row.
 */
export const GROW = 1 / 128;

/** Per character two strings are compared: 0.2 to 1.3 ns measured. */
export const READ = 1 / 128;

/** The fixed part of copying a rope an operand just built (plus a 32nd a character, to 512). */
export const FLAT = 8;

/** Per character a string is parsed as a number by an operator: 11 ns for digits. */
export const PARSE = 1 / 8;

type Cost = (recv: unknown, args: unknown[], room: number) => number;

/** Elements in a string or array; 0 for anything else. */
const len = (v: unknown): number => (typeof v === 'string' || isArray(v) ? v.length : 0);

/** The longest string a result may be (`LIMITS.MAX_STRING_LENGTH`). */
const MAX_TEXT = LIMITS.MAX_STRING_LENGTH;

/**
 * What searching an array for a long string reads: every element that is a
 * string of the same length is compared to it whole.
 * Verified by: src/expr/__tests__/string-growth.test.ts > "comparing long strings is charged by the characters compared"
 */
const alike = (r: unknown, v: unknown, room: number): number => {
  let n = 0;
  if (typeof v === 'string' && v.length > 127 && isArray(r)) {
    for (const e of r) {
      if (n > room) break;
      if (typeof e === 'string' && e.length === v.length) n += v.length * READ;
    }
  }
  return n;
};

/**
 * A count argument as the native reads it, never negative. One the native
 * cannot convert (an array-like's `length` with a `toString` that is not a
 * function) counts 0: the native's own conversion throws, inside the call
 * wrapper (FORMA-274).
 */
const count = (v: unknown): number => {
  try {
    return max(0, toNumber(v) || 0);
  } catch {
    return 0;
  }
};

/**
 * An argument read as data, not text: a string's or array's length, an
 * object's enumerable keys, or 1. `for...in` has the engine list the keys
 * before the first iteration, so this saves the counting past `room`, not the
 * listing; the object already exists, so the listing is bounded by its size.
 */
const size = (v: unknown, room: number): number => {
  if (typeof v === 'string' || isArray(v)) return v.length;
  let n = 0;
  if (typeof v === 'object' && v) {
    for (const key in v) {
      if (++n > room) break;
    }
  }
  return n || 1;
};

/**
 * Weigh a value without converting it, stopping once the total passes `room`.
 *
 * With `depth` < 0 (the default) this is its weight as text: a string counts
 * its characters, an array its length plus its elements, an object one plus
 * the key length per own member plus its values, a number 3 (converting a
 * double to text measured about three array slots), anything else 1.
 * An array holding the same long string a thousand times therefore weighs a
 * thousand strings, which is what `String()` or `join` would build from it.
 *
 * With `depth` >= 0 it counts the slots `flat(depth - 1)` visits: each array
 * expanded adds its length, and only arrays it will expand are queued.
 *
 * Iterative, and every expansion adds to the total before its children are
 * queued, so a cyclic or ten-thousand-deep value stops at `room` instead of
 * looping or overflowing the stack.
 *
 * With `depth` -2 (the default) the value is about to be converted to text
 * or a number; with `AS_DATA` it is read as data instead (`JSON.stringify`,
 * `$dispatch`'s detail, `data-persist`, a row's whole `{item}`,
 * `Array.from`'s array-like) and weighs the same, but is not converted.
 *
 * A conversion calls `toString` on the value, and on each element of an
 * array it converts (`join`), never on an object's members. JSON can shadow
 * that method with a value that is not a function (`{"toString": 1}`), and a
 * handler can write one onto an array (`list.toString = 1`); converting such
 * a value threw a TypeError. Each value the conversion would reach (the
 * value, and the elements of the arrays among them) is checked, arrays
 * included, and one whose `toString` is not a function is refused with
 * `FORMA_E_CALL_FAILED` (FORMA-274). A value read as data is never refused
 * for it. The walk keeps which values a conversion reaches in the parity of
 * their depth, two a level: even for those, odd for the members of an object
 * and what is under them.
 *
 * As text, a value nested more than 100 arrays or objects deep is refused
 * with `FORMA_E_BUDGET` where the walk reaches its 101st level (FORMA-274).
 * Converting a value recurses through its nesting (`join`, `String()`, a
 * default `sort`, `JSON.stringify`, an operator), and past a few thousand
 * levels the engine's stack overflows in place of the call: a `RangeError`
 * out of `mountMarkup`, or an uncaught page error. Measured on a fresh stack
 * (and under 2,000 frames of a caller), `String()` of nested arrays
 * overflowed past 785 levels in Firefox 157 (622), 2,822 in Node 24 (2,185),
 * 4,112 in Chromium 156 (3,178) and 4,990 in WebKit 27.2 (4,771). The cap of
 * 100 leaves more than sixfold headroom below the lowest measured overflow
 * depth, Firefox's 622 under caller load. The combined boundary is also
 * tested with 31 relayed handlers converting a value 100 deep. Engine stack
 * sizes vary; this is a conservative policy, not a universal stack bound.
 * Every conversion of a value is priced here before it runs, so
 * this one check covers each source a value comes from: state, a response,
 * storage, a handler's write, and an expression that built it (`reduce`
 * makes 10,000 levels inside every budget). It is final and arms nothing,
 * like a refusal that checks a length (FORMA-249).
 * Verified by: src/expr/__tests__/native-cost.test.ts > "weighing stops at the budget on a cyclic or deeply nested value"
 * Verified by: src/__tests__/runtime-throw-paths.test.ts > "a value an expression builds itself is refused the same way: no entry point sees it"
 * Verified by: src/__tests__/runtime-throw-paths.test.ts > "a value 100 deep renders and one 101 deep is refused; a nested dictionary still serializes"
 * Verified by: src/__tests__/runtime-throw-paths.test.ts > "is refused with FORMA_E_CALL_FAILED before anything converts it, where it threw a TypeError out of mountMarkup and the handler"
 * Verified by: src/__tests__/runtime-throw-paths.test.ts > "a dictionary with a toString key still serializes, persists, renders as a row and travels as $dispatch detail"
 * Verified by: src/__tests__/runtime-throw-paths.test.ts > "an array a handler gave its own toString is refused wherever it is converted"
 */
export function weigh(root: unknown, room: number, depth = -2): number {
  if (typeof root !== 'object' || root === null) {
    return depth >= 0 ? 0 : typeof root === 'string' ? root.length : typeof root === 'number' ? 3 : 1;
  }
  let total = 0;
  const todo: unknown[] = [root];
  const depths: number[] = [depth];
  while (todo.length > 0 && total <= room) {
    const v = todo.pop();
    const d = depths.pop()!;
    if (d < -201 && v && typeof v === 'object') {
      throw exprError('FORMA_E_BUDGET', 'a value nested over 100 deep');
    }
    let kids = NONE;
    if (isArray(v)) {
      if (d) {
        total += v.length;
        kids = v;
      }
    } else if (d >= 0) {
      // Counting slots: a leaf was counted as its parent's slot.
    } else if (typeof v === 'string') {
      total += v.length;
    } else if (typeof v === 'object' && v) {
      for (const k of keysOf(v)) total += k.length + 1;
      kids = valuesOf(v);
    } else {
      total += typeof v === 'number' ? 3 : 1;
    }
    if (kids !== NONE && d < 0 && !(d & 1) && typeof (v as { toString?: unknown }).toString !== 'function') {
      throw exprError('FORMA_E_CALL_FAILED', 'a value whose toString is not a function');
    }
    if (total <= room && kids.length) {
      // An object's members are not converted with it: an odd depth marks them.
      const next = d >= 0 ? d - 1 : kids === v || d & 1 ? d - 2 : d - 3;
      for (const k of kids) {
        if (d < 0 || (d > 1 && isArray(k))) {
          todo.push(k);
          depths.push(next);
        }
      }
    }
  }
  return total;
}

/**
 * What one replacement adds to the receiver's length, at most. With a string
 * pattern only `` $` `` and `$'` can insert the text before or after the match
 * (up to the whole receiver) and `$&` the match itself; every other `$` form
 * is literal or shrinks, so it costs its own length.
 * Verified by: src/expr/__tests__/native-cost.test.ts > "a $ in a replacement is charged only for what it can insert"
 */
const grow = (r: unknown, args: unknown[]): number => {
  const what = toText(args[0]);
  const by = toText(args[1]);
  const times = (token: string): number => by.split(token).length - 1;
  return max(0, by.length + times('$&') * what.length + (times('$`') + times("$'")) * len(r) - what.length);
};

/**
 * Natives that read their arguments as values, never as text, so their
 * arguments are not charged as text. The predicates (`items.filter(Boolean)`
 * applies one to every element) cost nothing; the others have a row that
 * charges what they read: a shallow count of elements or keys.
 * Verified by: src/expr/__tests__/native-cost.test.ts > "a predicate native reads a large argument for free"
 * Verified by: src/expr/__tests__/native-cost.test.ts > "a native that reads its argument as data is charged its element count, not its text"
 */
export const DATA_ARGS: ReadonlySet<string> = new Set([
  'Array.isArray', 'Boolean', 'Number.isFinite', 'Number.isInteger', 'Number.isNaN',
  'Array.from', 'Object.entries', 'Object.keys', 'Object.values',
  'array.concat', 'array.includes', 'array.indexOf', 'array.lastIndexOf',
]);

/** `weigh`'s depth for a value read as data, never converted (FORMA-274). */
export const AS_DATA = -3;


/**
 * One row per native whose cost grows with its receiver or with a size or
 * count argument. Keys are `array.<method>`, `string.<method>`, or the label
 * a global carries (`Array.from`).
 *
 * - `array.sort` charges n log n comparisons. The default order converts both
 *   elements to text at every comparison, so an element that is an array adds
 *   its text weight each time, and a string element its length at `READ`: two
 *   strings that share a long prefix are read that far (FORMA-028; round 2
 *   sorted 2,000 such strings for 1.5 s at 4x).
 * - `every`, `some` and `reduce` skip holes without calling back, so on a
 *   sparse array the step budget does not bound them. A hole measured about
 *   the cost of an array slot, so they cost the receiver's length.
 * - `includes`, `indexOf` and `lastIndexOf` compare the search value without
 *   converting it, but convert `fromIndex` to a number: that is weighed as text.
 *   A search value that is a long string is compared whole with every element
 *   of the same length (`alike`).
 * - `Array.from` converts an array-like's `length` to a number, so the
 *   array-like is weighed as text before that conversion.
 * - `Object.keys` / `values` / `entries` charge 16 per element or key: listing
 *   an object's keys, or a string's index keys, measured several array slots
 *   per key.
 * - The string rows that amplify nothing (their output is at most a small
 *   constant times the receiver) are weighted by their measured cost per
 *   character against an `Array.from` slot (about 110 ns at 4x CPU
 *   throttling), by `node scripts/measure-alloc-budget.mjs --chars`. Case
 *   mapping is refused before the call past the 1 MiB result cap, which it
 *   would pass anyway, and tiered by the costliest character (`costly`, then
 *   `nonAscii`): lowercasing a string stored one byte a character measured at
 *   most 2.1 ns. Lowercasing two-byte text measured 4 to 19 ns a character in
 *   the scripts `middle` names (most for all-capital Greek, least for text that
 *   changes little, such as CJK; Turkish `İ` 27 to 30 ns) and 17 to 40 ns
 *   beyond them (Georgian, Cherokee, Greek Extended, fullwidth Latin): such text costs 1/16 when its
 *   first character above Latin-1 is in a `middle` script, else 1/2 (FORMA-028;
 *   in 2.0.3 all of it cost 1/2, refusing a search over 1,716 records of Greek).
 *   The first character decides because a full scan of two-byte text measured
 *   6 to 7 ns a character, most of the cost of lowercasing it; SECURITY.md says
 *   what that leaves open. Uppercasing ASCII 1.3 ns,
 *   Latin-1 up to 32 ns (`ß` and `ÿ` widen), and costly text up to 64 ns (`ΐ`
 *   becomes three characters). The cheap tier also takes text stored two bytes
 *   a character whose characters above U+00FF are only those self-mapping
 *   symbols, so one curly apostrophe in a record does not price it as Greek.
 *   A string stored two bytes a character costs more for the same text
 *   (lowercasing 4 to 11 ns, plus the tier scan's 3.5 ns) than the 1/32 its
 *   tier charges: up to about fourfold. A text search over 9,000 records with
 *   such characters still measured under 50 ms; a budget's worth of calls on
 *   long two-byte strings does not, and SECURITY.md lists it. The tier test is
 *   itself a scan (free on one-byte strings), skipped when even the cheapest
 *   tier is past the whole budget.
 * - `includes`, `indexOf` and `lastIndexOf` on a string are weighted for
 *   ordinary text, under 1 ns a character. A pattern whose first characters
 *   fill the receiver (`'ab'` in `'aaaa…'`) measured 39 ns: SECURITY.md lists
 *   it with the other content-dependent costs (FORMA-028).
 */
export const COSTS: Readonly<Record<string, Cost>> = Object.create(null) as Record<string, Cost>;

function rows(cost: Cost, names: string): void {
  for (const name of names.split(' ')) (COSTS as Record<string, Cost>)[name] = cost;
}

// The result is a copy of the receiver, or no longer than it.
rows((r) => len(r), 'array.filter array.flatMap array.map array.reverse array.slice string.concat');
// Shared or sliced, or read only as far as the argument: flattening a
// concatenated receiver measured about 1 ns a character.
rows((r) => len(r) / 64, 'string.endsWith string.slice string.startsWith string.substring');
// Searched: ordinary text measured under 1 ns a character.
rows((r) => len(r) / 32, 'string.includes string.indexOf string.lastIndexOf');
// Whitespace runs measured 3.5 ns a character.
rows((r) => len(r) / 16, 'string.trim string.trimEnd string.trimStart');
// Case mapping never shortens a string, so a receiver past the 1 MiB result
// cap is refused before the call instead of after it (FORMA-028: one call on
// 8 million two-byte characters took 115 ms before that refusal).
rows((r, _, room) => {
  const n = len(r);
  if (n > MAX_TEXT) return Infinity;
  const first = n / 32 > room ? null : costly(r as string);
  return !first ? n / 32 : n / 16 > room || middle(first[0]) ? n / 16 : n / 2;
}, 'string.toLowerCase');
rows((r, _, room) => {
  const n = len(r);
  if (n > MAX_TEXT) return Infinity;
  return n / 16 > room ? n / 16 : costly(r as string) ? n : nonAscii(r as string) ? n / 2 : n / 16;
}, 'string.toUpperCase');
rows((r, a, room) => len(r) / 16 + weigh(a[1], room) + alike(r, a[0], room), 'array.includes array.indexOf array.lastIndexOf');
// Every index is visited, holes included.
rows((r) => len(r), 'array.every array.reduce array.some');
rows((r, a) => {
  let n = len(r);
  for (const x of a) n += isArray(x) ? x.length : 1;
  return n;
}, 'array.concat');
rows((r, a) => max(len(r), count(a[0])), 'string.padEnd string.padStart');
rows((_, a, room) => 16 * size(a[0], room / 16), 'Object.entries Object.keys Object.values');
rows((r, a, room) => weigh(r, room, (a[0] === undefined ? 1 : count(a[0])) + 1), 'array.flat');
rows((r, a, room) => weigh(r, room) + len(r) * (a[0] === undefined ? 1 : toText(a[0]).length), 'array.join');
rows((r, a, room) => {
  const n = len(r);
  const levels = log2(n + 1);
  let per = 3 * n;
  // Element conversion can only add cost. Refuse an already-overbudget
  // length before walking the default sort's elements.
  const minimum = per * levels;
  if (minimum > room) return minimum;
  if (a[0] === undefined && isArray(r)) {
    for (const e of r) {
      if (per > room) break;
      if (isArray(e)) per += weigh(e, room);
      else if (typeof e === 'string') per += e.length * READ;
    }
  }
  return per * levels;
}, 'array.sort');
rows((r, a) => len(r) * count(a[0]), 'string.repeat');
rows((r, a) => len(r) + grow(r, a), 'string.replace');
rows((r, a) => len(r) + (len(r) + 1) * grow(r, a), 'string.replaceAll');
// Scanned for the separator, then one slot per piece, at most `limit` pieces.
rows((r, a) => {
  const n = len(r);
  const by = a[0] === undefined ? n : toText(a[0]).length;
  const pieces = (by ? n / by : n) + 1;
  return n / 32 + (a[1] === undefined ? pieces : min(pieces, toNumber(a[1]) >>> 0));
}, 'string.split');
rows((_, a, room) => {
  const x = a[0];
  if (typeof x === 'string' || isArray(x)) return len(x);
  const text = weigh(x, room, AS_DATA);
  return text > room ? text : text + count((x as { length?: unknown } | null)?.length);
}, 'Array.from');
Object.freeze(COSTS);
