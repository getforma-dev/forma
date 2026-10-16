import { afterEach, expect, it } from 'vitest';
import { clearDiagnostics, getDiagnostics, mountMarkup, trustedHtml } from '../runtime';

const handles: Array<ReturnType<typeof mountMarkup>> = [];
const hosts: Element[] = [];
afterEach(() => { for (const handle of handles.splice(0)) handle.unmount(); for (const host of hosts.splice(0)) host.remove(); clearDiagnostics(); });

for (const placement of ['document', 'fragment', 'shadow'] as const) {
  it(`binds nested list templates only in their row scope under a ${placement}`, () => {
    const root = document.createElement('div');
    if (placement === 'document') { document.body.append(root); hosts.push(root); }
    if (placement === 'fragment') document.createDocumentFragment().append(root);
    if (placement === 'shadow') { const host = document.createElement('div'); document.body.append(host); hosts.push(host); host.attachShadow({ mode: 'open' }).append(root); }
    clearDiagnostics();
    const markup = `<div data-forma-state='{"rows":[{"id":"a","value":"initial"}]}'>
      <p data-text="{rows.length}"></p><ul data-list="{rows}"><li data-key="{item.id}"><div><textarea data-model="{item.value}"></textarea><span data-text="{item.value}"></span></div></li></ul></div>`;
    handles.push(mountMarkup(root, trustedHtml(markup), { tier: 'reviewed', grants: {} }));
    const input = root.querySelector('textarea')!;
    expect(input.value).toBe('initial'); expect(root.querySelector('span')!.textContent).toBe('initial');
    expect(getDiagnostics()).toEqual([]);
    input.value = 'edited'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const scope = (root.firstElementChild as Element & { __formaScope: { getters: { rows: () => Array<{ value: string }> }; setters: { rows: (rows: unknown[]) => void } } }).__formaScope;
    expect(scope.getters.rows()[0]!.value).toBe('edited');
    scope.setters.rows([{ id: 'a', value: 'updated' }]);
    expect(root.querySelector('textarea')).toBe(input); expect(input.value).toBe('updated');
    expect(root.querySelector('span')!.textContent).toBe('updated'); expect(getDiagnostics()).toEqual([]);
  });
}

it('still reports a real forbidden row expression while the nested model remains usable', () => {
  const root = document.createElement('div'); document.body.append(root); hosts.push(root); clearDiagnostics();
  handles.push(mountMarkup(root, trustedHtml(`<div data-forma-state='{"rows":[{"value":"safe"}]}'>
    <ul data-list="{rows}"><li><textarea data-model="{item.value}"></textarea><span data-text="{item.constructor}">kept</span></li></ul></div>`), { tier: 'reviewed', grants: {} }));
  expect(root.querySelector('textarea')!.value).toBe('safe'); expect(root.querySelector('span')!.textContent).toBe('kept');
  expect(getDiagnostics().map(item => item.code)).toEqual(['FORMA_E_KEY_DENIED']);
});
