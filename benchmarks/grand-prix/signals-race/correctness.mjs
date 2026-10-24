// Behavioural check every adapter must pass before its speed is trusted.
export function correctness(lib) {
  const results = [];
  const check = (name, ok, note) => results.push({ name, ok: !!ok, ...(note ? { note } : {}) });

  // 1. computed over two signals, one batch -> effect re-runs once (libraries without batch: twice, noted)
  {
    const a = lib.signal(1), b = lib.signal(2);
    let cRuns = 0, eRuns = 0, seen = 0;
    const c = lib.computed(() => { cRuns++; return a.get() + b.get(); });
    const dispose = lib.effect(() => { eRuns++; seen = c.get(); });
    const e0 = eRuns, c0 = cRuns;
    lib.batch(() => { a.set(10); b.set(20); });
    const reruns = eRuns - e0, recomputes = cRuns - c0;
    check('computed value after batch', seen === 30 && c.get() === 30);
    if (lib.noBatch) check('batch coalescing (library has no public batch; documented)', reruns === 2, `effect re-ran ${reruns}x, computed ${recomputes}x`);
    else check('computed updates once per batch', reruns === 1 && recomputes === 1, `effect re-ran ${reruns}x, computed ${recomputes}x`);
    dispose();
  }
  // 2. effect re-runs on write, stops after dispose
  {
    const s = lib.signal(0);
    let runs = 0, last = -1;
    const dispose = lib.effect(() => { runs++; last = s.get(); });
    check('effect runs once at creation', runs === 1);
    s.set(1); s.set(2);
    check('effect re-runs on each write', runs === 3 && last === 2);
    s.set(2);
    check('equal write does not re-run', runs === 3);
    dispose();
    s.set(3);
    check('effect stops after dispose', runs === 3 && last === 2);
  }
  // 3. computed is cached until a dependency changes
  {
    const s = lib.signal(5);
    let runs = 0;
    const c = lib.computed(() => { runs++; return s.get() * 2; });
    c.get(); c.get(); c.get();
    check('computed cache hit', runs === 1 && c.get() === 10);
    s.set(6);
    check('computed recomputes after write', c.get() === 12 && runs === 2);
  }
  // 4. chain of 100 and diamond are exact
  {
    const root = lib.signal(0);
    let tip = { get: () => root.get() };
    for (let i = 0; i < 100; i++) { const prev = tip; tip = lib.computed(() => prev.get() + 1); }
    check('chain of 100', tip.get() === 100);
    root.set(5);
    check('chain of 100 after write', tip.get() === 105);
    const r = lib.signal(1);
    const mids = Array.from({ length: 500 }, (_, i) => lib.computed(() => r.get() + i));
    let sinkRuns = 0;
    const sink = lib.computed(() => { sinkRuns++; let t = 0; for (const m of mids) t += m.get(); return t; });
    check('diamond sum', sink.get() === 500 + 124750);
    const before = sinkRuns; r.set(2);
    check('diamond after write, sink once', sink.get() === 1000 + 124750 && sinkRuns - before === 1, `sink ran ${sinkRuns - before}x`);
  }
  // 5. fan-out: every effect sees every write
  {
    const s = lib.signal(0);
    let total = 0;
    const ds = Array.from({ length: 100 }, () => lib.effect(() => { total += s.get() ? 1 : 0; }));
    s.set(1);
    check('fan-out reaches 100 effects', total === 100);
    ds.forEach((d) => d());
    s.set(2);
    check('fan-out disposed', total === 100);
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { CARS } = await import('./cars.mjs');
  let bad = 0;
  for (const car of process.argv[2] ? [process.argv[2]] : CARS) {
    const lib = (await import(`./adapters/${car}.mjs`)).default;
    const r = correctness(lib);
    const fails = r.filter((x) => !x.ok);
    bad += fails.length;
    console.log(`${lib.name}@${lib.version}: ${r.length - fails.length}/${r.length} ok`, fails.length ? JSON.stringify(fails) : '');
  }
  process.exit(bad ? 1 : 0);
}
