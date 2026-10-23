import { test, expect } from '@playwright/test';

/**
 * DR-16 in a real browser: the audit's run 4, as a regression test.
 *
 * `Array.from({length: 12000000})` in a `data-text` binding used to build a
 * twelve-million-element array in a 300 ms task and only then report
 * `FORMA_E_BUDGET`. The preflight refuses it before the native runs, so the
 * binding is refused with the same code, the page keeps its server text, and
 * no task on the page reaches 50 ms. The control binding beside it renders.
 */
test('a hostile Array.from in a binding is refused before it allocates, with no long task', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/expr-cost.html');
  await expect(page.locator('#control')).toHaveText('1000');
  await expect(page.locator('#hostile')).toHaveText('unset');

  const diagnostics = await page.evaluate(
    () => (window as unknown as { FormaRuntime: { getDiagnostics(): Array<{ code: string; expr: string }> } })
      .FormaRuntime.getDiagnostics(),
  );
  expect(diagnostics.map((d) => [d.code, d.expr])).toEqual([
    ['FORMA_E_BUDGET', 'Array.from({length: 12000000}).length'],
  ]);

  // Let the observer deliver, then read every long task the page had.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  expect(longTasks.filter((ms) => ms >= 50), `long tasks: ${longTasks.join(', ')} ms`).toEqual([]);
  expect(errors).toEqual([]);
});

/**
 * FORMA-028 and FORMA-025 in a real browser, on a bare page each test mounts
 * its widget into. Every task the widget causes is timed: the mount, and each
 * timer callback the runtime schedules (the task budget's retry), through a
 * setTimeout wrapper installed before the runtime loads. Unthrottled here, so
 * a slow CI runner cannot flip the verdict; the same cases at 4x CPU
 * throttling are measured by scripts/measure-alloc-budget.mjs and recorded in
 * the CHANGELOG.
 */
function timeTasks(): void {
  const real = window.setTimeout.bind(window);
  const w = window as unknown as { __tasks: number[] };
  w.__tasks = [];
  window.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => real(() => {
    const start = performance.now();
    try {
      fn(...rest);
    } finally {
      w.__tasks.push(performance.now() - start);
    }
  }, ms)) as typeof window.setTimeout;
}

interface Mounted { mountMs: number; texts: string[]; codes: string[] }

async function mountWidget(page: import('@playwright/test').Page, html: string, state = '{}'): Promise<Mounted> {
  // A fresh task for the mount, as sr33.spec.ts starts one for each case. The
  // runtime zeroes its task meter on a timer the previous mount armed; two
  // evaluates in a row can run before it (WebKit did, in CI: FORMA-179), and
  // the second widget then counts on from the first one's spending, so its
  // refusal waits for a retry instead of being reported. Timers of equal delay
  // run in order, so after this one the runtime's has run.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  return page.evaluate(({ html, state }) => {
    const w = window as unknown as { FormaRuntime: any; __root?: Element; __handle?: { unmount(): void } };
    w.__handle?.unmount(); w.__root?.remove();
    w.FormaRuntime.clearDiagnostics();
    const root = document.createElement('div');
    const scope = document.createElement('div');
    scope.setAttribute('data-forma-state', state); scope.innerHTML = html; root.append(scope);
    const markup = w.FormaRuntime.trustedHtml(root.innerHTML);
    document.body.append(root);
    const start = performance.now();
    w.__handle = w.FormaRuntime.mountMarkup(root, markup, { tier: 'reviewed' });
    const mountMs = performance.now() - start;
    w.__root = root;
    return {
      mountMs,
      texts: [...root.querySelectorAll('[data-out]')].map((e) => e.textContent ?? ''),
      codes: (w.FormaRuntime.getDiagnostics() as Array<{ code: string }>).map((d) => d.code),
    };
  }, { html, state });
}

const rope = (k: number): string => `Array.from({length: ${k}}).reduce((a) => a + a, 'x')`;

test('FORMA-028: each round-2 rope case is refused before the long task', async ({ page }) => {
  await page.addInitScript(timeTasks);
  await page.goto('/runtime-bare.html');
  const cases = {
    charCodeAt: `[${rope(19)}].map(big => Array.from({length: 15000}).map(() => (big + 'y').charCodeAt(0)).length)[0]`,
    index: `[${rope(19)}].map(big => Array.from({length: 15000}).map(() => (big + 'y')[0]).length)[0]`,
    equality: `[${rope(19)}].map(big => Array.from({length: 12000}).filter(() => big + 'y' === big + 'z').length)[0]`,
    sort: `[${rope(19)}].map(big => Array.from({length: 2000}).map((_, i) => big + i).sort().length)[0]`,
  };
  for (const [name, src] of Object.entries(cases)) {
    const m = await mountWidget(page, `<p data-out data-text="{${src}}">server</p>`);
    expect(m.codes, name).toEqual(['FORMA_E_BUDGET']);
    expect(m.texts, name).toEqual(['server']);
    expect(m.mountMs, `${name}: a ${m.mountMs.toFixed(1)} ms task`).toBeLessThan(50);
  }
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  expect(longTasks.filter((ms) => ms >= 50), `long tasks: ${longTasks.join(', ')} ms`).toEqual([]);
});

