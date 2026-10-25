import { test, expect, type Page } from '@playwright/test';
import { HOSTILE_VALUES, hostileModule } from '../src/__tests__/hostile-markup';

/**
 * FORMA-271 in a real engine: an allowlisted native or DOM method that throws
 * on its arguments is reported on its binding as `FORMA_E_CALL_FAILED`, and
 * neither escapes `mountMarkup` nor reaches the page as an uncaught error.
 *
 * Before, `{JSON.parse('{')}` and its kind threw out of `mountMarkup` and
 * left the module unbound, and in a handler they were uncaught page errors
 * with no diagnostic. The `classList` methods here throw only in a browser:
 * happy-dom's `classList.add('')` does not; the native engines do.
 *
 * FORMA-274 closed what was left: the runtime's own DOM writes, values nested
 * too deep or with a `toString` that is not a function, event-time property
 * writes, a DOM method's rejected promise (the native scroll call is also
 * deferred explicitly so every engine exercises asynchronous rejection), and
 * evaluations nested past the stack. Each is a coded diagnostic, and no
 * markup in the FORMA-274 matrix throws out of `mountMarkup` or raises an
 * uncaught page error or an unhandled rejection.
 */
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

interface Outcome { mountError: string | null; codes: Array<[string, string, string]>; kinds: string[]; marked: string[]; ok: string | null }

async function mount(page: Page, body: string, click: string[] = []): Promise<Outcome> {
  return page.evaluate(async ({ body, click }) => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    rt.clearDiagnostics();
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    let mountError: string | null = null;
    try {
      rt.mountMarkup(root, rt.trustedHtml(`<div data-forma-state='{"raw": "{\\"a\\":", "n": 1, "x": 0, "cls": ""}'>${body}<p id="ok" data-text="{n + 1}">ok</p></div>`), { tier: 'reviewed', grants: { dom: true } });
    } catch (e) {
      mountError = `${(e as Error).name}: ${(e as Error).message}`;
    }
    for (const id of click) (root.querySelector(`#${id}`) as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    return {
      mountError,
      codes: (rt.getDiagnostics() as Array<{ code: string; expr: string; reason: string }>).map((d) => [d.code, d.expr, d.reason] as [string, string, string]),
      kinds: (rt.getDiagnostics() as Array<{ kind: string }>).map((d) => d.kind),
      marked: [...root.querySelectorAll('[data-forma-expr-error],[data-forma-handler-error]')].map((e) => e.id),
      ok: root.querySelector('#ok')?.textContent ?? null,
    };
  }, { body, click });
}

// Browser-owned message prose varies; Forma's operation and native error
// class must still match exactly, and the native message must not disappear.
function expectReason(actual: string, prefix: string): void {
  expect(actual.startsWith(prefix), actual).toBe(true);
  if (prefix.endsWith(': ')) expect(actual.length, actual).toBeGreaterThan(prefix.length);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/runtime-bare.html');
});

test('a value binding whose native throws is reported on its element, and the module mounts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const cases: Array<[string, string]> = [
    [`JSON.parse('{')`, 'JSON.parse() threw SyntaxError: '],
    ['JSON.parse(raw)', 'JSON.parse() threw SyntaxError: '],
    ['(1).toFixed(500)', 'number.toFixed() threw RangeError: '],
    ['(1).toString(1)', 'number.toString() threw RangeError: '],
    ['Object.keys(null)', 'Object.keys() threw TypeError: '],
    ['[].reduce((a, b) => a + b)', 'array.reduce() threw TypeError: '],
    [`$el.matches(':bogus')`, '$el.matches() threw SyntaxError: '],
    [`$el.querySelectorAll('#1')`, '$el.querySelectorAll() threw SyntaxError: '],
    [`$el.closest('.')`, '$el.closest() threw SyntaxError: '],
  ];
  for (const [expr, reason] of cases) {
    const r = await mount(page, `<p id="bad" data-text="{${expr}}">kept</p>`);
    expect(r.mountError, expr).toBeNull();
    expect(r.codes.map(([code, e]) => [code, e]), expr).toEqual([['FORMA_E_CALL_FAILED', expr]]);
    expectReason(r.codes[0]![2], reason);
    expect(r.kinds, expr).toEqual(['expression-unsupported']);
    expect(r.marked, expr).toEqual(['bad']);
    expect(r.ok, expr).toBe('2');
  }
  expect(errors).toEqual([]);
});

