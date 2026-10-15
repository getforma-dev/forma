/** Test-only connected DOM and lifetime ownership for the real strict planner. */
import { afterEach, expect } from 'vitest';
import { prepareAdoption, type PreparedAdoption } from '../../adoption.js';
import { registerDisposer } from '../../../reactive/root.js';
const plans = new Set<PreparedAdoption>();
const hosts = new Set<Element>();
afterEach(() => { for (const plan of plans) plan.dispose(); plans.clear(); for (const host of hosts) host.remove(); hosts.clear(); });
export function connect<T extends Element>(host: T): T {
  if (!host.ownerDocument.contains(host)) host.ownerDocument.body.appendChild(host);
  hosts.add(host); return host;
}
export function fixture(html: string): Element {
  const doc = document.implementation.createHTMLDocument(); doc.body.innerHTML = html;
  const host = doc.body.firstElementChild!; expect(host).toBeTruthy(); hosts.add(host); return host;
}
export function prepareAndCommit(host: Element, build: () => unknown): PreparedAdoption {
  expect(host.ownerDocument.contains(host)).toBe(true);
  const plan = prepareAdoption(host, build); plans.add(plan); registerDisposer(() => plan.dispose());
  plan.commit(); return plan;
}
export function expectRefusal(host: Element, build: () => unknown, code: string): void {
  expect(host.ownerDocument.contains(host)).toBe(true);
  const before = host.outerHTML, nodes: Node[] = [], walker = host.ownerDocument.createTreeWalker(host);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  const observer = new MutationObserver(() => {});
  observer.observe(host, { attributes: true, childList: true, characterData: true, subtree: true });
  try {
    expect(() => prepareAdoption(host, build)).toThrow(code);
    expect(host.outerHTML).toBe(before);
    const after: Node[] = [], cursor = host.ownerDocument.createTreeWalker(host);
    for (let node = cursor.nextNode(); node; node = cursor.nextNode()) after.push(node);
    expect(after).toEqual(nodes); expect(observer.takeRecords()).toEqual([]);
  } finally { observer.disconnect(); }
}
