import { test, expect, type Page } from '@playwright/test';

/**
 * FORMA-271 in a real engine: an allowlisted native or DOM method that throws
 * on its arguments is reported on its binding as `FORMA_E_CALL_FAILED`, and
 * neither escapes `mountMarkup` nor reaches the page as an uncaught error.
 *
 * Before, `{JSON.parse('{')}` and its kind threw out of `mountMarkup` and
 * left the module unbound, and in a handler they were uncaught page errors
 * with no diagnostic. The `classList` methods here throw only in a browser:
 * happy-dom's `classList.add('')` does not, Chromium's does. Chromium 156's
 * `scrollIntoView({behavior: 'bad'})` throws nothing: it returns a promise
 * that rejects, which is not a throw to convert (a gap SECURITY.md states).
 */
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

interface Outcome { mountError: string | null; codes: Array<[string, string, string]>; marked: string[]; ok: string | null }

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
      marked: [...root.querySelectorAll('[data-forma-expr-error],[data-forma-handler-error]')].map((e) => e.id),
      ok: root.querySelector('#ok')?.textContent ?? null,
    };
  }, { body, click });
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
    expect(r.codes[0]![2].startsWith(reason), r.codes[0]![2]).toBe(true);
    expect(r.marked, expr).toEqual(['bad']);
    expect(r.ok, expr).toBe('2');
  }
  expect(errors).toEqual([]);
});

test('a handler whose DOM method throws is reported on its element, not an uncaught page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  const cases: Array<[string, string]> = [
    [`$el.classList.add('')`, "$el.classList.add() threw SyntaxError: Failed to execute 'add' on 'DOMTokenList'"],
    [`$el.classList.add('a b')`, "$el.classList.add() threw InvalidCharacterError: Failed to execute 'add' on 'DOMTokenList'"],
    ['$el.classList.toggle(cls)', "$el.classList.toggle() threw SyntaxError: Failed to execute 'toggle' on 'DOMTokenList'"],
    [`$el.classList.replace('', 'x')`, "$el.classList.replace() threw SyntaxError: Failed to execute 'replace' on 'DOMTokenList'"],
    [`x = JSON.parse('{')`, 'JSON.parse() threw SyntaxError: '],
  ];
  for (const [handler, reason] of cases) {
    const r = await mount(page, `<button id="bad" data-on:click="{${handler}}">b</button><button id="inc" data-on:click="{n++}">+</button>`, ['bad', 'inc']);
    expect(r.mountError, handler).toBeNull();
    expect(r.codes.map(([code, e]) => [code, e]), handler).toEqual([['FORMA_E_CALL_FAILED', handler]]);
    expect(r.codes[0]![2].startsWith(reason), r.codes[0]![2]).toBe(true);
    expect(r.marked, handler).toEqual(['bad']);
    expect(r.ok, `${handler}: the handler beside it still runs`).toBe('3');
  }
  expect(errors).toEqual([]);
});

test("what can still throw out of mountMarkup in Chromium: the runtime's own writes for a data-class: or data-bind: with no name", async ({ page }) => {
  // Known gaps, stated in SECURITY.md: the runtime's own DOM writes, not an
  // allowlisted native call, so FORMA-271 leaves them as they were.
  for (const [body, name] of [['<p data-class:="{true}">x</p>', 'SyntaxError'], ['<p data-bind:="{1}">x</p>', 'InvalidCharacterError']]) {
    const r = await mount(page, body);
    expect(r.mountError?.split(':')[0], body).toBe(name);
  }
});
