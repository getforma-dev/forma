# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full-stack.spec.ts >> HTML Runtime — data-* directives >> binds only the owned root and stops responding when its handle unmounts
- Location: e2e/full-stack.spec.ts:94:7

# Error details

```
Test timeout of 15000ms exceeded.
```

```
Error: page.click: Test timeout of 15000ms exceeded.
Call log:
  - waiting for locator('#rt-inc')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - paragraph [ref=e3]: unbound
    - button "Unowned +1" [ref=e4]
  - generic [ref=e6]:
    - text: "0"
    - button "h() +1" [ref=e7]
  - generic [ref=e9]:
    - text: "0"
    - button "Template +1" [ref=e10]
```

# Test source

```ts
  4   |  * Verifies the complete Forma pipeline in a real browser:
  5   |  *   1. HTML Runtime (data-* directives) — explicitly owned reviewed markup
  6   |  *   2. Programmatic h() API — createSignal + h() + mount()
  7   |  *   3. Reviewed template path — template(trustedHtml()) + cloneNode()
  8   |  *
  9   |  * Run: npx playwright test
  10  |  * Guide: See e2e/README.md
  11  |  */
  12  | import { test, expect } from '@playwright/test';
  13  | 
  14  | // The two FormaJS bundles the page loads are written by e2e/sync-fixtures.sh
  15  | // from packages/core/dist and are not tracked: a committed copy is only ever
  16  | // stale (the one tracked until 2026-10-15 predated trustedHtml() and failed
  17  | // five cases here, FORMA-105). Refuse to run against a missing bundle, and
  18  | // against one that lacks the public API full-stack.html calls, naming the fix.
  19  | test('the bundles are the fresh sync, not a stale copy', async ({ request }) => {
  20  |   for (const name of ['formajs-runtime.global.js', 'formajs.global.js']) {
  21  |     const response = await request.get(`/${name}`);
  22  |     expect(response.status(), `e2e/fixtures/${name} is missing; run bash e2e/sync-fixtures.sh`).toBe(200);
  23  |   }
  24  |   const bundle = await (await request.get('/formajs.global.js')).text();
  25  |   expect(bundle, 'e2e/fixtures/formajs.global.js is stale (no trustedHtml); run bash e2e/sync-fixtures.sh').toContain('trustedHtml');
  26  | });
  27  | 
  28  | test.beforeEach(async ({ page }) => {
  29  |   await page.goto('/full-stack.html');
  30  | });
  31  | 
  32  | // ═══════════════════════════════════════════════════════════════════════
  33  | // Test 1: HTML Runtime (data-* directives)
  34  | // ═══════════════════════════════════════════════════════════════════════
  35  | 
  36  | test.describe('HTML Runtime — data-* directives', () => {
  37  |   test('renders initial state as text', async ({ page }) => {
  38  |     await expect(page.locator('#rt-text')).toHaveText('Hello World');
  39  |     await expect(page.locator('#rt-count')).toHaveText('0');
  40  |   });
  41  | 
  42  |   test('increments counter on click', async ({ page }) => {
  43  |     await page.click('#rt-inc');
  44  |     await expect(page.locator('#rt-count')).toHaveText('1');
  45  |     await page.click('#rt-inc');
  46  |     await expect(page.locator('#rt-count')).toHaveText('2');
  47  |   });
  48  | 
  49  |   test('resets counter', async ({ page }) => {
  50  |     await page.click('#rt-inc');
  51  |     await page.click('#rt-inc');
  52  |     await expect(page.locator('#rt-count')).toHaveText('2');
  53  |     await page.click('#rt-reset');
  54  |     await expect(page.locator('#rt-count')).toHaveText('0');
  55  |   });
  56  | 
  57  |   test('two-way binding with data-model', async ({ page }) => {
  58  |     await page.fill('#rt-input', 'Forma');
  59  |     await expect(page.locator('#rt-text')).toHaveText('Hello Forma');
  60  |   });
  61  | 
  62  |   test('data-show toggles visibility', async ({ page }) => {
  63  |     // count=0, should be hidden
  64  |     await expect(page.locator('#rt-show')).toBeHidden();
  65  |     await page.click('#rt-inc');
  66  |     // count=1, should be visible
  67  |     await expect(page.locator('#rt-show')).toBeVisible();
  68  |     await page.click('#rt-reset');
  69  |     // count=0 again, hidden
  70  |     await expect(page.locator('#rt-show')).toBeHidden();
  71  |   });
  72  | 
  73  |   test('data-class toggles CSS class', async ({ page }) => {
  74  |     await expect(page.locator('#rt-class')).not.toHaveClass(/active/);
  75  |     // Click 3 times to get count > 2
  76  |     await page.click('#rt-inc');
  77  |     await page.click('#rt-inc');
  78  |     await page.click('#rt-inc');
  79  |     await expect(page.locator('#rt-class')).toHaveClass(/active/);
  80  |   });
  81  | 
  82  |   test('data-computed derives values', async ({ page }) => {
  83  |     await expect(page.locator('#rt-computed')).toHaveText('0');
  84  |     await page.click('#rt-inc');
  85  |     await expect(page.locator('#rt-computed')).toHaveText('2');
  86  |     await page.click('#rt-inc');
  87  |     await expect(page.locator('#rt-computed')).toHaveText('4');
  88  |   });
  89  | 
  90  |   test('$refs resolves data-ref elements', async ({ page }) => {
  91  |     await expect(page.locator('#rt-ref-check')).toHaveText('ref-found');
  92  |   });
  93  | 
  94  |   test('binds only the owned root and stops responding when its handle unmounts', async ({ page }) => {
  95  |     await expect(page.locator('#rt-outside-count')).toHaveText('unbound');
  96  |     await page.click('#rt-outside-inc');
  97  |     await expect(page.locator('#rt-outside-count')).toHaveText('unbound');
  98  |     // The same bundle is demonstrably live inside the explicitly handed root.
  99  |     await page.click('#rt-inc');
  100 |     await expect(page.locator('#rt-count')).toHaveText('1');
  101 |     await page.evaluate(() => {
  102 |       (window as Window & { fullStackRuntimeHandle: { unmount(): void } }).fullStackRuntimeHandle.unmount();
  103 |     });
> 104 |     await page.click('#rt-inc');
      |                ^ Error: page.click: Test timeout of 15000ms exceeded.
  105 |     await expect(page.locator('#rt-count')).toHaveText('1');
  106 |     await expect(page.locator('#rt-outside-count')).toHaveText('unbound');
  107 |   });
  108 | });
  109 | 
  110 | // ═══════════════════════════════════════════════════════════════════════
  111 | // Test 2: Programmatic h() API
  112 | // ═══════════════════════════════════════════════════════════════════════
  113 | 
  114 | test.describe('Programmatic h() API', () => {
  115 |   test('mount() renders h() tree into DOM', async ({ page }) => {
  116 |     await expect(page.locator('#h-container')).toBeVisible();
  117 |     await expect(page.locator('#h-count')).toHaveText('0');
  118 |   });
  119 | 
  120 |   test('signal updates DOM reactively', async ({ page }) => {
  121 |     await page.click('#h-btn');
  122 |     await expect(page.locator('#h-count')).toHaveText('1');
  123 |     await page.click('#h-btn');
  124 |     await expect(page.locator('#h-count')).toHaveText('2');
  125 |   });
  126 | });
  127 | 
  128 | // ═══════════════════════════════════════════════════════════════════════
  129 | // Test 3: Reviewed template path (public API)
  130 | // ═══════════════════════════════════════════════════════════════════════
  131 | 
  132 | test.describe('Reviewed template path — template() + cloneNode()', () => {
  133 |   test('template creates DOM from reviewed markup', async ({ page }) => {
  134 |     await expect(page.locator('#tpl-container')).toBeVisible();
  135 |   });
  136 | 
  137 |   test('cloneNode produces working DOM with reactive text', async ({ page }) => {
  138 |     await expect(page.locator('#tpl-count')).toHaveText('0');
  139 |   });
  140 | 
  141 |   test('createEffect updates cloned text node on signal change', async ({ page }) => {
  142 |     await page.click('#tpl-btn');
  143 |     await expect(page.locator('#tpl-count')).toHaveText('1');
  144 |     await page.click('#tpl-btn');
  145 |     await expect(page.locator('#tpl-count')).toHaveText('2');
  146 |     await page.click('#tpl-btn');
  147 |     await expect(page.locator('#tpl-count')).toHaveText('3');
  148 |   });
  149 | });
  150 | 
  151 | // ═══════════════════════════════════════════════════════════════════════
  152 | // Test 4: Cross-cutting concerns
  153 | // ═══════════════════════════════════════════════════════════════════════
  154 | 
  155 | test.describe('Cross-cutting', () => {
  156 |   test('no browser errors on page load', async ({ page }) => {
  157 |     const errors: string[] = [];
  158 |     page.on('pageerror', error => errors.push(error.message));
  159 |     page.on('console', msg => {
  160 |       if (msg.type() === 'error') errors.push(msg.text());
  161 |     });
  162 |     await page.goto('/full-stack.html');
  163 |     await page.waitForTimeout(500);
  164 |     expect(errors).toEqual([]);
  165 |   });
  166 | 
  167 |   test('all three approaches coexist on same page', async ({ page }) => {
  168 |     // Runtime
  169 |     await expect(page.locator('#rt-count')).toHaveText('0');
  170 |     // h() API
  171 |     await expect(page.locator('#h-count')).toHaveText('0');
  172 |     // Compiled template
  173 |     await expect(page.locator('#tpl-count')).toHaveText('0');
  174 | 
  175 |     // Click all three independently
  176 |     await page.click('#rt-inc');
  177 |     await page.click('#h-btn');
  178 |     await page.click('#tpl-btn');
  179 | 
  180 |     // Each updates independently
  181 |     await expect(page.locator('#rt-count')).toHaveText('1');
  182 |     await expect(page.locator('#h-count')).toHaveText('1');
  183 |     await expect(page.locator('#tpl-count')).toHaveText('1');
  184 |   });
  185 | });
  186 | 
```