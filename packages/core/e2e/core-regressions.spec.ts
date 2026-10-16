import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { serveOwnedAdoption } from './helpers/owned-adoption.js';

// Optional installed Chrome is useful on machines without Playwright's bundle.
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

test.beforeEach(async ({ page }) => {
  await serveOwnedAdoption(page, '/core-regression.mjs');
  await page.route('**/core-regression.mjs', (route) => route.fulfill({
    path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)),
    contentType: 'text/javascript',
  }));
  await page.route('**/core-regression.html', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body><main id="app"></main></body></html>',
  }));
  await page.goto('/core-regression.html');
});

test('HTML prototype clones keep template and form-control state private', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const coreUrl = '/core-regression.mjs';
    const { h } = await import(coreUrl);
    const template = h('template') as HTMLTemplateElement;
    template.content.appendChild(document.createTextNode('private template'));
    const input = h('input') as HTMLInputElement;
    input.value = 'private input'; input.defaultValue = 'private default';
    input.checked = true; input.defaultChecked = true; input.disabled = true;
    const textarea = h('textarea') as HTMLTextAreaElement;
    textarea.value = 'private textarea'; textarea.defaultValue = 'private default';
    const option = h('option') as HTMLOptionElement;
    option.textContent = 'private option'; option.value = 'private value';
    option.selected = true; option.defaultSelected = true; option.disabled = true;
    const form = h('form') as HTMLFormElement;
    form.setAttribute('data-private', 'first'); form.append(input, textarea);

    const nextTemplate = h('template') as HTMLTemplateElement;
    const nextInput = h('input') as HTMLInputElement;
    const nextTextarea = h('textarea') as HTMLTextAreaElement;
    // Observe the option before insertion: a select may select its first option.
    const nextOption = h('option') as HTMLOptionElement;
    const nextForm = h('form') as HTMLFormElement;
    class Custom extends HTMLElement { readonly state = { touched: false }; }
    customElements.define('forma-prototype-private', Custom);
    const custom = h('forma-prototype-private') as Custom;
    custom.state.touched = true;
    const nextCustom = h('forma-prototype-private') as Custom;
    return {
      changed: [template.content.textContent, input.value, input.checked, textarea.value,
        option.selected, option.defaultSelected, form.elements.length, custom.state.touched],
      independent: [template !== nextTemplate, input !== nextInput, textarea !== nextTextarea,
        option !== nextOption, form !== nextForm, custom !== nextCustom, custom.state !== nextCustom.state],
      template: [nextTemplate.content.childNodes.length, nextTemplate.attributes.length],
      input: [nextInput.value, nextInput.defaultValue, nextInput.checked, nextInput.defaultChecked,
        nextInput.disabled, nextInput.attributes.length],
      textarea: [nextTextarea.value, nextTextarea.defaultValue, nextTextarea.childNodes.length],
      option: [nextOption.textContent, nextOption.value, nextOption.selected, nextOption.defaultSelected,
        nextOption.disabled, nextOption.hasAttribute('selected'), nextOption.attributes.length],
      form: [nextForm.elements.length, nextForm.childNodes.length, nextForm.attributes.length],
      custom: [custom instanceof Custom, nextCustom instanceof Custom, nextCustom.state.touched],
    };
  });
  expect(result).toEqual({
    changed: ['private template', 'private input', true, 'private textarea', true, true, 2, true],
    independent: [true, true, true, true, true, true, true],
    template: [0, 0], input: ['', '', false, false, false, 0], textarea: ['', '', 0],
    option: ['', '', false, false, false, false, 0], form: [0, 0, 0], custom: [true, true, false],
  });
});

test('controlled input, textarea, checkbox and non-first selections survive real user edits', async ({ page }) => {
  await page.evaluate(async () => {
    const coreUrl = '/core-regression.mjs';
    const { h, mount, createSignal } = await import(coreUrl);
    const [state, setState] = createSignal({ value: 'Saved notes', checked: true, cycle: 'yearly' });
    (window as any).resetControls = () => setState({ value: 'Saved notes', checked: true, cycle: 'yearly' });
    mount(() => h('form', null,
      h('input', { id: 'text', value: () => state().value }),
      h('textarea', { id: 'notes', value: () => state().value }),
      h('input', { id: 'checked', checked: () => state().checked, type: 'checkbox' }),
      h('select', { id: 'cycle', value: () => state().cycle },
        h('option', { value: 'monthly' }, 'Monthly'), h('option', { value: 'yearly' }, 'Yearly')),
      h('select', { id: 'month', value: 9 },
        h('option', { value: 1 }, 'January'), h('option', { value: 9 }, 'September')),
    ), '#app');
  });
  await expect(page.locator('#cycle')).toHaveValue('yearly');
  await expect(page.locator('#month')).toHaveValue('9');
  await expect(page.locator('#notes')).toHaveValue('Saved notes');
  await page.locator('#text').fill('User changed this');
  await page.locator('#notes').fill('User changed these notes');
  await page.locator('#checked').uncheck();
  await page.locator('#cycle').selectOption('monthly');
  await page.evaluate(() => (window as any).resetControls());
  await expect(page.locator('#text')).toHaveValue('Saved notes');
  await expect(page.locator('#notes')).toHaveValue('Saved notes');
  await expect(page.locator('#checked')).toBeChecked();
  await expect(page.locator('#cycle')).toHaveValue('yearly');
});