test('a handler whose DOM method throws is reported on its element, not an uncaught page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const cases: Array<[string, string]> = [
    [`$el.classList.add('')`, "$el.classList.add() threw SyntaxError: "],
    [`$el.classList.add('a b')`, "$el.classList.add() threw InvalidCharacterError: "],
    ['$el.classList.toggle(cls)', "$el.classList.toggle() threw SyntaxError: "],
    [`$el.classList.replace('', 'x')`, "$el.classList.replace() threw SyntaxError: "],
    [`x = JSON.parse('{')`, 'JSON.parse() threw SyntaxError: '],
  ];
  for (const [handler, reason] of cases) {
    const r = await mount(page, `<button id="bad" data-on:click="{${handler}}">b</button><button id="inc" data-on:click="{n++}">+</button>`, ['bad', 'inc']);
    expect(r.mountError, handler).toBeNull();
    expect(r.codes.map(([code, e]) => [code, e]), handler).toEqual([['FORMA_E_CALL_FAILED', handler]]);
    expectReason(r.codes[0]![2], reason);
    expect(r.kinds, handler).toEqual(['handler-unsupported']);
    expect(r.marked, handler).toEqual(['bad']);
    expect(r.ok, `${handler}: the handler beside it still runs`).toBe('3');
  }
  expect(errors).toEqual([]);
});

test("the runtime's own writes and event-time property writes retain coded native failures", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const cases: Array<[body: string, click: string[], code: string, reason: string, expr: string]> = [
    ['<p id="bad" data-class:="{true}">x</p>', [], 'FORMA_E_UNSUPPORTED', 'data-class: has no name', 'data-class:="{true}"'],
    ['<p id="bad" data-bind:="{1}">x</p>', [], 'FORMA_E_UNSUPPORTED', 'data-bind: has no name', 'data-bind:="{1}"'],
    [`<input id="bad" type="file" data-model="{raw}">`, [], 'FORMA_E_CALL_FAILED', 'data-model write threw InvalidStateError: ', 'raw'],
    [`<progress id="bad" data-model="{raw}"></progress>`, [], 'FORMA_E_CALL_FAILED', 'data-model write threw TypeError: ', 'raw'],
    [`<p id="bad" data-on:click="{$el.dataset['a-b'] = 1}">x</p><button id="inc" data-on:click="{n++}">+</button>`, ['bad', 'inc'], 'FORMA_E_CALL_FAILED', "$el.dataset.a-b = … threw SyntaxError: ", "$el.dataset['a-b'] = 1"],
    [`<input id="bad" type="file" data-on:custom="{$el.value = 'x'}"><button id="inc" data-on:click="{n++}">+</button>`, ['inc'], 'FORMA_E_CALL_FAILED', "$el.value = … threw InvalidStateError: ", "$el.value = 'x'"],
    [`<meter id="bad" data-on:click="{$el.value = 'abc'}"></meter><button id="inc" data-on:click="{n++}">+</button>`, ['bad', 'inc'], 'FORMA_E_CALL_FAILED', "$el.value = … threw TypeError: ", "$el.value = 'abc'"],
  ];
  for (const [body, click, code, reason, expr] of cases) {
    const r = await mount(page, body, click);
    if (body.includes('data-on:custom')) {
      // A file input's click opens a chooser: its handler runs on an event of its own.
      await page.evaluate(() => { document.querySelector('#bad')!.dispatchEvent(new Event('custom')); });
      const later = await page.evaluate(() => {
        const diagnostics = (window as unknown as { FormaRuntime: any }).FormaRuntime.getDiagnostics();
        return {
          codes: diagnostics.map((d: { code: string; expr: string; reason: string }) => [d.code, d.expr, d.reason] as [string, string, string]),
          kinds: diagnostics.map((d: { kind: string }) => d.kind),
          marked: [...document.querySelectorAll('[data-forma-expr-error],[data-forma-handler-error]')].map((el) => el.id),
        };
      });
      Object.assign(r, later);
    }
    expect(r.mountError, body).toBeNull();
    expect(r.codes.map(([c, e]) => [c, e]), body).toEqual([[code, expr]]);
    expect(r.kinds, body).toEqual([body.includes('data-on:') ? 'handler-unsupported' : 'expression-unsupported']);
    expect(r.marked, body).toEqual(['bad']);
    expectReason(r.codes[0]![2], reason);
    expect(r.ok, body).toBe(click.includes('inc') ? '3' : '2');
  }
  expect(errors).toEqual([]);
});

