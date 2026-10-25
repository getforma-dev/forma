// Step 1 of the corpus: the island-emitter family rebuilt from the compiler's own test (proved
// exact against every committed .ir), the props-contract page, and P3 through a module-exported
// setter, which must be able to fail.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { bundleEntry } from '../src/bundle.mts';
import { readEmitterCases, materialize } from '../src/island-emitter.mts';
import { summarize } from '../src/compare.mts';
import { pairDifference } from '../src/fmir-pair.mts';
import { REPO } from '../src/server.mts';
import { check, prepare, readCorpus, type CorpusEntry } from '../src/suite.mts';

const TEST = resolve(REPO, 'packages/compiler/tests/island-emission.test.ts');
const IR = resolve(REPO, 'crates/forma-ir/tests/fixtures/island-emitter');

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test('the corpus by step: 14 modules at step 0; step 1 adds props-contract, the P3 fixture and the island-emitter family less its browserOnly case', () => {
  const zero = readCorpus(0), one = readCorpus(1);
  assert.equal(zero.length, 14);
  assert.ok(zero.every(entry => entry.step === 0));
  const added = one.filter(entry => entry.step === 1).map(entry => entry.name);
  assert.deepEqual(added.slice(0, 2), ['props-contract', 'transition']);
  const family = readEmitterCases(TEST, IR).map(item => item.name);
  assert.deepEqual(added.slice(2), family.filter(name => name !== 'browser'), 'every committed case but browser');
  assert.ok(family.includes('roundtrip') && family.includes('keyed-shapes') && family.includes('browser'));
  assert.equal(one.find(entry => entry.name === 'transition')!.transition?.export, 'parityTransition');
  assert.equal(one.find(entry => entry.name === 'transition')!.ir, undefined, 'the P3 fixture serves its compiled module');
});

test('every island-emitter case is rebuilt exactly: compiled, the rebuilt files give the committed .ir byte for byte', async () => {
  const cases = readEmitterCases(TEST, IR);
  assert.ok(cases.length >= 13, `${cases.length} cases`);
  for (const item of cases) {
    const dir = materialize(item);
    const product = await bundleEntry(item.name, join(dir, 'app.ts'));
    assert.equal(pairDifference(item.name, product.ir, readFileSync(join(IR, `${item.name}.ir`))), null, `${item.name}: the rebuilt source compiles to the committed module`);
    assert.ok(product.js !== null, `${item.name}: an island page ships its entry`);
  }
});

test('the extractor refuses what it cannot read as a constant, rather than guessing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forma-parity-extract-'));
  try {
    const file = join(dir, 'case.test.ts');
    writeFileSync(file, `const core='import {h} from "@getforma/core";';
function emit(name:string,page:string,island:string){const sources={'app.ts':'app'};return sources;}
it('x',()=>{emit('computed',makePage(),'island');});`);
    writeFileSync(join(dir, 'computed.ir'), '');
    assert.throws(() => readEmitterCases(file, dir), /cannot read a CallExpression as a constant string/);
    writeFileSync(file, `const core='c';function emit(name:string,page:string,island:string){const sources={'app.ts':'APP'};return sources;}
it('y',()=>{const page='P'+'Q';const island=\`I\${page}\`;emit('computed',page,island,true);});`);
    assert.deepEqual(readEmitterCases(file, dir), [{ name: 'computed', files: { 'page.tsx': 'cPQ', 'island.ts': 'cIPQ', 'app.ts': 'APP' } }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const transition = (name: string, folder: string): CorpusEntry => ({
  name, step: 1, entry: `${folder}/app.ts`, kind: 'islands',
  page: { file: `${folder}/page.ts`, exportName: 'Page', props: 'named' },
  transition: { file: `${folder}/island.ts`, export: 'parityTransition' },
});

test('P3: the activated page moved by the module\'s setter equals the next state\'s fresh server render, state after state', async () => {
  const entry = readCorpus(1).find(item => item.name === 'transition')!;
  const plan = await prepare(entry, { seed: 'forma-183', states: 4 });
  assert.equal(plan.failure, undefined, plan.failure);
  const reports = await check([plan], { seed: 'forma-183', states: 4, browser }, { prepare: 0, launch: 0, server: 0, browser: 0 });
  const p3 = reports.filter(report => report.check === 'P3');
  assert.deepEqual(p3.map(report => [report.transition!.from, report.transition!.to, report.verdict]), [[0, 1, 'equal'], [1, 2, 'equal'], [2, 3, 'equal'], [3, 0, 'equal']]);
  assert.ok(reports.filter(report => report.check === 'P2').every(report => report.verdict === 'equal'), 'activation wrote nothing first');
});

test('P3 can fail: a setter that moves count one past the next state is a text difference at the island\'s count', async () => {
  const plan = await prepare(transition('transition-off-by-one', 'e2e/parity/tests/fixtures/transition-off-by-one'), { seed: 'forma-183', states: 2 });
  assert.equal(plan.failure, undefined, plan.failure);
  const reports = await check([plan], { seed: 'forma-183', states: 2, browser }, { prepare: 0, launch: 0, server: 0, browser: 0 });
  const p3 = reports.filter(report => report.check === 'P3');
  assert.equal(p3.length, 2);
  for (const report of p3) {
    assert.equal(report.verdict, 'different', summarize(report));
    assert.deepEqual(report.differences.map(d => [d.kind, d.path]), [['text', 'page > main:nth-child(1) > section:nth-child(1) > p:nth-child(2) > #text']]);
    assert.equal(Number(report.first!.client), Number(report.first!.server) + 1, summarize(report));
  }
  assert.ok(reports.filter(report => report.check === 'P1').every(report => report.verdict === 'equal'), 'the first render is right');
});

test('a module without a setter reports P3 no-setter once, counted, not skipped', async () => {
  const entry = readCorpus(0).find(item => item.name === 'create-show')!;
  const plan = await prepare(entry, { seed: 'forma-183', states: 1 });
  const reports = await check([plan], { seed: 'forma-183', states: 1, browser }, { prepare: 0, launch: 0, server: 0, browser: 0 });
  assert.deepEqual(reports.filter(report => report.check === 'P3').map(report => [report.module, report.verdict]), [['create-show', 'no-setter']]);
});
