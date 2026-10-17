// Exercise the actual browser-phase/module comparison code without native builds or browser timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from '@playwright/test';
import type { PageRun, StateInput } from '../src/browser.mts';
import { browse, type CheckOptions, type ModulePlan, type Served } from '../src/suite.mts';

const options: CheckOptions = { seed: 'module-workers', states: 100, browser: {} as Browser, moduleWorkers: 2 };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const tree = (module: string, state: unknown) => ({ kind: 'text' as const, text: `${module}:${JSON.stringify(state)}` });
function fixtures(names: string[], count = 100) {
  const plans: ModulePlan[] = names.map(name => ({
    entry: { name, entry: `${name}.ts`, kind: 'islands', step: 1, page: { file: `${name}.tsx`, exportName: 'Page', props: 'named' }, transition: { file: `${name}.tsx`, export: 'set' } },
    irPath: `${name}.ir`, described: { schema: [[{ name: 'value', type: { kind: 'number' } }]], islands: [], slots: [], keys: [] },
    indices: Array.from({ length: count }, (_, i) => i), states: Array.from({ length: count }, (_, value) => ({ value })),
    twin: `twin:${name}`, script: `entry:${name}`, diagnostics: [],
  }));
  const served = new Map<string, Served>(plans.map(plan => [plan.entry.name, {
    path: 'typed', bind: [], documents: plan.indices.map(index => ({ html: `${plan.entry.name}:${index}`, headers: { 'x-module': plan.entry.name } })),
  }]));
  return { plans, served };
}
function observation(input: StateInput): PageRun {
  return {
    served: tree(input.module, input.state), twin: tree(input.module, input.state), twinError: null,
    p2: { records: [], events: [], control: { attributes: true, childList: true, characterData: true }, hosts: 1, activated: 1, inactive: [] },
    p3: { live: tree(input.module, input.next) }, error: null, logged: [], violations: [], pageErrors: [],
  };
}
const optionsFor = (moduleWorkers: 1 | 2) => ({ ...options, moduleWorkers });

test('two isolated whole-module workers preserve every 100-state P1/P2/P3 report and corpus order despite out-of-order completion', async () => {
  const { plans, served } = fixtures(['a', 'b', 'c']);
  async function run(moduleWorkers: 1 | 2) {
    let created = 0, active = 0, maximum = 0;
    const closed: number[] = [], calls: string[] = [], completed: string[] = [];
    const reports = await browse(plans, served, optionsFor(moduleWorkers), () => {
      const id = created++;
      let busy = false, module: string | undefined;
      return {
        async run(document, bundles, input) {
          assert.equal(busy, false, 'one page must never run two states concurrently');
          if (input.index === 0) { assert.equal(module, undefined); module = input.module; }
          assert.equal(module, input.module, 'a whole module stays on its page');
          busy = true; active++; maximum = Math.max(maximum, active);
          assert.equal(document.html, `${input.module}:${input.index}`);
          assert.equal(document.headers['x-module'], input.module);
          assert.equal(bundles.twin, `twin:${input.module}`);
          assert.equal(bundles.entry, `entry:${input.module}`);
          calls.push(`${input.module}:${input.index}`);
          // Let b/c complete while a's first state is suspended: report order cannot be finish order.
          if (input.module === 'a' && input.index === 0) await tick();
          const result = observation(input);
          active--; busy = false;
          if (input.index === 99) { completed.push(input.module); module = undefined; }
          return result;
        },
        async close() { assert.equal(busy, false); closed.push(id); },
      };
    });
    return { reports, created, maximum, closed, calls, completed };
  }
  const serial = await run(1), parallel = await run(2);
  assert.equal(serial.created, 1); assert.equal(parallel.created, 2);
  assert.equal(serial.maximum, 1); assert.equal(parallel.maximum, 2);
  assert.deepEqual([...parallel.closed].sort(), [0, 1]);
  assert.notDeepEqual(parallel.completed, ['a', 'b', 'c']);
  assert.deepEqual([...parallel.calls].sort(), [...serial.calls].sort());
  assert.equal(new Set(parallel.calls).size, 300);
  assert.equal(parallel.reports.length, 900);
  assert.deepEqual(parallel.reports, serial.reports, 'all values, native/JS cases, P3 wraparound and verdicts are identical');
  assert(parallel.reports.every(report => report.verdict === 'equal'));
  assert.deepEqual(parallel.reports.filter(report => report.check === 'P3').map(report => report.transition),
    plans.flatMap(plan => plan.indices.map(index => ({ from: index, to: (index + 1) % 100 }))));
});

