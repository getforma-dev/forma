import { mountFixture, unmountFixture } from './runtime-fixture';
/**
 * FORMA-028: one budget per task, not per binding.
 *
 * FORMA-004's budgets bound one evaluation: one binding, or one handler run.
 * A widget with ten bindings at the allocation cap therefore ran ten budgets
 * in one task, 382 ms at 4x CPU throttling (formajs#14, review 5513640827).
 * Now every evaluation in a task counts on from what the evaluations before it
 * in that task spent. A binding refused only because the task's budget was
 * already spent re-runs in the next task, where it starts first, and is not
 * reported; a binding over the budget on its own is reported as before.
 *
 * Each test starts on a fresh task (`beforeEach` lets the runtime's timer run),
 * and `settle` runs the retry ticks the runtime schedules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';
import { batch } from '../reactive';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function settle(ticks = 40): Promise<void> {
  for (let i = 0; i < ticks; i++) await tick();
}

/**
 * The three heaviest tests here mount hundreds of bindings over lists of up to
 * 62,000 numbers and run up to a hundred retry ticks, and under coverage they
 * came close to vitest's 5 s default, or past it: run 38601251484 (Node 20)
 * timed the first out at 5,000 ms, and its work, still running, then failed
 * "the cap drops to 0 …" too (forcing that timeout locally fails the same two).
 * Each has a timeout about 3x its slowest CI run (FORMA-179; 10 to 12 runs on
 * each of Node 20, 22 and 24, under coverage): 4,993 ms (and the timed-out
 * 5,180), 3,376 ms and 3,407 ms.
 */
const HEAVY_WAIT_TIMEOUT_MS = 16_000;
const HEAVY_DROP_TIMEOUT_MS = 11_000;
const HEAVY_DISPATCH_TIMEOUT_MS = 11_000;

/** An expression that spends `units` of the 250,000-unit allocation budget and answers `units - 10`. */
const spending = (units: number): string => `Array.from({length: ${units - 10}}).length`;

