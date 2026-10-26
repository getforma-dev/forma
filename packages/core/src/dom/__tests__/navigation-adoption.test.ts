/** FORMA-301 experimental scope proof: this is not native transport qualification. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from '../element.js';
import { activateIslands, __prepareNavigationIslands } from '../activate.js';
import { __islandRegistration, prepareNavigationIslandState, activateNavigationIslandState, checkIslandClaim, matchAdoptionChild } from '../island-state.js';
import { __adoptionChild, withAdoptionDescription, type ComponentDescription } from '../adoption-description.js';
import { compiled, FIXTURE_HASH, installState, useFreshDocument } from './helpers/compiled-island.js';

const scopes: ReturnType<typeof __prepareNavigationIslands>[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); vi.restoreAllMocks(); });
function route(label = 'new', trigger = 'load') {
  const root = document.createElement('main');
  root.innerHTML = `<section data-forma-island="0" data-forma-state="0" data-forma-component="Page" data-forma-h="${FIXTURE_HASH}" data-forma-hydrate="${trigger}"><button>${label}</button></section>`;
  return root;
}
function state(label = 'new') { return JSON.stringify({ v: 1, s: [], i: [{ h: FIXTURE_HASH, p: { label } }] }); }
function registry(click = vi.fn()) {
  const component = vi.fn((props: { label: string }) => h('section', null, h('button', { onClick: click }, props.label)));
  return { component, click, value: { Page: compiled(component, [[{ name: 'label', type: { kind: 'string' } }]]) } };
}
function prepare(root: HTMLElement, entries = state(), definition = registry()) {
  const scope = __prepareNavigationIslands(definition.value, root, entries);
  scopes.push(scope);
  return { scope, ...definition };
}

describe('experimental navigation adoption scope', () => {
  it('prepares without component calls, adopts exact nodes once, and disposes their listeners', async () => {
    const root = route();
    const before = root.innerHTML;
    const button = root.querySelector('button')!;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
    const { scope, component, click } = prepare(root);
    expect(component).not.toHaveBeenCalled();
    expect(root.innerHTML).toBe(before);
    expect(() => scope.activate()).toThrow('FORMA_E_ISLAND_IDENTITY');
    document.body.append(root);
    const ready = scope.activate();
    expect(scope.activate()).toBe(ready);
    await ready;
    expect(component).toHaveBeenCalledOnce();
    expect(root.querySelector('button')).toBe(button);
    expect(root.innerHTML).toBe(before);
    expect([...mutations, ...observer.takeRecords()]).toEqual([]);
    observer.disconnect();
    button.click();
    expect(click).toHaveBeenCalledOnce();
    scope.dispose(); scope.dispose();
    button.click();
    expect(click).toHaveBeenCalledOnce();
    expect(() => scope.activate()).toThrow('disposed');
  });

  it('keeps initial Document claims frozen while fresh route scopes may reuse occurrence zero', async () => {
    const initial = route('initial');
    document.body.append(initial);
    installState([{ label: 'initial' }]);
    const initialRegistry = registry();
    await activateIslands(initialRegistry.value);
    const incoming = route();
    const incomingRegistry = registry();
    const { scope } = prepare(incoming, state(), incomingRegistry);
    document.body.append(incoming);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await activateIslands(incomingRegistry.value, incoming);
    expect(incomingRegistry.component).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('FORMA_E_ISLAND_IDENTITY'));
    await scope.activate();
    expect(incomingRegistry.component).toHaveBeenCalledExactlyOnceWith({ label: 'new' });
    expect(initialRegistry.component).toHaveBeenCalledExactlyOnceWith({ label: 'initial' });
    expect(document.head.querySelector('[data-island-state]')!.textContent).toContain('initial');
    scope.dispose();
    initial.querySelector('button')!.click();
    expect(initialRegistry.click).toHaveBeenCalledOnce();
  });

  it('refuses live roots, duplicate occurrences, invalid schema and browser-only registrations before activation', () => {
    const live = route(); document.body.append(live);
    expect(() => prepare(live)).toThrow('fresh detached');
    const duplicate = route(); duplicate.append(duplicate.firstElementChild!.cloneNode(true));
    expect(() => prepare(duplicate)).toThrow('duplicate');
    const schema = state().replace('"label":"new"', '"label":3');
    expect(() => prepare(route(), schema)).toThrow('FORMA_E_ISLAND_SCHEMA');
    expect(() => prepare(route(), '{')).toThrow('FORMA_E_ISLAND_STATE');
    expect(() => __prepareNavigationIslands({ Page: __islandRegistration(() => h('div'), { h: FIXTURE_HASH, schema: [[]], mode: 1 }) }, route(), state())).toThrow('adopting registrations');
  });

  it('rejects changed claims and changed host sets before arming any component', () => {
    const changed = route(); const first = prepare(changed);
    changed.querySelector('section')!.setAttribute('data-forma-h', 'ffffffffffffffff');
    document.body.append(changed);
    expect(() => first.scope.activate()).toThrow('FORMA_E_ISLAND_IDENTITY');
    expect(first.component).not.toHaveBeenCalled();
    const injected = route(); const second = prepare(injected);
    injected.append(injected.firstElementChild!.cloneNode(true));
    document.body.append(injected);
    expect(() => second.scope.activate()).toThrow('host set changed');
    expect(second.component).not.toHaveBeenCalled();
  });

  it('revokes pending load work and resolves readiness without running a disposed component', async () => {
    const root = route(); const { scope, component } = prepare(root);
    document.body.append(root);
    const ready = scope.activate(); scope.dispose();
    await ready;
    expect(component).not.toHaveBeenCalled();
    expect(() => __prepareNavigationIslands(registry().value, root, state())).toThrow('fresh detached');
  });

  it('revokes interaction triggers and refuses moved hosts when a late trigger executes', async () => {
    const cancelledRoot = route('new', 'interaction'); const cancelled = prepare(cancelledRoot);
    document.body.append(cancelledRoot); await cancelled.scope.activate(); cancelled.scope.dispose();
    cancelledRoot.querySelector('section')!.dispatchEvent(new Event('pointerdown'));
    expect(cancelled.component).not.toHaveBeenCalled();
    const movedRoot = route('new', 'interaction'); const moved = prepare(movedRoot);
    document.body.append(movedRoot); await moved.scope.activate();
    const host = movedRoot.querySelector('section')!; document.body.append(host);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    host.dispatchEvent(new Event('pointerdown'));
    expect(moved.component).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('outside its validated document'));
  });

  it('refuses a prepared subtree adopted into a different Document', () => {
    const root = route(); const { scope, component } = prepare(root);
    const foreign = document.implementation.createHTMLDocument('foreign');
    foreign.body.append(foreign.adoptNode(root));
    expect(() => scope.activate()).toThrow('FORMA_E_ISLAND_IDENTITY');
    expect(component).not.toHaveBeenCalled();
  });

  it('keeps the private navigation envelope as child-props authority after exposed props mutate', () => {
    const root = route(); const definition = registry();
    const handle = prepareNavigationIslandState(definition.value, root, state());
    document.body.append(root);
    const result = activateNavigationIslandState(handle)[0]!;
    if (!('value' in result)) throw result.error;
    checkIslandClaim(result.value);
    result.value.props.label = 'mutated';
    const good = withAdoptionDescription(() => __adoptionChild(undefined, definition.component, [{ label: 'new' }])) as unknown as ComponentDescription;
    const bad = withAdoptionDescription(() => __adoptionChild(undefined, definition.component, [{ label: 'mutated' }])) as unknown as ComponentDescription;
    expect(() => matchAdoptionChild(result.host, good, result.value)).not.toThrow();
    expect(() => matchAdoptionChild(result.host, bad, result.value)).toThrow('FORMA_E_HYDRATE_VALUE');
  });
});
useFreshDocument();
