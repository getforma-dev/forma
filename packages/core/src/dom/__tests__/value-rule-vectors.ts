/**
 * Shared readers for FORMA-182's value-rule vectors (one JSON file per rule
 * under crates/forma-ir/tests/fixtures/parity/), used by the per-rule suites
 * beside this file. The files are the same ones forma-ir's suite reads, so a
 * vector changed there fails whichever side no longer agrees.
 */
import { expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareAdoption } from '../adoption.js';

export const VECTOR_DIR = resolve(__dirname, '../../../../../crates/forma-ir/tests/fixtures/parity');

export function readVectors<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(VECTOR_DIR, name), 'utf8')) as T;
}

/** A server-rendered dynamic text range holding `text`, built with DOM calls
 * (an empty value is held by the walker's U+200B so a Text node exists). */
export function servedRange(doc: Document, text: string): HTMLElement {
  const host = doc.createElement('p');
  host.append(doc.createComment('f:t0'), doc.createTextNode(text === '' ? '​' : text), doc.createComment('/f:t0'));
  doc.body.append(host);
  return host;
}

/** Strict adoption of `build` over `host` succeeds, writes nothing (zero
 * MutationRecords after a macrotask) and keeps the served Text node; `after`
 * runs while the plan is live. */
export async function adoptsWithoutWrite(host: HTMLElement, build: () => Element, after?: (text: Text) => void): Promise<void> {
  const text = host.childNodes[1] as Text;
  const records: MutationRecord[] = [];
  const observer = new MutationObserver(batch => records.push(...batch));
  observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
  const plan = prepareAdoption(host, build);
  try {
    plan.commit();
    expect(plan.phase).toBe('live');
    await new Promise(resolve => setTimeout(resolve, 0));
    records.push(...observer.takeRecords());
    expect(records).toEqual([]);
    expect(host.childNodes[1]).toBe(text);
    after?.(text);
  } finally { plan.dispose(); observer.disconnect(); }
}
