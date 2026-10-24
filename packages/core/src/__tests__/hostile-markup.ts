/**
 * The FORMA-274 property matrix: every directive, and every way an expression
 * hands a value to the runtime, a native or a DOM method, each given every
 * hostile T2 value below.
 *
 * Not a `.test.ts` file: `runtime-throw-paths.test.ts` runs it in happy-dom,
 * and `e2e/native-throw.spec.ts` runs it in Chromium, from this one list.
 *
 * A T2 value is JSON (SECURITY.md, *Threat model*): a `data-forma-state`
 * attribute, a `data-fetch` response or a `data-persist` entry. JSON cannot
 * hold a cycle, a function, a symbol or an object without a prototype; a
 * handler can still make a cycle (`o.self = o`), or give an array its own
 * `toString` (`list[v] = 1` for `v` "toString"), and the matrix's handlers
 * do.
 */

const nested = (open: string, close: string, n: number): string => open.repeat(n) + '0' + close.repeat(n);

/** Hostile values, as the JSON a page or a server would send. */
export const HOSTILE_VALUES: Readonly<Record<string, string>> = {
  'arrays nested 10,000 deep': nested('[', ']', 10_000),
  'objects nested 10,000 deep': nested('{"a":', '}', 10_000),
  'arrays nested 101 deep': nested('[', ']', 101),
  'arrays nested 100 deep': nested('[', ']', 100),
  'a string past the 1 MiB result cap': JSON.stringify('x'.repeat(1_048_577)),
  'an array of 300,000 numbers': `[${'1,'.repeat(299_999)}1]`,
  'a thousand references to one long string': `[${Array.from({ length: 1000 }, () => JSON.stringify('y'.repeat(300))).join(',')}]`,
  null: 'null',
  true: 'true',
  false: 'false',
  zero: '0',
  'negative zero': '-0',
  'the largest double': '1.7976931348623157e308',
  'a number JSON reads as Infinity': '1e400',
  '2 ** 53 + 1': '9007199254740993',
  'a radix or digit count of -1': '-1',
  'a radix of 1': '1',
  'a radix of 37': '37',
  'a digit count of 101': '101',
  '1e21': '1e21',
  'an empty string': '""',
  'a space': '" "',
  'two words': '"a b"',
  'an invalid selector': '"#1"',
  'an unknown pseudo-class': '":bogus"',
  'an unclosed bracket': '"["',
  'a lone brace': '"{"',
  'a numeric string': '"-1"',
  'a dashed dataset key': '"a-b"',
  'cssText': '"cssText"',
  '__proto__': '"__proto__"',
  'constructor': '"constructor"',
  'a key past 128 characters': JSON.stringify('k'.repeat(129)),
  'a script URL': '"javascript:alert(1)"',
  'markup': '"<img src=x onerror=alert(1)>"',
  'a NUL character': '"\\u0000"',
  'a lone surrogate': '"\\ud800"',
  'an activation event name': '"click"',
  'an empty object': '{}',
  'an empty array': '[]',
  'an array of an empty array': '[[]]',
  'a __proto__ key': '{"__proto__": {"polluted": 1}}',
  'own toString, valueOf, constructor and then keys': '{"toString": 1, "valueOf": 2, "constructor": 3, "then": 4}',
  'a dictionary with toString and valueOf keys': '{"toString": "to string", "valueOf": "value of", "the": 10}',
  'the key toString': '"toString"',
  'a length of a billion': '{"length": 1000000000}',
  'a negative length': '{"length": -1}',
  'mixed types': '[1, "a", null, {}, [], true]',
  'records': '[{"id": 1, "name": "a"}, {"id": 1, "name": "b"}, {"id": null}]',
};

/**
 * Every directive, and each place an expression hands its value on. `v` is
 * the hostile value; `go` handlers are dispatched once each. Two directives
 * have no name after their colon.
 */
