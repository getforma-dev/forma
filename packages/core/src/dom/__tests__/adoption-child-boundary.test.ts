import { expect, it, vi } from 'vitest';
import { __adoptionChild, withAdoptionDescription, type ComponentDescription } from '../adoption-description.js';
import { __islandRegistration, checkIslandClaim, matchAdoptionChild, preflightIslands } from '../island-state.js';
import { FIXTURE_HASH, installState } from './helpers/compiled-island.js';

function fixture() {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = '<section data-forma-island="7" data-forma-component="Child"><b>server</b></section>';
  installState([{}], doc);
  const component = vi.fn();
  const result = preflightIslands({ Child: __islandRegistration(component, { h: FIXTURE_HASH, schema: [[]], mode: 0 }) }, doc)[0]!;
  if ('error' in result) throw result.error;
  const description = withAdoptionDescription(() => __adoptionChild(undefined, component, [{}])) as unknown as ComponentDescription;
  return { doc, component, value: result.value, description };
}

it('refuses a removed original island boundary before a deferred child can be matched', () => {
  const { value, description, component } = fixture();
  value.host.removeAttribute('data-forma-island');
  const observer = new MutationObserver(() => {});
  observer.observe(value.host, { attributes: true, childList: true, subtree: true, characterData: true });
  try {
    expect(() => checkIslandClaim(value)).toThrow('FORMA_E_ISLAND_IDENTITY');
    expect(() => matchAdoptionChild(value.host, description, value)).toThrow('FORMA_E_ISLAND_IDENTITY');
    expect(component).not.toHaveBeenCalled();
    expect(observer.takeRecords()).toEqual([]);
  } finally { observer.disconnect(); }
});

it('refuses a changed original island boundary even while the node stays in the document', () => {
  const { value, description } = fixture();
  value.host.setAttribute('data-forma-island', '8');
  expect(() => checkIslandClaim(value)).toThrow('FORMA_E_ISLAND_IDENTITY');
  expect(() => matchAdoptionChild(value.host, description, value)).toThrow('FORMA_E_ISLAND_IDENTITY');
});

it('still accepts the same original node with its restored boundary marker', () => {
  const { value, description, component } = fixture();
  value.host.removeAttribute('data-forma-island');
  value.host.setAttribute('data-forma-island', '7');
  expect(() => matchAdoptionChild(value.host, description, value)).not.toThrow();
  expect(component).not.toHaveBeenCalled();
});
