import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from '../element.js';
import { activateIslands } from '../activate.js';
import { prepareNativeOwner, prepareInitialNativeOwners, validateNativeOwnerTree, type NativeOwnerScope } from '../../navigation.js';
import { compiled, FIXTURE_HASH, installState, useFreshDocument } from './helpers/compiled-island.js';

const cleanup: NativeOwnerScope[] = [];
afterEach(() => {
  for (const scope of cleanup.splice(0).reverse()) { try { scope.dispose(); } catch { /* assertions exercise failures */ } }
  vi.restoreAllMocks();
});
function registry() {
  const calls: string[] = [], clicks: string[] = [];
  const Row = compiled((props: { label: string }) => {
    calls.push(props.label);
    return h('section', null, h('button', { onClick: () => clicks.push(props.label) }, props.label));
  }, [[{ name: 'label', type: { kind: 'string' } }]]);
  return { value: { Row }, calls, clicks };
}
function owner(label: string, nested = false, trigger = 'load') {
  const root = document.createElement('main');
  root.innerHTML = `<section data-forma-island="0" data-forma-state="0" data-forma-component="Row" data-forma-h="${FIXTURE_HASH}" data-forma-hydrate="${trigger}"><button>${label}</button></section>${nested ? '<div data-forma-outlet="child"></div>' : ''}`;
  const outlet = root.querySelector<HTMLElement>('[data-forma-outlet]') ?? undefined;
  return { root, outlet };
}
function state(label: string) { return JSON.stringify({ v: 1, s: [], i: [{ h: FIXTURE_HASH, p: { label } }] }); }
function prepare(label: string, definition: ReturnType<typeof registry>, nested = false, trigger = 'load') {
  const descriptor = owner(label, nested, trigger);
  const scope = prepareNativeOwner(definition.value, descriptor.root, state(label), { outlet: descriptor.outlet });
  cleanup.push(scope);
  return scope;
}
function initial(definition: ReturnType<typeof registry>) {
  const a = owner('layout', true), b = owner('section', true), c = owner('initial');
  a.outlet!.append(b.root); b.outlet!.append(c.root); document.body.append(a.root);
  installState([{ label: 'layout' }, { label: 'section' }, { label: 'initial' }]);
  const scopes = prepareInitialNativeOwners(definition.value, [a, b, c]); cleanup.push(...scopes);
  return scopes;
}