// Invalid scroll options throw synchronously in some engines and reject in
// others. Match the real engine's native failure, and separately defer that
// same native call to require Promise rejection handling on every engine.
for (const deferred of [false, true]) test(`a native scroll failure is coded on its handler, never unhandled (deferred: ${deferred})`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const native = await page.evaluate(async () => {
    const el = document.createElement('p');
    try {
      let result: unknown;
      try { result = el.scrollIntoView({ behavior: 'bad' as ScrollBehavior }); }
      catch (e) { return { mode: 'threw', name: (e as Error).name, message: (e as Error).message }; }
      await result;
    } catch (e) { return { mode: 'rejected', name: (e as Error).name, message: (e as Error).message }; }
    throw new Error('native invalid scroll options did not fail');
  });
  expect(native.name).toBe('TypeError');
  expect(native.message.length).toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as unknown as { __rejected: string[] }).__rejected = [];
    window.addEventListener('unhandledrejection', (e) => { (window as unknown as { __rejected: string[] }).__rejected.push(String(e.reason)); });
  });
  const expr = "$el.scrollIntoView({behavior: 'bad'})";
  const r = await mount(page, `<p id="bad" data-on:custom="{${expr}}">x</p><button id="inc" data-on:click="{n++}">+</button>`);
  const initial = await page.evaluate((deferred) => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    const el = document.querySelector('#bad') as HTMLElement;
    if (deferred) {
      const nativeScroll = el.scrollIntoView;
      // This is a controlled async boundary around the real native operation,
      // not a mocked diagnostic or acceptance of a synchronous throw.
      el.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
        return Promise.resolve().then(() => nativeScroll.call(this, options));
      };
    }
    el.dispatchEvent(new Event('custom'));
    const codesBeforeMicrotask = rt.getDiagnostics().map((d: { code: string }) => d.code);
    (document.querySelector('#inc') as HTMLElement).click();
    return { codesBeforeMicrotask, ok: document.querySelector('#ok')?.textContent };
  }, deferred);
  expect(r.mountError).toBeNull();
  expect(initial.ok).toBe('3');
  if (deferred) expect(initial.codesBeforeMicrotask).toEqual([]);
  const expected = [['handler-unsupported', 'FORMA_E_CALL_FAILED', expr,
    `$el.scrollIntoView() ${deferred ? 'rejected' : native.mode} ${native.name}: ${native.message}`]];
  await expect.poll(() => page.evaluate(() => (window as unknown as { FormaRuntime: any }).FormaRuntime.getDiagnostics()
    .map((d: { kind: string; code: string; expr: string; reason: string }) => [d.kind, d.code, d.expr, d.reason]))).toEqual(expected);
  expect(await page.locator('[data-forma-handler-error]').evaluateAll((els) => els.map((el) => el.id))).toEqual(['bad']);
  expect(await page.locator('[data-forma-expr-error]').count()).toBe(0);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(await page.evaluate(() => (window as unknown as { __rejected: string[] }).__rejected)).toEqual([]);
  expect(errors).toEqual([]);
});