export const HOSTILE_BODIES: readonly string[] = [
  // Directives, given the value.
  '<p data-text="{v}">t</p>',
  '<p data-show="{v}">s</p>',
  '<p data-if="{v}">i</p>',
  '<p data-class:on="{v}">c</p>',
  '<p data-class:="{v}">c</p>',
  '<p data-bind:title="{v}">b</p>',
  '<p data-bind:="{v}">b</p>',
  '<a data-bind:href="{v}">h</a>',
  '<img data-bind:src="{v}">',
  '<input data-model="{v}">',
  '<input type="checkbox" data-model="{v}">',
  '<input type="radio" value="x" data-model="{v}">',
  '<input type="number" data-model="{v}">',
  '<input type="file" data-model="{v}">',
  '<select data-model="{v}"><option>x</option></select>',
  '<select multiple data-model="{v}"><option>x</option></select>',
  '<textarea data-model="{v}"></textarea>',
  '<progress data-model="{v}"></progress>',
  '<meter data-model="{v}"></meter>',
  '<ul data-list="{v}"><li>{item}</li></ul>',
  '<ul data-list="{v}"><li data-key="{item.id}">{item.name} {item}</li></ul>',
  '<ul data-list="{[v, v]}"><li title="{item}">{item}</li></ul>',
  '<p data-persist="{v}" data-text="{typeof v}">p</p>',
  '<i data-computed="w = v"></i><p data-text="{w}">w</p>',
  // Operators.
  `<p data-text="{'' + v}">o</p>`,
  '<p data-text="{`${v}`}">o</p>',
  '<p data-text="{v < 1}">o</p>',
  '<p data-text="{-v}">o</p>',
  '<p data-text="{v + 1}">o</p>',
  `<p data-text="{v == 'x'}">o</p>`,
  '<p data-text="{v ? !v : typeof v}">o</p>',
  '<p data-text="{v?.a?.b}">o</p>',
  '<p data-text="{v[0]}">o</p>',
  '<p data-text="{v.length}">o</p>',
  '<p data-text="{items[v]}">o</p>',
  // Natives.
  '<p data-text="{String(v)}">n</p>',
  '<p data-text="{Number(v)}">n</p>',
  '<p data-text="{JSON.stringify(v)}">n</p>',
  '<p data-text="{JSON.parse(v)}">n</p>',
  '<p data-text="{Object.keys(v)}">n</p>',
  '<p data-text="{Object.entries(v)}">n</p>',
  '<p data-text="{Array.from(v)}">n</p>',
  '<p data-text="{parseInt(v, v)}">n</p>',
  '<p data-text="{[1, [2]].flat(v)}">n</p>',
  `<p data-text="{'x'.repeat(v)}">n</p>`,
  '<p data-text="{(1).toFixed(v)}">n</p>',
  '<p data-text="{(1).toPrecision(v)}">n</p>',
  '<p data-text="{(255).toString(v)}">n</p>',
  `<p data-text="{'abc'.split(v)}">n</p>`,
  `<p data-text="{'abc'.replace(v, v)}">n</p>`,
  `<p data-text="{'abc'.padStart(v)}">n</p>`,
  '<p data-text="{[3, 1, 2].sort((a, b) => v)}">n</p>',
  '<p data-text="{[v, v].sort()}">n</p>',
  '<p data-text="{[1, 2].map(x => v)}">n</p>',
  '<p data-text="{[1].includes(v, v)}">n</p>',
  '<p data-text="{Math.max(v, 1)}">n</p>',
  '<p data-text="{Array.from({length: 3}).reduce(a => [a, v], v)}">n</p>',
  // DOM methods and Forma's own checks before them.
  '<p data-text="{$el.matches(v)}">d</p>',
  '<p data-text="{$el.closest(v)}">d</p>',
  '<p data-text="{$el.querySelector(v)}">d</p>',
  '<p data-text="{$el.querySelectorAll(v)}">d</p>',
  '<p data-text="{$el.getAttribute(v)}">d</p>',
  '<p data-text="{$el.setAttribute(v, v)}">d</p>',
  `<p data-text="{$el.setAttribute('title', v)}">d</p>`,
  '<p data-text="{$el.toggleAttribute(v)}">d</p>',
  '<p data-text="{$el.style.setProperty(v, v)}">d</p>',
  '<p data-text="{$el.classList.contains(v)}">d</p>',
  '<p data-text="{$el.scrollIntoView(v)}">d</p>',
  '<p data-text="{$dispatch(v, v)}">d</p>',
  // Handlers: the same value written to the DOM at event time.
  '<p data-on:go="{$el.textContent = v}">h</p>',
  '<input data-on:go="{$el.value = v}">',
  '<input type="file" data-on:go="{$el.value = v}">',
  '<progress data-on:go="{$el.value = v; $el.max = v}"></progress>',
  '<meter data-on:go="{$el.value = v; $el.min = v}"></meter>',
  '<p data-on:go="{$el.id = v; $el.className = v; $el.hidden = v; $el.scrollTop = v}">h</p>',
  '<p data-on:go="{$el.style.color = v; $el.dataset.x = v}">h</p>',
  '<p data-on:go="{$el.dataset[v] = v}">h</p>',
  '<p data-on:go="{$el.classList.add(v); $el.classList.toggle(v); $el.classList.remove(v)}">h</p>',
  `<p data-on:go="{$el.classList.replace(v, 'x')}">h</p>`,
  `<p data-on:go="{$el.setAttribute(v, 'x'); $el.scrollIntoView(v); $el.focus(v)}">h</p>`,
  '<p data-on:go="{x = v; x += v; n++}">h</p>',
  '<p data-on:go="{o.self = o; o.v = v; n++}">h</p>',
  `<p data-on:go="{list[v] = 1; x = '' + list; n++}">h</p>`,
  `<p data-text="{n + '' + list}">h</p>`,
  '<p data-on:go="{$dispatch(v, v)}">h</p>',
];

/** One scope holding every body, the value `json` as `v`, and a counter beside them (`#inc` on `ping`, shown in `#count`). */
export function hostileModule(json: string): string {
  const state = `{"v": ${json}, "items": {"a": 1}, "x": 0, "n": 0, "c": 0, "o": {"a": 1}, "list": [1, 2]}`.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
  const bodies = HOSTILE_BODIES.map((body, i) => `<div id="b${i}">${body}</div>`).join('');
  return `<div data-forma-state='${state}'><div data-fetch="/api/hostile → f"><p data-text="{f}">f</p></div>${bodies}<button id="inc" data-on:ping="{c++}"></button><p id="count" data-text="{c}">count</p></div>`;
}