describe('the task budget (FORMA-028)', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    await tick();
    runtime.clearDiagnostics();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    unmountFixture(container);
    container.remove();
    await settle(2);
    runtime.clearDiagnostics();
    vi.restoreAllMocks();
  });

  const texts = (): string[] => [...container.querySelectorAll('[data-out]')].map((e) => e.textContent ?? '');
  const codes = (): string[] => runtime.getDiagnostics().map((d) => d.code ?? '');

  /** A list of `n` numbers read through a proxy that counts its element reads in `reads.n`. */
  const reads = { n: 0 };
  const counted = (n: number): number[] => new Proxy(Array.from({ length: n }, (_, i) => i), {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.n++;
      return Reflect.get(target, key, receiver);
    },
  });

  it('ten bindings at the cap spend one budget per task and all of them render', async () => {
    // Each binding spends 200,000 units; one task holds one of them.
    const ps = Array.from({ length: 10 }, () => `<p data-out data-text="{${spending(200_000)}}">server</p>`).join('');
    container.innerHTML = `<div data-forma-state='{}'>${ps}</div>`;
    mountFixture(container);
    expect(texts().filter((t) => t === '199990')).toHaveLength(1);
    expect(texts().filter((t) => t === 'server')).toHaveLength(9);
    await tick();
    expect(texts().filter((t) => t === '199990')).toHaveLength(2);
    await settle();
    expect(texts()).toEqual(Array(10).fill('199990'));
    // Deferred, never refused: nothing was reported and nothing is marked.
    expect(codes()).toEqual([]);
    expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(0);
  });

  it('the step budget is spent per task too', async () => {
    // Each binding takes about 72,000 of the 100,000 steps: one per task.
    const steps = 'Array.from({length: 12000}).map((x, i) => i).filter(i => i % 2).length';
    const ps = Array.from({ length: 4 }, () => `<p data-out data-text="{${steps}}">server</p>`).join('');
    container.innerHTML = `<div data-forma-state='{}'>${ps}</div>`;
    mountFixture(container);
    expect(texts()).toEqual(['6000', 'server', 'server', 'server']);
    await settle();
    expect(texts()).toEqual(Array(4).fill('6000'));
    expect(codes()).toEqual([]);
  });

  it('a binding over the budget on its own is reported, not retried', async () => {
    container.innerHTML = `<div data-forma-state='{}'>
      <p data-out data-text="{${spending(300_000)}}">server</p>
      <p data-out data-text="{${spending(200_000)}}">server</p>
      <p data-out data-text="{${spending(300_010)}}">server</p>
    </div>`;
    mountFixture(container);
    // The first is refused in a task it started: reported at once, and arms
    // the task's cap as a wait does (FORMA-178). The second would have fitted
    // the room left (its refused neighbour never ran), but is past the cap, so
    // it waits a task and renders there. The third asks for more than the whole
    // budget, which no task could hold: reported at once too, a charge a cost
    // row sizes directly being counted, and refused, without any weighing.
    expect(texts()).toEqual(['server', 'server', 'server']);
    expect(codes()).toEqual(['FORMA_E_BUDGET', 'FORMA_E_BUDGET']);
    await settle();
    expect(texts()).toEqual(['server', '199990', 'server']);
    expect(codes()).toEqual(['FORMA_E_BUDGET', 'FORMA_E_BUDGET']);
    expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(2);
  });

  it('a binding too heavy for any task is priced once and reported once', async () => {
    // The middle binding dispatches an event each time it is evaluated, then
    // asks for 300,000 units. Deferring it would price it again in every retry
    // tick until it ran first (review S2); a charge over the whole budget is
    // final instead. That holds for a charge a cost-table row sizes directly,
    // as `Array.from`'s length; a weighed value too heavy for any task that
    // arrives late in a busy task is counted only to the room left, so it
    // waits once, is weighed in full when it runs first, and is then reported
    // once. Two-sided: the third binding, which fits a task of its own, is
    // still deferred and renders in the next one.
    let priced = 0;
    container.addEventListener('priced', () => { priced++; });
    container.innerHTML = `<div data-forma-state='{}'>
      <p data-out data-text="{${spending(100_000)}}">server</p>
      <p data-out data-text="{[$dispatch('priced'), ${spending(300_010)}][1]}">server</p>
      <p data-out data-text="{${spending(200_000)}}">server</p>
    </div>`;
    mountFixture(container);
    expect(texts()).toEqual(['99990', 'server', 'server']);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    expect(priced).toBe(1);
    await settle();
    expect(texts()).toEqual(['99990', 'server', '199990']);
    expect(runtime.getDiagnostics().map((d) => [d.code, d.count])).toEqual([['FORMA_E_BUDGET', 1]]);
    expect(priced).toBe(1);
  });

  it('bindings that each weigh most of the budget are refused cheaply while they wait', { timeout: HEAVY_WAIT_TIMEOUT_MS }, async () => {
    // FORMA-173, from formajs#26's final review: pricing ran to the whole
    // budget, so every binding still waiting weighed its value in full again
    // in every retry tick (twenty such bindings: a 53 ms task at 4x). Each
    // list here is read through a proxy that counts its element reads. A
    // binding that renders reads its list twice, once to weigh it and once
    // for String(); one that waits should read none of it.
    const widget = async (state: Record<string, unknown>, html: string): Promise<string[]> => {
      container.innerHTML = `<div data-forma-state='${JSON.stringify(Object.fromEntries(Object.keys(state).map((k) => [k, null])))}'>${html}</div>`;
      mountFixture(container);
      for (const [k, v] of Object.entries(state)) runtime.setScopeValue(container.firstElementChild!, k, v);
      await settle(60);
      const out = texts();
      unmountFixture(container);
      return out;
    };
    const p = (expr: string): string => `<p data-out data-text="{${expr} === null ? '' : ${expr}}">server</p>`;
    // The review's widgets: ten, then twenty bindings of one 60,000-number
    // list (240,000 units). One renders a task; the others wait.
    for (const count of [10, 20]) {
      reads.n = 0;
      const out = await widget({ v: counted(60_000) }, p('v').repeat(count));
      expect(out.every((t) => t.length === 348_889), `${count}: every binding renders`).toBe(true);
      expect(reads.n, `${count}: element reads`).toBe(count * 2 * 60_000);
    }
    // 5,000 units spent first, then twenty bindings of 248,000 each: every
    // one a little heavier than the room left (245,000). Only the first
    // refusal in a task reads its list (weighing queues every element); each
    // later charge is then counted only to the 10,000-unit cap, shorter than a
    // list, so the other nineteen read nothing. In later tasks one binding
    // renders first, and the room left (2,000) is shorter than a list, which
    // is then not walked at all.
    reads.n = 0;
    const out = await widget({ a: Array.from({ length: 1250 }, (_, i) => i), b: counted(62_000) }, p('a') + p('b').repeat(20));
    expect(out.slice(1).every((t) => t.length === 360_889)).toBe(true);
    expect(reads.n).toBe((20 * 2 + 1) * 62_000);
    expect(codes()).toEqual([]);
  });

  it('bindings each too heavy for any task are reported one to a task, each weighed in full once', { timeout: HEAVY_WAIT_TIMEOUT_MS }, async () => {
    // FORMA-178, from FORMA-173's final review: bindings each converting a value
    // too heavy for any task (75,000 numbers, 300,000 units), with nothing spent
    // before them, were each refused as final and each weighed to the whole
    // budget in one task: 20 of them took about 53 ms at 4x, 40 about 99 ms.
    // The list is read through a proxy that counts its element reads, a stand-in
    // for the weighing done: weighing one in full queues, and so reads, all
    // 75,000 of its elements (its length alone counts 75,000 of the 250,000-unit
    // budget), and a task that weighs one in full and holds the rest to the cap
    // reads no more. Now a reported refusal arms the cap as a wait does and
    // counts toward the per-task allowance: the first is weighed in full and
    // reported, the others read none of their list and wait, and each is weighed
    // in full, once, in a task of its own where it runs first.
    const FULL = 75_000;
    for (const count of [20, 40]) {
      container.innerHTML = `<div data-forma-state='{"v":null}'>${'<p data-out data-text="{v === null ? \'\' : v}">server</p>'.repeat(count)}</div>`;
      mountFixture(container);
      const root = container.firstElementChild!;
      const c = counted(75_000);
      reads.n = 0;
      runtime.setScopeValue(root, 'v', c);
      const perTask = [reads.n];
      const reported: number[] = [runtime.getDiagnostics().reduce((n, d) => n + d.count, 0)];
      for (let i = 0; i < count + 10; i++) {
        const before = reads.n;
        await tick();
        perTask.push(reads.n - before);
        reported.push(runtime.getDiagnostics().reduce((n, d) => n + d.count, 0));
      }
      const worst = Math.max(...perTask);
      expect(worst, `${count}: the most element reads in one task`).toBeLessThanOrEqual(FULL + 1_000);
      expect(perTask.reduce((a, b) => a + b, 0), `${count}: each weighed in full once`).toBe(count * FULL);
      expect(runtime.getDiagnostics().map((d) => [d.code, d.count]), `${count}: each reported once`).toEqual([['FORMA_E_BUDGET', count]]);
      expect(Math.max(...reported.map((r, i) => r - (reported[i - 1] ?? 0))), `${count}: the most reported in one task`).toBeLessThanOrEqual(2);
      expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(count);
      expect(texts().every((t) => t.length < 10), `${count}: nothing is converted`).toBe(true);
      unmountFixture(container);
      runtime.clearDiagnostics();
    }
  });

  it('a light binding after a reported refusal renders in the same task', async () => {
    // FORMA-178 keeps FORMA-173's G1: a reported refusal arms the same cap as a
    // wait (10,000 units), not zero, so after one the bindings that fit the cap
    // (a case mapping, a joined list of fifty names, one that charges nothing)
    // still render in the task. Two-sided: a 20,000-unit list is past the cap
    // and waits a task, then renders; the refusal is reported once.
    const names = Array.from({ length: 50 }, (_, i) => `name-${i}`.padEnd(20, '.'));
    const big = Array.from({ length: 5000 }, (_, i) => i);
    container.innerHTML = `<div data-forma-state='${JSON.stringify({ label: 'item', names, big })}'>
      <p data-out data-text="{${spending(300_000)}}">server</p>
      ${'<p data-out data-text="{label.toUpperCase()}">server</p>'.repeat(20)}
      ${'<p data-out data-text="{names.join(\', \')}">server</p>'.repeat(20)}
      ${'<p data-out data-text="{label}">server</p>'.repeat(20)}
      <p data-out data-text="{big}">server</p>
    </div>`;
    mountFixture(container);
    const out = texts();
    expect(out[0]).toBe('server');
    expect(out.slice(1, 21).every((t) => t === 'ITEM'), 'case mappings render in the mount task').toBe(true);
    expect(out.slice(21, 41).every((t) => t === names.join(', ')), 'joined lists render in the mount task').toBe(true);
    expect(out.slice(41, 61).every((t) => t === 'item'), 'free bindings render in the mount task').toBe(true);
    expect(out[61]).toBe('server');
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    await settle();
    expect(texts()[61]).toBe(big.join(','));
    expect(runtime.getDiagnostics().map((d) => [d.code, d.count])).toEqual([['FORMA_E_BUDGET', 1]]);
  });

  it('a cheap refusal that weighed nothing does not delay a binding that fits', async () => {
    // FORMA-249, from FORMA-178's review: `reported` armed the cap on every
    // FORMA_E_BUDGET, but only a refusal the budget meter itself makes (an
    // allocation charge or the step count, `over()`, which sets `defer`) has
    // done any weighing. `repeat()` past its cap of 10,000, `flat()` past its
    // depth, and a string past 1 MiB are refused by a length check before any
    // work, set no `defer`, and counted nothing toward the allowance. After one
    // of them a binding that fits the budget (200,000 of 250,000 units) was
    // past the 10,000-unit cap and rendered one task late; as before FORMA-178
    // it renders in the same task. Each is reported once.
    const cases: [string, string][] = [
      ['repeat() past its cap', `'x'.repeat(20000)`],
      ['flat() past its depth', '[[1]].flat(99)'],
      ['a string past 1 MiB', '`${s}`'],
    ];
    for (const [name, cheap] of cases) {
      container.innerHTML = `<div data-forma-state='{"s":""}'>
        <p data-out data-text="{s.length === 0 ? 0 : ${cheap}}">server</p>
        <p data-out data-text="{s.length === 0 ? 0 : ${spending(200_000)}}">server</p>
      </div>`;
      mountFixture(container);
      runtime.clearDiagnostics();
      runtime.setScopeValue(container.firstElementChild!, 's', 'x'.repeat(1_048_577));
      // A refused binding leaves its previous text ('0') in place.
      expect(texts(), `${name}: the fitting binding renders in the same task`).toEqual(['0', '199990']);
      expect(codes(), `${name}: the refusal is reported`).toEqual(['FORMA_E_BUDGET']);
      await settle();
      expect(texts(), `${name}: nothing else changes`).toEqual(['0', '199990']);
      expect(runtime.getDiagnostics().map((d) => [d.code, d.count]), `${name}: reported once`).toEqual([['FORMA_E_BUDGET', 1]]);
      unmountFixture(container);
      runtime.clearDiagnostics();
    }
  });

  it('a light binding renders in the same task only while at most five too-heavy bindings precede it', { timeout: HEAVY_WAIT_TIMEOUT_MS }, async () => {
    // FORMA-249, from FORMA-178's review: the documented "light bindings still
    // render in the same task" holds only up to a point. Each reported refusal
    // and each wait counts 10,000 units toward the task's 50,000-unit allowance,
    // so after the fifth too-heavy binding the cap is still 10,000, and after the
    // sixth it is 0 and a light binding that charges anything (here
    // `label.toUpperCase()`, twenty of them) waits a tick. N too-heavy bindings,
    // then the twenty; `late` is how many ticks after the update the last light
    // binding renders. Before FORMA-178 it was 0 in every case.
    // - row: each charges 299,990 units that a cost-table row sizes directly, so
    //   it is refused at once and reported in its task; from the sixth in a task
    //   the cap is 0, so the rest wait, six are reported to a task, and the
    //   light bindings render in the task where fewer than six are left.
    // - list: each converts a 75,000-number list (a weighed value), so only the
    //   first in a task is weighed in full and reported, the rest wait, and the
    //   light bindings render once fewer than six are left: N - 5 ticks.
    const light = '<p data-light data-text="{v === null ? \'\' : label.toUpperCase()}">server</p>';
    const forms = {
      row: { heavy: `<p data-text="{v === null ? 0 : ${spending(300_000)}}">server</p>`, value: [1], late: { 1: 0, 5: 0, 6: 1, 7: 1, 10: 1, 12: 2, 20: 3, 40: 6 } },
      list: { heavy: '<p data-text="{v === null ? \'\' : v}">server</p>', value: Array.from({ length: 75_000 }, (_, i) => i), late: { 1: 0, 5: 0, 6: 1, 7: 2, 10: 5, 20: 15, 40: 35 } },
    };
    for (const [form, { heavy, value, late }] of Object.entries(forms)) {
      for (const [n, expected] of Object.entries(late)) {
        const count = Number(n);
        await tick();
        container.innerHTML = `<div data-forma-state='{"v":null,"label":"item"}'>${heavy.repeat(count)}${light.repeat(20)}</div>`;
        mountFixture(container);
        runtime.setScopeValue(container.firstElementChild!, 'v', value);
        const rendered = (): number => [...container.querySelectorAll('[data-light]')].filter((e) => e.textContent === 'ITEM').length;
        let ticks = 0;
        while (rendered() < 20 && ticks < 100) {
          await tick();
          ticks++;
        }
        expect(ticks, `${form} ${count}: ticks after the update before the light bindings render`).toBe(expected);
        await settle(count + 5);
        expect(rendered(), `${form} ${count}: every light binding renders`).toBe(20);
        expect(runtime.getDiagnostics().map((d) => [d.code, d.count]), `${form} ${count}: each too-heavy binding is reported once`).toEqual([['FORMA_E_BUDGET', count]]);
        unmountFixture(container);
        runtime.clearDiagnostics();
      }
    }
  });

  it('a reported refusal counts toward the allowance as a wait does', async () => {
    // FORMA-178: the refusal itself counts the cap (10,000 units) toward the
    // task's allowance (50,000), so the cap drops to 0 after the fifth refusal
    // that follows it, not the sixth as after FORMA-173's wait (the H1 test
    // above: its first refusal at no cap counts nothing). Sixty bindings each a
    // little over the cap (a list of 2,600 numbers, 10,400 units) follow a
    // binding of 300,000 units; a refusal before the drop reads its list once,
    // and one after it reads none of it.
    const p = (): string => '<p data-out data-text="{c === null ? \'\' : c}">server</p>';
    container.innerHTML = `<div data-forma-state='{"c":null}'><p data-out data-text="{c === null ? 0 : ${spending(300_000)}}">server</p>${p().repeat(60)}</div>`;
    mountFixture(container);
    const root = container.firstElementChild!;
    const c = counted(2600);
    reads.n = 0;
    runtime.setScopeValue(root, 'c', c);
    expect(reads.n, 'element reads in the update').toBe(5 * 2600);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    expect(texts().slice(1).filter((t) => t !== '' && t !== 'server')).toHaveLength(0);
    await settle(40);
    expect(texts().slice(1).every((t) => t === c.join(',')), 'every binding renders').toBe(true);
    expect(runtime.getDiagnostics().map((d) => [d.code, d.count])).toEqual([['FORMA_E_BUDGET', 1]]);
  });

  it('a light binding after one that waits renders in the same task', async () => {
    // FORMA-173's review (G1), its light-delay page: a moderate binding, then a
    // heavy one that has to wait, then light ones. Once a binding waits, each
    // later charge is counted only to a cap (10,000 units): a case mapping, a
    // joined list of fifty names (about 1,150 units) and a binding that
    // charges nothing all fit and render in the mount task, as before
    // FORMA-173; with the rest of the task counted as spent they each waited a
    // retry tick. Two-sided: a 20,000-unit list after the wait is past the cap
    // and waits too, then renders.
    const names = Array.from({ length: 50 }, (_, i) => `name-${i}`.padEnd(20, '.'));
    container.innerHTML = `<div data-forma-state='${JSON.stringify({ label: 'item', names, big: Array.from({ length: 5000 }, (_, i) => i) })}'>
      <p data-out data-text="{${spending(100_000)}}">server</p>
      <p data-out data-text="{${spending(200_000)}}">server</p>
      ${'<p data-out data-text="{label.toUpperCase()}">server</p>'.repeat(200)}
      ${'<p data-out data-text="{names.join(\', \')}">server</p>'.repeat(50)}
      ${'<p data-out data-text="{label}">server</p>'.repeat(200)}
      <p data-out data-text="{big}">server</p>
    </div>`;
    mountFixture(container);
    const out = texts();
    const joined = names.join(', ');
    expect(out.slice(0, 2)).toEqual(['99990', 'server']);
    expect(out.slice(2, 202).every((t) => t === 'ITEM'), 'case mappings render in the mount task').toBe(true);
    expect(out.slice(202, 252).every((t) => t === joined), 'joined lists render in the mount task').toBe(true);
    expect(out.slice(252, 452).every((t) => t === 'item'), 'free bindings render in the mount task').toBe(true);
    expect(out[452]).toBe('server');
    await settle();
    expect(texts()[1]).toBe('199990');
    expect(texts()[452]).toHaveLength(Array.from({ length: 5000 }, (_, i) => i).join(',').length);
    expect(codes()).toEqual([]);
  });

  it("the cap drops to 0 once the task's refusals have counted the allowance", { timeout: HEAVY_DROP_TIMEOUT_MS }, async () => {
    // FORMA-173's review (H1): the cap bounds what each binding after a wait
    // counts, not what they count together. Its pages: 5,000 units, a binding
    // of 248,000 that waits, then 400 bindings each a little over the cap (a
    // list of 2,600 numbers, 10,400 units) or a little under it (2,400
    // numbers, 9,600 units), all handed their values in one update. Once the
    // refusals after the wait have counted 50,000 units, the cap drops to 0
    // and each later binding is refused on its list's length, reading none of
    // it; without the allowance every one of the 400 lists was read.
    // Two-sided: after the drop, a light binding that charges anything (a
    // case mapping) waits a tick; one that charges nothing renders at once.
    for (const [k, rendered, refusedReading] of [[2600, 0, 6], [2400, 25, 10]] as const) {
      const p = (expr: string): string => `<p data-out data-text="{c === null ? '' : ${expr}}">server</p>`;
      container.innerHTML = `<div data-forma-state='{"a":null,"b":null,"c":null,"label":"item"}'>${p('a') + p('b') + p('c').repeat(400) + p('label.toUpperCase()') + p('label')}</div>`;
      mountFixture(container);
      const root = container.firstElementChild!;
      const c = counted(k);
      reads.n = 0;
      batch(() => {
        runtime.setScopeValue(root, 'a', Array.from({ length: 1250 }, (_, i) => i));
        runtime.setScopeValue(root, 'b', Array.from({ length: 62_000 }, (_, i) => i));
        runtime.setScopeValue(root, 'c', c);
      });
      // A binding that renders reads its list twice (to weigh it, and for
      // String()); a refusal before the drop reads it once, queueing it to be
      // weighed; a refusal after the drop reads none of it.
      expect(reads.n, `${k}: element reads in the update`).toBe(rendered * 2 * k + refusedReading * k);
      const list = c.join(',');
      let out = texts();
      expect(out.slice(2, 402).filter((t) => t === list), `${k}: rendered in the update`).toHaveLength(rendered);
      expect(out.slice(402), `${k}: after the drop`).toEqual(['', 'item']);
      await settle(100);
      out = texts();
      expect(out[1]).toHaveLength(Array.from({ length: 62_000 }, (_, i) => i).join(',').length);
      expect(out.slice(2, 402).every((t) => t === list), `${k}: every binding renders`).toBe(true);
      expect(out.slice(402)).toEqual(['ITEM', 'item']);
      expect(codes()).toEqual([]);
      unmountFixture(container);
    }
  });

  it("a $dispatch from inside a binding keeps the task's cap", { timeout: HEAVY_DISPATCH_TIMEOUT_MS }, async () => {
    // FORMA-173's review, its nit. A binding dispatches an event; the handler
    // it reaches writes state, and the batch that write closes flushes the
    // bindings still queued, inside the dispatching binding's evaluation. Ten
    // bindings of a 60,000-number list follow a binding that waits, and should
    // be refused reading none of their lists. Two placements:
    // - the dispatching binding reads `a`, so it runs before `b` waits: the
    //   bindings flushed inside it must see the cap the wait sets meanwhile
    //   (the cap is read from the meter at each charge, not copied);
    // - it reads `b`, so it runs after the wait: the handler starts no task
    //   of its own, so it must not reset the cap (`begin`).
    // Either way, before the fix one list was counted to the room left,
    // fitted and rendered, read twice: 120,000 reads.
    for (const on of ['a', 'b']) {
      const p = (k: string): string => `<p data-out data-text="{${k} === null ? '' : ${k}}">server</p>`;
      const ping = `<p data-out data-text="{${on} === null ? '' : [$dispatch('ping'), 1][1]}">server</p>`;
      container.innerHTML = `<div data-forma-state='{"a":null,"b":null,"c":null,"n":0}' data-on:ping="{n = n + 1}">${p('a') + p('b') + ping + p('c').repeat(10)}</div>`;
      mountFixture(container);
      const root = container.firstElementChild!;
      const c = counted(60_000);
      reads.n = 0;
      batch(() => {
        runtime.setScopeValue(root, 'a', Array.from({ length: 1250 }, (_, i) => i));
        runtime.setScopeValue(root, 'b', Array.from({ length: 62_000 }, (_, i) => i));
        runtime.setScopeValue(root, 'c', c);
      });
      expect(runtime.getScopes()[0]!.values.n!.value, `${on}: the handler ran`).toBe(1);
      expect(texts()[2]).toBe('1');
      expect(reads.n, `${on}: element reads of the ten lists after the wait`).toBe(0);
      await settle(60);
      expect(texts().slice(3).every((t) => t === c.join(',')), `${on}: every binding renders`).toBe(true);
      expect(codes()).toEqual([]);
      unmountFixture(container);
    }
  });

  it('an allocation refusal after a task spent only steps is reported at once', async () => {
    // Steps spent do not change whether a charge fits: with no units spent
    // before it, a binding's own charges were counted against the whole
    // budget, so a refusal is final, not deferred to be priced again.
    container.innerHTML = `<div data-forma-state='{}'>
      <p data-out data-text="{1 + 2 * 3}">server</p>
      <p data-out data-text="{${spending(150_000)} + ${spending(150_000)}}">server</p>
    </div>`;
    mountFixture(container);
    expect(texts()).toEqual(['7', 'server']);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    await settle();
    expect(runtime.getDiagnostics().map((d) => [d.code, d.count])).toEqual([['FORMA_E_BUDGET', 1]]);
  });

  it('a chain of computeds spends one budget between them', async () => {
    // `b` spends 150,000 units and then reads `a`, which spends 150,000 more.
    // With a budget each (2.0.3), the binding answered in one task that spent
    // both; now `a` is refused inside `b`, evaluated alone in the next task,
    // and the binding answers from its cached value.
    container.innerHTML = `<div data-forma-state='{}'
        data-computed="a = ${spending(150_000)}; b = ${spending(150_000)} + a">
      <p data-out data-text="{b}">server</p>
    </div>`;
    mountFixture(container);
    expect(texts()).toEqual(['server']);
    await settle();
    expect(texts()).toEqual(['299980']);
    expect(codes()).toEqual([]);
  });

  it('a computed refused inside a heavy reader is evaluated again on its own', async () => {
    // The reader spends 200,000 before it reads `a` (100,000), so `a` is
    // refused there. Its failure is not cached as an answer: another reader
    // of `a` alone renders, and so does the heavy reader, in later tasks.
    container.innerHTML = `<div data-forma-state='{}' data-computed="a = ${spending(100_000)}">
      <p data-out data-text="{${spending(200_000)} + a}">server</p>
      <p data-out data-text="{a}">server</p>
    </div>`;
    mountFixture(container);
    expect(texts()).toEqual(['server', 'server']);
    await settle();
    expect(texts()).toEqual(['299980', '99990']);
    expect(codes()).toEqual([]);
  });

  it('the handlers one event reaches share one budget', async () => {
    // A click bubbles through two handlers that each spend 150,000 units. In
    // one task they cannot both run: the outer is refused and reported (a
    // handler cannot be retried). The next click is a new task.
    container.innerHTML = `<div data-forma-state='{"inner": 0, "outer": 0}'>
      <div id="outer" data-on:click="{outer = ${spending(150_000)}}">
        <button id="inner" data-on:click="{inner = ${spending(150_000)}}">go</button>
      </div>
      <p data-out data-text="{inner + '/' + outer}">server</p>
    </div>`;
    mountFixture(container);
    expect(texts()).toEqual(['0/0']);
    await tick();
    (container.querySelector('#inner') as HTMLElement).click();
    expect(runtime.getScopes()[0]!.values.inner!.value).toBe(149_990);
    expect(runtime.getScopes()[0]!.values.outer!.value).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    expect(container.querySelector('#outer')!.getAttribute('data-forma-handler-error')).toBe('unsupported');
    // Two-sided: the outer handler alone, on its own event, runs.
    (container.querySelector('#outer') as HTMLElement).click();
    expect(runtime.getScopes()[0]!.values.outer!.value).toBe(149_990);
    await settle();
    expect(texts()).toEqual(['149990/149990']);
  });

  it('a handler leaves its bindings what it did not spend', async () => {
    // The handler spends 200,000 units; the binding it updates needs 100,000
    // more, so it renders in the next task instead of in the click's.
    container.innerHTML = `<div data-forma-state='{"n": 0}'>
      <button id="go" data-on:click="{n = ${spending(200_000)}}">go</button>
      <p data-out data-text="{n === 0 ? 'none' : ${spending(100_000)} + n}">server</p>
    </div>`;
    mountFixture(container);
    expect(texts()).toEqual(['none']);
    await tick();
    (container.querySelector('#go') as HTMLElement).click();
    expect(texts()).toEqual(['none']);
    await settle();
    expect(texts()).toEqual(['299980']);
    expect(codes()).toEqual([]);
  });

  it('a binding a keystroke updates starts on a fresh budget', async () => {
    // Input is scheduled ahead of timers, so a keystroke can run before the
    // timer that zeroes the meter. The search it updates spends 200,000 units:
    // if the previous keystroke's spending were still counted, it would be
    // deferred to the next task instead of answering this one.
    container.innerHTML = `<div data-forma-state='{"q": ""}'>
      <input id="q" data-model="{q}">
      <p data-out data-text="{${spending(200_000)} + q.length}">server</p>
    </div>`;
    mountFixture(container);
    await tick();
    const input = container.querySelector('#q') as HTMLInputElement;
    for (const text of ['a', 'ab', 'abc']) {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      expect(texts()).toEqual([String(199_990 + text.length)]);
    }
    expect(codes()).toEqual([]);
  });

  it("a data-list's rows share the task's budget", async () => {
    // Ten rows, each binding spending 100,000 units: two rows a task.
    container.innerHTML = `<div data-forma-state='{"rows": [0,1,2,3,4,5,6,7,8,9]}'>
      <ul data-list="{rows}"><li data-out data-text="{${spending(100_000)} + item}">row</li></ul>
    </div>`;
    mountFixture(container);
    expect(texts().filter((t) => t !== 'row')).toHaveLength(2);
    await settle();
    expect(texts()).toEqual(Array.from({ length: 10 }, (_, i) => String(99_990 + i)));
    expect(codes()).toEqual([]);
  });
});