test('values nested too deep, an own toString that is not a function, and evaluations nested past the stack are coded, never a page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const deep = '['.repeat(10_000) + ']'.repeat(10_000);
  const chain = Array.from({ length: 999 }, (_, i) => `a${999 - i} = a${998 - i} + 1`).join('; ') + '; a0 = 1';
  const result = await page.evaluate(async ({ deep, chain }) => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    const out: Array<[string, string | null, string[]]> = [];
    const bodies = [
      `<p data-text="{'' + d}">x</p><p data-text="{[1, 2].sort((a, b) => d)}">x</p><p data-text="{$el.matches(d)}">x</p>`,
      `<p data-text="{Array.from({length: 10000}).reduce(a => [a], 0)}">x</p>`,
      `<p data-text="{'' + t}">x</p><p data-bind:title="{t}">x</p><p data-text="{$el.setAttribute(t, 'x')}">x</p><ul data-list="{[{id: t}]}"><li data-key="{item.id}">x</li></ul>`,
      `<i data-computed="${chain}"></i><p data-text="{a999}">x</p>`,
      `<div data-on:ping="{$dispatch('ping')}"><p data-text="{$dispatch('ping')}">x</p></div>`,
    ];
    for (const body of bodies) {
      rt.clearDiagnostics();
      const root = document.createElement('div');
      document.body.replaceChildren(root);
      let mountError: string | null = null;
      try {
        rt.mountMarkup(root, rt.trustedHtml(`<div data-forma-state='{"d": ${deep}, "t": {"toString": 1}}'>${body}</div>`), { tier: 'reviewed', grants: { dom: true } });
      } catch (e) { mountError = String(e); }
      await new Promise((r) => setTimeout(r, 0));
      out.push([body.slice(0, 40), mountError, (rt.getDiagnostics() as Array<{ code: string; reason: string }>).map((d) => `${d.code}: ${d.reason}`)]);
    }
    return out;
  }, { deep, chain });
  const deepRefusal = 'FORMA_E_BUDGET: a value nested over 100 deep';
  const toStringRefusal = 'FORMA_E_CALL_FAILED: a value whose toString is not a function';
  const nestRefusal = 'FORMA_E_BUDGET: evaluations nested over 32 deep';
  expect(result.map(([, mountError]) => mountError)).toEqual([null, null, null, null, null]);
  expect(result.map(([, , codes]) => [...new Set(codes)])).toEqual([[deepRefusal], [deepRefusal], [toStringRefusal], [nestRefusal], [nestRefusal]]);
  expect(errors).toEqual([]);
});

test('a dictionary with a toString key still serializes, persists, renders as a row and travels as detail; an array given one is refused where converted', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const r = await page.evaluate(async () => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    rt.clearDiagnostics();
    try { localStorage.clear(); } catch { /* none */ }
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const details: unknown[] = [];
    root.addEventListener('pick', (e) => details.push((e as CustomEvent).detail));
    rt.mountMarkup(root, rt.trustedHtml(`<div data-forma-state='{"d": {"toString": "to string", "valueOf": "value of", "the": 10}, "list": [1, 2], "x": 0}'>
      <p id="json" data-text="{JSON.stringify(d)}">j</p>
      <ul id="rows" data-list="{[d]}"><li>{item}</li></ul>
      <p id="pick" data-on:custom="{$dispatch('pick', d)}">p</p>
      <p data-persist="{d}"></p>
      <p id="arr" data-on:custom="{list.toString = 1; x = '' + list}">a</p>
    </div>`), { tier: 'reviewed' });
    root.querySelector('#pick')!.dispatchEvent(new Event('custom'));
    root.querySelector('#arr')!.dispatchEvent(new Event('custom'));
    await new Promise((res) => setTimeout(res, 0));
    return {
      json: root.querySelector('#json')!.textContent,
      rows: root.querySelector('#rows')!.textContent,
      details,
      persisted: localStorage.getItem('forma:d'),
      codes: (rt.getDiagnostics() as Array<{ code: string; expr: string; reason: string }>).map((d) => [d.code, d.expr, d.reason]),
    };
  });
  const text = '{"toString":"to string","valueOf":"value of","the":10}';
  expect(r).toEqual({
    json: text, rows: text, details: [JSON.parse(text)], persisted: text,
    codes: [['FORMA_E_CALL_FAILED', "list.toString = 1; x = '' + list", 'a value whose toString is not a function']],
  });
  expect(errors).toEqual([]);
});

test('the deepest stack the caps allow fits: 31 handlers relayed by $dispatch, the last converting a value 100 deep', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  let inner = `<p data-text="{$dispatch('e0')}">x</p>`;
  for (let i = 0; i < 31; i++) {
    inner = `<div data-on:e${i}="{${i === 30 ? "out = ('' + v).length + JSON.stringify(v).length + [v[0], v[0]].sort().length" : `$dispatch('e${i + 1}')`}}">${inner}</div>`;
  }
  const state = `{"v": ${'['.repeat(100)}0${']'.repeat(100)}, "out": 0}`;
  const out = await page.evaluate(async ({ inner, state }) => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    rt.clearDiagnostics();
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    rt.mountMarkup(root, rt.trustedHtml(`<div data-forma-state='${state}'>${inner}<p id="out" data-text="{out}"></p></div>`), { tier: 'reviewed' });
    await new Promise((r) => setTimeout(r, 0));
    return [root.querySelector('#out')!.textContent, rt.getDiagnostics().map((d: { code: string }) => d.code)];
  }, { inner, state });
  expect(out).toEqual([String(1 + 201 + 2), []]);
  expect(errors).toEqual([]);
});