test('FORMA-028: ten bindings at the cap render one task at a time, none over 50 ms', async ({ page }) => {
  await page.addInitScript(timeTasks);
  await page.goto('/runtime-bare.html');
  const binding = '<p data-out data-text="{Array.from({length: 249990}).length}">server</p>';
  const m = await mountWidget(page, binding.repeat(10));
  // One budget per task: the mount task answers one binding; the rest wait.
  expect(m.texts.filter((t) => t === '249990')).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[data-out]')].map((e) => e.textContent)))
    .toEqual(Array(10).fill('249990'));
  const r = await page.evaluate(() => ({
    tasks: (window as unknown as { __tasks: number[] }).__tasks,
    codes: ((window as unknown as { FormaRuntime: any }).FormaRuntime.getDiagnostics() as Array<{ code: string }>).map((d) => d.code),
    longTasks: (window as unknown as { __longTasks: number[] }).__longTasks,
  }));
  expect(r.codes).toEqual([]);
  expect(r.tasks.length).toBeGreaterThanOrEqual(9);
  for (const ms of [m.mountMs, ...r.tasks]) expect(ms).toBeLessThan(50);
  expect(r.longTasks.filter((ms) => ms >= 50)).toEqual([]);
});

test('FORMA-025: data-text of a value heavier than the budget is refused before it is converted', async ({ page }) => {
  await page.addInitScript(() => {
    // String() of the hostile list would call join on it: count that.
    const join = Array.prototype.join;
    const w = window as unknown as { __joined: number };
    w.__joined = 0;
    Array.prototype.join = function (this: unknown[], ...a: unknown[]) {
      if (this.length === 1000 && typeof this[0] === 'string' && (this[0] as string).length === 300_000) w.__joined++;
      return Reflect.apply(join, this, a);
    } as typeof join;
  });
  await page.goto('/runtime-bare.html');
  const html = '<p data-out data-text="{Array.from({length: 1000}).map(() => s)}">server</p>'
    + '<p data-out data-text="{Array.from({length: 3}).map(() => s.slice(0, 2))}">server</p>';
  // Three mounts, and the 50 ms bound on the least of them (FORMA-179): a
  // refusal that converted the list would take seconds every time, where one
  // noisy sample, a collection or a busy runner, once took 169 ms in Firefox,
  // unthrottled (run 38628163922). The join is counted across all three.
  const mounts: Mounted[] = [];
  for (let i = 0; i < 3; i++) mounts.push(await mountWidget(page, html, JSON.stringify({ s: 'x'.repeat(300_000) })));
  for (const m of mounts) {
    expect(m.codes).toEqual(['FORMA_E_BUDGET']);
    expect(m.texts).toEqual(['server', 'xx,xx,xx']);
  }
  expect(await page.evaluate(() => (window as unknown as { __joined: number }).__joined)).toBe(0);
  expect(Math.min(...mounts.map((m) => m.mountMs)), `mounts: ${mounts.map((m) => m.mountMs.toFixed(1)).join(', ')} ms`).toBeLessThan(50);
});

/**
 * FORMA-172 in a real browser: a `data-list` row is priced against the task's
 * budget. Before, a list built a row of DOM for every item, however cheap the
 * expression that produced them: `Array.from({length: 249990})` was 249,990
 * template clones, about 0.9 s unthrottled and 3.5 s at 4x. Now the list is
 * refused with the budget's code before a row is built (the cost left is the
 * expression's own `Array.from`), and so is a list of 250,000 numbers from
 * state; a list of 1,000 rows renders in the mount task as before, and four
 * lists of 1,000 rows in one widget render over more than one task. Unthrottled
 * here, as the cases above are; scripts/measure-task-budget.mjs (group L)
 * measures the same cases at 4x.
 */
test('FORMA-172: a data-list over 250,000 items is refused with no long task, and 1,000 rows render', async ({ page }) => {
  await page.addInitScript(timeTasks);
  await page.goto('/runtime-bare.html');
  const list = (expr: string): string => `<ul data-out data-list="{${expr}}"><li>{item}</li></ul>`;
  const rows = (): Promise<number> => page.locator('li').count();

  const made = await mountWidget(page, list('Array.from({length: 249990})'));
  expect(made.codes).toEqual(['FORMA_E_BUDGET']);
  expect(await rows()).toBe(0);
  expect(made.mountMs, `a ${made.mountMs.toFixed(1)} ms task`).toBeLessThan(50);

  const fromState = await mountWidget(page, list('rows'), JSON.stringify({ rows: Array.from({ length: 250_000 }, (_, i) => i % 10) }));
  expect(fromState.codes).toEqual(['FORMA_E_BUDGET']);
  expect(await rows()).toBe(0);
  expect(fromState.mountMs, `a ${fromState.mountMs.toFixed(1)} ms task`).toBeLessThan(50);

  const ordinary = await mountWidget(page, list('rows'), JSON.stringify({ rows: Array.from({ length: 1000 }, (_, i) => i % 10) }));
  expect(ordinary.codes).toEqual([]);
  expect(await rows()).toBe(1000);
  expect(ordinary.mountMs, `a ${ordinary.mountMs.toFixed(1)} ms task`).toBeLessThan(50);

  // Four lists of 1,000 rows are 400,000 units: two to a task, never reported.
  const four = ['a', 'b', 'c', 'd'].map((k) => list(`rows.${k}`)).join('');
  const state = Object.fromEntries(['a', 'b', 'c', 'd'].map((k) => [k, Array.from({ length: 1000 }, (_, i) => i % 10)]));
  const shared = await mountWidget(page, four, JSON.stringify({ rows: state }));
  expect(shared.texts.map((t) => t.length)).toEqual([1000, 1000, 0, 0]);
  await expect.poll(rows).toBe(4000);
  expect(await page.evaluate(() => ((window as unknown as { FormaRuntime: any }).FormaRuntime.getDiagnostics() as unknown[]).length)).toBe(0);
  expect(shared.mountMs).toBeLessThan(50);

  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  expect(longTasks.filter((ms) => ms >= 50), `long tasks: ${longTasks.join(', ')} ms`).toEqual([]);
});