test('multiple select changes update the browser live selection collection', async ({ page }) => {
  await page.evaluate(async () => {
    const coreUrl = '/core-regression.mjs';
    const { h, mount, createSignal } = await import(coreUrl);
    const [values, setValues] = createSignal(['b', 'c']);
    (window as any).clearSelection = () => setValues([]);
    mount(() => h('select', { id: 'multi', value: values, multiple: true },
      ['a', 'b', 'c'].map((value) => h('option', { value }, value))), '#app');
  });
  await expect(page.locator('#multi')).toHaveValues(['b', 'c']);
  await page.evaluate(() => (window as any).clearSelection());
  await expect(page.locator('#multi')).toHaveValues([]);
});

test('same-key rerenders dispose old reactive generations; unchanged objects retain focused DOM', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const coreUrl = '/core-regression.mjs';
    const { h, mount, createSignal, createEffect, createList } = await import(coreUrl);
    const original = { id: 1, label: 'A' };
    const [items, setItems] = createSignal([original]);
    const [tick, setTick] = createSignal(0);
    let created = 0;
    let disposed = 0;
    const spans: HTMLElement[] = [];
    const unmount = mount(() => h('div', null, createList(items, (item: any) => item.id, (item: any) => {
      createEffect(() => { created++; return () => disposed++; });
      const span = h('span', null, () => `${item.label}:${tick()}`);
      spans.push(span);
      return h('button', { onClick: () => {} }, span);
    }, { updateOnItemChange: 'rerender' })), '#app');
    const button = document.querySelector('button')!;
    button.focus();
    setItems([original]);
    const focusPreserved = document.activeElement === button;
    setItems([{ id: 1, label: 'B' }]);
    setItems([{ id: 1, label: 'C' }]);
    setTick(1);
    const generations = spans.map((span) => span.textContent);
    unmount();
    setTick(2);
    return { created, disposed, generations, focusPreserved, after: spans.map((span) => span.textContent) };
  });
  expect(result).toEqual({ created: 3, disposed: 3, focusPreserved: true,
    generations: ['A:0', 'B:0', 'C:1'], after: ['A:0', 'B:0', 'C:1'] });
});

test('SSR adoption refuses mismatched older properties and keeps matching controls live', async ({ page }) => {
  await page.evaluate(async () => {
    const coreUrl = '/core-regression.mjs';
    const { h, createSignal } = await import(coreUrl);
    const { adoptMatching, adoptRefused } = await import('/test-owned-adoption.mjs' as string);
    const root = document.querySelector('#app')!;
    root.setAttribute('data-forma-ssr', '');
    root.innerHTML = '<form><textarea id="old-notes" value="Saved notes"></textarea><select id="old-cycle" value="yearly"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></form>';
    const [oldValue, setOldValue] = createSignal('yearly');
    adoptRefused(() => h('form', null,
      h('textarea', { id: 'old-notes', value: 'Saved notes' }),
      h('select', { id: 'old-cycle', value: oldValue },
        h('option', { value: 'monthly' }, 'Monthly'), h('option', { value: 'yearly' }, 'Yearly')),
    ), root, 'FORMA_E_HYDRATE_VALUE');
    setOldValue('weekly');
    const matching = document.createElement('section');matching.id='matching';matching.setAttribute('data-forma-ssr','');
    matching.innerHTML='<form><textarea id="notes">Saved notes</textarea><select id="cycle"><option value="monthly">Monthly</option><option value="yearly" selected>Yearly</option></select></form>';
    document.body.append(matching);
    const [value,setValue]=createSignal('yearly');(window as any).selectMonthly=()=>setValue('monthly');
    adoptMatching(() => h('form', null,
      h('textarea', { id: 'notes', value: 'Saved notes' }),
      h('select', { id: 'cycle', value },h('option', { value: 'monthly' }, 'Monthly'),h('option', { value: 'yearly' }, 'Yearly')),
    ),matching);
  });
  await expect(page.locator('#old-notes')).toHaveValue('');await expect(page.locator('#old-cycle')).toHaveValue('monthly');
  await expect(page.locator('#notes')).toHaveValue('Saved notes');await expect(page.locator('#cycle')).toHaveValue('yearly');
  await page.evaluate(() => (window as any).selectMonthly());await expect(page.locator('#cycle')).toHaveValue('monthly');
});