describe('native owner partition', () => {
  it('retains two initial owners through three distinct leaf transitions without initial writes or repeated activation', async () => {
    const definition = registry(), scopes = initial(definition), [layout, section] = scopes;
    const layoutButton = layout!.root.querySelector('button')!, sectionButton = section!.root.querySelector('button')!;
    const before = layout!.root.innerHTML, mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(layout!.root, { subtree: true, attributes: true, childList: true, characterData: true });
    expect(definition.calls).toEqual([]);
    validateNativeOwnerTree(scopes);
    await Promise.all(scopes.map(scope => scope.activate()));
    expect(layout!.root.innerHTML).toBe(before);
    expect([...mutations, ...observer.takeRecords()]).toEqual([]); observer.disconnect();
    expect(definition.calls).toEqual(['layout', 'section', 'initial']);
    let leaf = scopes[2]!;
    for (const label of ['second', 'third', 'fourth']) {
      const departing = leaf.root.querySelector('button')!;
      const next = prepare(label, definition);
      expect(definition.calls).not.toContain(label);
      leaf.dispose(); leaf.root.replaceWith(next.root); leaf = next;
      validateNativeOwnerTree([layout!, section!, leaf]);
      await leaf.activate();
      expect(layout!.root.querySelector('button')).toBe(layoutButton);
      expect(section!.root.querySelector('button')).toBe(sectionButton);
      const count = definition.clicks.length; departing.click();
      expect(definition.clicks.length).toBe(count);
      leaf.root.querySelector('button')!.click();
      expect(definition.clicks.at(-1)).toBe(label);
      expect(definition.calls.filter(value => value === 'layout')).toHaveLength(1);
      expect(definition.calls.filter(value => value === 'section')).toHaveLength(1);
    }
    layoutButton.click(); sectionButton.click();
    expect(definition.clicks.slice(-2)).toEqual(['layout', 'section']);
    expect(document.head.querySelector('[data-island-state]')!.textContent).toContain('initial');
  });

  it('prepares every detached owner before assembly and keeps child scope disposal independent', async () => {
    const definition = registry(), parent = prepare('parent', definition, true), child = prepare('child', definition);
    const first = parent.root.querySelector('button')!, second = child.root.querySelector('button')!;
    parent.outlet!.append(child.root); validateNativeOwnerTree([parent, child]);
    expect(definition.calls).toEqual([]);
    document.body.append(parent.root); await Promise.all([parent.activate(), child.activate()]);
    child.dispose(); second.click(); first.click();
    expect(definition.clicks).toEqual(['parent']);
    expect(parent.root.querySelector('button')).toBe(first);
    expect(parent.outlet!.firstElementChild).toBe(child.root);
  });

  it('refuses a partial or overlapping initial branch before any island can run', () => {
    const definition = registry(), a = owner('a', true), b = owner('b'); a.outlet!.append(b.root); document.body.append(a.root);
    installState([{ label: 'a' }, { label: 'b' }]); const before = a.root.innerHTML;
    expect(() => prepareInitialNativeOwners(definition.value, [{ root: a.root }, b])).toThrow('invalid initial owner branch');
    expect(() => prepareInitialNativeOwners(definition.value, [a, a])).toThrow('invalid initial owner branch');
    expect(definition.calls).toEqual([]); expect(a.root.innerHTML).toBe(before);
  });

  it('cannot partition initial islands after ordinary activation already armed them', async () => {
    const definition = registry(), descriptor = owner('already'); document.body.append(descriptor.root); installState([{ label: 'already' }]);
    await activateIslands(definition.value);
    expect(() => prepareInitialNativeOwners(definition.value, [descriptor])).toThrow('already activated');
    descriptor.root.querySelector('button')!.click();
    expect(definition.clicks).toEqual(['already']); expect(definition.calls).toEqual(['already']);
  });

  it('rejects outlets inside islands and populated detached outlets without running components', () => {
    const definition = registry(), descriptor = owner('parent', true);
    descriptor.root.querySelector('section')!.append(descriptor.outlet!);
    expect(() => prepareNativeOwner(definition.value, descriptor.root, state('parent'), { outlet: descriptor.outlet })).toThrow('inside an island');
    const other = owner('other', true); other.outlet!.append(owner('child').root);
    expect(() => prepareNativeOwner(definition.value, other.root, state('other'), { outlet: other.outlet })).toThrow('must be empty');
    expect(definition.calls).toEqual([]); expect(other.root.querySelector('button')!.textContent).toBe('other');
  });

  it('rejects duplicate child roots, moved outlets and unclaimed outlets before activation', () => {
    const definition = registry(), parent = prepare('parent', definition, true), child = prepare('child', definition);
    parent.outlet!.append(child.root);
    expect(() => validateNativeOwnerTree([parent, parent])).toThrow('invalid native owner branch');
    const container = document.createElement('div'); parent.root.append(container); container.append(parent.outlet!);
    expect(() => validateNativeOwnerTree([parent, child])).toThrow('scope cannot activate');
    const extra = owner('extra', true);
    expect(() => prepareNativeOwner(definition.value, extra.root, state('extra'))).toThrow('unclaimed owner outlet');
    expect(definition.calls).toEqual([]); expect(child.root.querySelector('button')!.textContent).toBe('child');
  });

  it('never discovers child hosts through a parent outlet and refuses a captured host moved there before a deferred trigger', async () => {
    const definition = registry(), parent = prepare('parent', definition, true, 'interaction'), child = prepare('child', definition, false, 'interaction');
    parent.outlet!.append(child.root); document.body.append(parent.root);
    await parent.activate();
    child.root.querySelector('section')!.dispatchEvent(new Event('pointerdown'));
    expect(definition.calls).toEqual([]);
    const parentHost = parent.root.querySelector('section')!; child.root.append(parentHost);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    parentHost.dispatchEvent(new Event('pointerdown'));
    expect(definition.calls).toEqual([]); expect(errors).toHaveBeenCalledWith(expect.stringContaining('outside its validated document'));
    expect(child.root.querySelector('button')!.textContent).toBe('child');
  });

  it('revokes deferred descendants before a replaced ancestor can be activated again', async () => {
    const definition = registry(), parent = prepare('parent', definition, true, 'interaction'), child = prepare('child', definition, false, 'interaction');
    parent.outlet!.append(child.root); document.body.append(parent.root);
    await Promise.all([parent.activate(), child.activate()]);
    child.dispose(); parent.dispose(); parent.root.remove();
    parent.root.querySelector('section')!.dispatchEvent(new Event('pointerdown'));
    child.root.querySelector('section')!.dispatchEvent(new Event('pointerdown'));
    expect(() => parent.activate()).toThrow('disposed'); expect(() => child.activate()).toThrow('disposed');
    expect(definition.calls).toEqual([]); expect(document.body.children.length).toBe(0);
  });

  it('keeps outlet identity fixed through renaming and an island marker added before deferred activation', async () => {
    const definition = registry(), parent = prepare('parent', definition, true, 'interaction');
    document.body.append(parent.root); await parent.activate();
    parent.outlet!.setAttribute('data-forma-outlet', 'different');
    expect(() => parent.validate()).toThrow('scope cannot activate');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    parent.root.querySelector('section')!.dispatchEvent(new Event('pointerdown'));
    expect(definition.calls).toEqual([]); expect(errors).toHaveBeenCalled();
    const other = prepare('other', definition, true);
    other.outlet!.setAttribute('data-forma-island', '0');
    expect(() => other.validate()).toThrow('scope cannot activate');
    expect(other.root.querySelector('button')!.textContent).toBe('other');
  });

  it('continues revoking sibling deferred hosts after an observer cleanup throws', async () => {
    const definition = registry(), callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    const disconnects = [vi.fn().mockImplementationOnce(() => { throw new Error('observer cleanup'); }), vi.fn()];
    vi.stubGlobal('IntersectionObserver', class {
      disconnect: () => void;
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        this.disconnect = disconnects[callbacks.length]!; callbacks.push(callback);
      }
      observe() {}
    });
    const descriptor = owner('first', false, 'visible'), second = owner('second', false, 'visible');
    second.root.firstElementChild!.setAttribute('data-forma-state', '1');
    descriptor.root.append(second.root.firstElementChild!);
    const scope = prepareNativeOwner(definition.value, descriptor.root,
      JSON.stringify({ v: 1, s: [], i: ['first', 'second'].map(label => ({ h: FIXTURE_HASH, p: { label } })) }));
    cleanup.push(scope); document.body.append(scope.root); await scope.activate();
    expect(callbacks).toHaveLength(2);
    expect(() => scope.dispose()).toThrow('native owner cleanup failed');
    expect(disconnects.map(disconnect => disconnect.mock.calls.length)).toEqual([1, 1]);
    for (const callback of callbacks) callback([{ isIntersecting: true }]);
    expect(definition.calls).toEqual([]);
    expect(scope.root.textContent).toBe('firstsecond');
    expect(() => scope.dispose()).not.toThrow();
  });

  it('bounds the owner list and own host count before components execute', () => {
    const definition = registry(), descriptor = owner('bounded');
    expect(() => prepareInitialNativeOwners(definition.value, [])).toThrow('1 to 32 owners');
    expect(() => prepareInitialNativeOwners(definition.value, Array(33).fill(descriptor))).toThrow('1 to 32 owners');
    const host = descriptor.root.firstElementChild!;
    for (let index = 1; index <= 200; index++) descriptor.root.append(host.cloneNode(true));
    expect(() => prepareNativeOwner(definition.value, descriptor.root, state('bounded'))).toThrow('200 islands');
    expect(definition.calls).toEqual([]); expect(descriptor.root.children).toHaveLength(201);
  });

  it('reports immediate adoption failure instead of treating settled readiness as successful adoption', async () => {
    const definition = registry(), scope = prepare('expected', definition);
    scope.root.querySelector('button')!.textContent = 'wrong server value'; document.body.append(scope.root);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(scope.activate()).rejects.toThrow('activation failed');
    scope.root.querySelector('button')!.click();
    expect(definition.clicks).toEqual([]); expect(scope.root.querySelector('button')!.textContent).toBe('wrong server value');
  });

  it('retains the original document refusal after an invalid initial branch and later state replacement', async () => {
    const definition = registry(), descriptor = owner('first'); document.body.append(descriptor.root);
    expect(() => prepareInitialNativeOwners(definition.value, [descriptor])).toThrow('missing first head state block');
    installState([{ label: 'first' }]);
    expect(() => prepareInitialNativeOwners(definition.value, [descriptor])).toThrow('missing first head state block');
    vi.spyOn(console, 'error').mockImplementation(() => {}); await activateIslands(definition.value);
    expect(definition.calls).toEqual([]); expect(descriptor.root.querySelector('button')!.textContent).toBe('first');
  });
});
useFreshDocument();
