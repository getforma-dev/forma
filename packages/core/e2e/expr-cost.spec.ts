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
 * FORMA-172 in a real browser: an absolute cap on a `data-list` pass. A pass
 * over more than 24,000 of rows times row weight (1, and 1 for each element
 * and attribute of the row template) is refused before any item is read; a
 * list under the cap renders as it did, in the task that hands it its items.
 * Chromium runs at 4x CPU throttling, as sr33.spec.ts does; Firefox and WebKit
 * run unthrottled. Each test prints what it measured (the dot reporter CI uses
 * prints a test's console output), and asserts generously: the 50 ms bound is
 * on refusals that measure about a millisecond at 4x, and the passes that
 * build rows are only reported.
 */
const LIST_CAP = 24_000;

async function throttled(page: import('@playwright/test').Page, browserName: string): Promise<number> {
  if (browserName !== 'chromium') return 1;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return 4;
}

interface Pass { ms: number; built: number; budget: number }

/**
 * Mount a list whose items are `v`, build the items in a task of their own,
 * then time the task that hands them to the list (`setScopeValue`).
 */
async function listPass(page: import('@playwright/test').Page, html: string, data: string, rows: string, state: Record<string, unknown> = {}): Promise<Pass> {
  await page.evaluate(({ html, data, state }) => {
    const w = window as unknown as { FormaRuntime: any; __root?: Element; __handle?: { unmount(): void }; __data?: unknown };
    w.__handle?.unmount(); w.__root?.remove();
    w.FormaRuntime.clearDiagnostics();
    const root = document.createElement('div');
    const scope = document.createElement('div');
    scope.setAttribute('data-forma-state', JSON.stringify({ v: null, ...state }));
    scope.innerHTML = html; root.append(scope);
    const markup = w.FormaRuntime.trustedHtml(root.innerHTML);
    document.body.append(root);
    w.__handle = w.FormaRuntime.mountMarkup(root, markup, { tier: 'reviewed' });
    w.__root = root;
    w.__data = new Function(`return ${data}`)();
  }, { html, data, state });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  return page.evaluate((rows) => {
    const w = window as unknown as { FormaRuntime: any; __root: Element; __data: unknown };
    const start = performance.now();
    w.FormaRuntime.setScopeValue(w.__root.firstElementChild, 'v', w.__data);
    const ms = performance.now() - start;
    w.__data = undefined;
    const budget = (w.FormaRuntime.getDiagnostics() as Array<{ code: string }>).filter((d) => d.code === 'FORMA_E_BUDGET').length;
    return { ms, built: w.__root.querySelectorAll(rows).length, budget };
  }, rows);
}

const LI_LIST = '<ul data-list="{v === null ? [] : v}"><li>{item}</li></ul>';
const numbers = (n: number): string => `Array.from({length: ${n}}, (_, i) => i % 10)`;

test('FORMA-172: a data-list of 250,000 items is refused before any item is read, with no long task', async ({ page, browserName }) => {
  test.setTimeout(60_000);
  await page.goto('/runtime-bare.html');
  const rate = await throttled(page, browserName);
  const over = await listPass(page, LI_LIST, numbers(250_000), 'li');
  console.log(`FORMA-172 ${browserName} ${rate}x: 250,000 items (500,000 of rows x weight, cap ${LIST_CAP}) refused in ${over.ms.toFixed(1)} ms; rows built ${over.built}`);
  expect(over.built).toBe(0);
  expect(over.budget).toBe(1);
  expect(over.ms, `a ${over.ms.toFixed(1)} ms task`).toBeLessThan(50);

  // One row past the cap for the lightest row there is (weight 2): refused as cheaply.
  const past = await listPass(page, LI_LIST, numbers(LIST_CAP / 2 + 1), 'li');
  console.log(`FORMA-172 ${browserName} ${rate}x: ${LIST_CAP / 2 + 1} items (one row past the cap) refused in ${past.ms.toFixed(1)} ms`);
  expect(past.built).toBe(0);
  expect(past.budget).toBe(1);
  expect(past.ms).toBeLessThan(50);
});

test('FORMA-289: ordinary 1,000-row lists and cap-boundary rows fit the measured task budget', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await page.goto('/runtime-bare.html');
  const rate = await throttled(page, browserName);
  const table = '<table><tbody data-list="{v === null ? [] : v}"><tr data-key="{item.id}"><td>{item.id}</td><td data-text="{item.a}"></td><td data-text="{item.b}"></td><td data-class:odd="{item.c > 3}">{item.c}</td><td data-show="{item.d}">yes</td><td><b>{item.a}</b></td></tr></tbody></table>';
  const tableData = (n: number) => `Array.from({length: ${n}}, (_, i) => ({ id: i, a: 'a' + i, b: 'b' + i, c: i % 7, d: i % 2 === 0 }))`;
  const attributes = Array.from({ length: 22 }, (_, i) => `a${i}="v"`).join(' ');
  const cases = [
    { name: 'ordinary-li', weight: 2, html: LI_LIST, data: numbers, selector: 'li' },
    { name: 'directive-table', weight: 14, html: table, data: tableData, selector: 'tr' },
    { name: 'attribute-row', weight: 24, html: `<ul data-list="{v === null ? [] : v}"><li ${attributes}>{item}</li></ul>`, data: numbers, selector: 'li' },
  ];
  for (const row of cases) {
    const ordinary = await listPass(page, row.html, row.data(1000), row.selector);
    expect(ordinary.built, row.name).toBe(1000);
    expect(ordinary.budget, row.name).toBe(0);
    const count = Math.floor(LIST_CAP / row.weight), samples: number[] = [];
    for (let run = 0; run < 3; run++) {
      const at = await listPass(page, row.html, row.data(count), row.selector);
      expect(at.built, row.name).toBe(count);
      expect(at.budget, row.name).toBe(0);
      samples.push(at.ms);
    }
    const past = await listPass(page, row.html, row.data(count + 1), row.selector);
    expect(past.built, row.name).toBe(0);
    expect(past.budget, row.name).toBe(1);
    expect(past.ms, row.name).toBeLessThan(50);
    const maximumMs = Math.max(...samples), units = count * row.weight;
    console.log('FORMA-289 list budget', JSON.stringify({ browserName, platform: process.platform, rate, row: row.name, weight: row.weight, cap: LIST_CAP, rows: count, units, samplesMs: samples, maximumMs, usPerUnit: maximumMs * 1000 / units, ordinary1000Ms: ordinary.ms, refusedMs: past.ms }));
    // A measured regression guard for these ordinary shapes, not a claim about
    // arbitrary expensive elements, nested lists or repeated text placeholders.
    if (browserName === 'chromium' && process.platform === 'linux') {
      expect(maximumMs, `${row.name}: worst measured task at ${LIST_CAP} units`).toBeLessThanOrEqual(1000);
    }
  }
});