test('boot refusal retains every remaining error and sibling comparison; P1 mismatch and P2 violations cannot disappear', async () => {
  const { plans, served } = fixtures(['timeout', 'mismatch', 'policy'], 3);
  const calls: string[] = [], closed: number[] = [];
  let created = 0;
  const reports = await browse(plans, served, options, () => {
    const id = created++;
    return {
      async run(_document, _bundles, input) {
        calls.push(`${input.module}:${input.index}`);
        const result = observation(input);
        if (input.module === 'timeout') return { ...result, error: 'the boot did not finish in1500ms: control' };
        if (input.module === 'mismatch') return { ...result, twin: tree('wrong module', input.state) };
        return { ...result, p2: { ...result.p2!, events: ['control refusal'] }, violations: [{ step: 'P2', text: 'control CSP' }] };
      },
      async close() { closed.push(id); },
    };
  });
  assert.deepEqual([...closed].sort(), [0, 1]);
  assert.deepEqual(calls.filter(call => call.startsWith('timeout:')), ['timeout:0']);
  for (const index of [1, 2]) for (const check of ['P1', 'P2']) {
    const report = reports.find(report => report.module === 'timeout' && report.index === index && report.check === check)!;
    assert.equal(report.verdict, 'error'); assert.match(report.error!, /not run: the module's boot did not finish/);
  }
  assert.equal(reports.filter(report => report.module === 'mismatch' && report.check === 'P1' && report.verdict === 'different').length, 3);
  assert.equal(reports.filter(report => report.module === 'policy' && report.check === 'P1' && report.verdict === 'error').length, 3);
  assert.equal(reports.filter(report => report.module === 'policy' && report.check === 'P2' && report.verdict === 'different').length, 3);
});

test('unexpected run and close failures are retained only after the sibling finishes and both resources close', { timeout: 5000 }, async () => {
  const { plans, served } = fixtures(['bad', 'slow', 'last'], 3);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const runError = new Error('run failure'), closeError = new Error('close failure');
  let created = 0, settled = false;
  const closed: number[] = [], calls: string[] = [];
  const promise = browse(plans, served, options, () => {
    const id = created++;
    return {
      async run(_document, _bundles, input) {
        calls.push(`${input.module}:${input.index}`);
        if (input.module === 'bad') throw runError;
        await held;
        return observation(input);
      },
      async close() { closed.push(id); if (id === 0) throw closeError; },
    };
  });
  const caught = promise.then(() => { settled = true; return null; }, error => { settled = true; return error; });
  try {
    await tick();
    assert.equal(settled, false, 'do not reject early while a sibling owns a live page');
    assert.deepEqual(closed, [0]);
  } finally { release(); }
  const error = await caught;
  assert(error instanceof AggregateError);
  assert.deepEqual(error.errors[0].errors, [runError, closeError]);
  assert.match(error.stack!, /run failure/); assert.match(error.stack!, /close failure/);
  assert.deepEqual([...closed].sort(), [0, 1]);
  assert.deepEqual(calls.filter(call => !call.startsWith('bad:')), ['slow:0', 'slow:1', 'slow:2', 'last:0', 'last:1', 'last:2']);
});

test('page construction failure still joins and closes the other worker before rejecting', { timeout: 5000 }, async () => {
  const { plans, served } = fixtures(['slow', 'last'], 3);
  const createError = new Error('page construction failed');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let created = 0, closed = 0, settled = false;
  const promise = browse(plans, served, options, () => {
    if (created++ === 1) throw createError;
    return { async run(_document, _bundles, input) { await held; return observation(input); }, async close() { closed++; } };
  });
  const caught = promise.then(() => { settled = true; return null; }, error => { settled = true; return error; });
  try { await tick(); assert.equal(settled, false); assert.equal(closed, 0); } finally { release(); }
  const error = await caught;
  assert(error instanceof AggregateError); assert.deepEqual(error.errors, [createError]); assert.equal(closed, 1);
});

test('the direct-call default stays serial and an empty plan creates no page', async () => {
  const { plans, served } = fixtures(['a', 'b'], 1);
  const { moduleWorkers: _workers, ...serial } = options;
  let created = 0, closed = 0;
  const createPage = () => {
    created++;
    return { async run(_document: unknown, _bundles: unknown, input: StateInput) { return observation(input); }, async close() { closed++; } };
  };
  assert.deepEqual(await browse([], new Map(), options, createPage), []);
  assert.equal(created, 0);
  const reports = await browse(plans, served, serial, createPage);
  assert.equal(created, 1); assert.equal(closed, 1); assert.equal(reports.length, 6);
});


test('invalid worker counts fail before creating a page instead of producing an empty successful report', async () => {
  const { plans, served } = fixtures(['a'], 1);
  for (const moduleWorkers of [0, 3, Number.NaN]) {
    await assert.rejects(browse(plans, served, { ...options, moduleWorkers } as CheckOptions, () => { throw new Error('must not create a page'); }), /moduleWorkers must be 1 or 2/);
  }
});