test('a native listener exception is delivered as a page error and the Forma handler that clicked is not blamed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // Firefox can deliver this after evaluate's timer has completed. Arm before
  // dispatch, and await the actual browser event instead of a time delay.
  const delivered = page.waitForEvent('pageerror');
  const codes = await page.evaluate(async () => {
    const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
    rt.clearDiagnostics();
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    rt.mountMarkup(root, rt.trustedHtml(`<div data-forma-state='{}'><button id="target">t</button><p id="go" data-on:custom="{$el.previousElementSibling.click()}">go</p></div>`), { tier: 'reviewed', grants: { navigate: true } });
    root.querySelector('#target')!.addEventListener('click', () => { throw new RangeError('an application listener'); });
    root.querySelector('#go')!.dispatchEvent(new Event('custom'));
    await new Promise((r) => setTimeout(r, 0));
    return rt.getDiagnostics().map((d: { code: string }) => d.code);
  });
  const error = await delivered;
  expect(error.name).toBe('RangeError');
  expect(error.message).toBe('an application listener');
  expect(codes).toEqual([]);
  expect(errors).toEqual(['an application listener']);
});

test('the FORMA-274 matrix in Chromium: every directive given each hostile value throws nothing out of mountMarkup, raises no page error and no unhandled rejection', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`));
  let response = 'null';
  await page.route('**/api/hostile', (route) => route.fulfill({ contentType: 'application/json', body: response }));
  await page.evaluate(() => {
    (window as unknown as { __rejected: string[] }).__rejected = [];
    window.addEventListener('unhandledrejection', (e) => { (window as unknown as { __rejected: string[] }).__rejected.push(String(e.reason)); });
  });
  const deep = HOSTILE_VALUES['arrays nested 10,000 deep']!;
  for (const [name, json] of Object.entries(HOSTILE_VALUES)) {
    response = json;
    const r = await page.evaluate(async ({ markup, laters }) => {
      const rt = (window as unknown as { FormaRuntime: any }).FormaRuntime;
      rt.clearDiagnostics();
      try { localStorage.clear(); } catch { /* none */ }
      const root = document.createElement('div');
      document.body.replaceChildren(root);
      const settle = async (): Promise<void> => {
        let last = -1;
        for (let quiet = 0, i = 0; quiet < 3 && i < 400; i++) {
          await new Promise((res) => setTimeout(res, 0));
          const n = (rt.getDiagnostics() as Array<{ count: number }>).reduce((s, d) => s + d.count, 0);
          quiet = n === last ? quiet + 1 : 0;
          last = n;
        }
      };
      let mountError: string | null = null;
      let handle: { unmount(): void } | null = null;
      try {
        handle = rt.mountMarkup(root, rt.trustedHtml(markup), { tier: 'reviewed', grants: { dom: true, fetch: { paths: ['/api/'] } } });
      } catch (e) { mountError = String(e); }
      for (const el of root.querySelectorAll('[data-on\\:go]')) el.dispatchEvent(new Event('go'));
      await settle();
      const later: string[] = [];
      for (const value of laters) {
        try { rt.setScopeValue(root.firstElementChild, 'v', JSON.parse(value)); } catch (e) { later.push(String(e)); }
        await settle();
      }
      root.querySelector('#inc')?.dispatchEvent(new Event('ping'));
      const count = root.querySelector('#count')?.textContent ?? null;
      const uncoded = (rt.getDiagnostics() as Array<{ code: string; reason: string }>).filter((d) => !/^FORMA_E_[A-Z_]+$/.test(d.code)).map((d) => `${d.code}: ${d.reason}`);
      handle?.unmount();
      return { mountError, later, count, uncoded, rejected: (window as unknown as { __rejected: string[] }).__rejected.splice(0) };
    }, { markup: hostileModule(json), laters: [deep, '"#1"', json] });
    expect(r, name).toEqual({ mountError: null, later: [], count: '1', uncoded: [], rejected: [] });
  }
  expect(errors).toEqual([]);
});
