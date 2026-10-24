// Adapted from the 2.x showcase races/reactive-core.ts (signal creation, updates, effects, chain, batch,
// diamond, cache hit), reshaped to the adapter interface. Each returns { n, ms }: n operations in ms.
let sink = 0;
export const getSink = () => sink;
const now = () => performance.now();

export const BENCHES = [
  { name: 'signal create', run(lib) {
    const n = 200_000; const t = now();
    for (let i = 0; i < n; i++) sink += lib.signal(i) ? 1 : 0;
    return { n, ms: now() - t };
  } },
  { name: 'signal read', run(lib) {
    const s = lib.signal(7); const n = 2_000_000; let acc = 0; const t = now();
    for (let i = 0; i < n; i++) acc += s.get();
    const ms = now() - t; sink += acc; return { n, ms };
  } },
  { name: 'write with one effect', run(lib) {
    const s = lib.signal(0); let acc = 0;
    const dispose = lib.effect(() => { acc += s.get(); });
    const n = 200_000; const t = now();
    for (let i = 1; i <= n; i++) s.set(i);
    const ms = now() - t; dispose(); sink += acc; return { n, ms };
  } },
  { name: 'computed cache hit', run(lib) {
    const s = lib.signal(42); const c = lib.computed(() => s.get() * 2 + Math.sqrt(s.get()));
    c.get(); const n = 2_000_000; let acc = 0; const t = now();
    for (let i = 0; i < n; i++) acc += c.get();
    const ms = now() - t; sink += acc; return { n, ms };
  } },
  { name: 'chain of 100', run(lib) {
    const root = lib.signal(0); let tip = root;
    for (let i = 0; i < 100; i++) { const prev = tip; tip = lib.computed(() => prev.get() + 1); }
    tip.get(); const n = 5_000; let acc = 0; const t = now();
    for (let i = 1; i <= n; i++) { root.set(i); acc += tip.get(); }
    const ms = now() - t; sink += acc; return { n, ms };
  } },
  { name: 'diamond (500 middles)', run(lib) {
    const root = lib.signal(0);
    const mids = Array.from({ length: 500 }, (_, i) => lib.computed(() => root.get() + i));
    const sinkC = lib.computed(() => { let t = 0; for (let i = 0; i < mids.length; i++) t += mids[i].get(); return t; });
    sinkC.get(); const n = 1_000; let acc = 0; const t = now();
    for (let i = 1; i <= n; i++) { root.set(i); acc += sinkC.get(); }
    const ms = now() - t; sink += acc; return { n, ms };
  } },
  { name: 'fan-out to 100 effects', run(lib) {
    const s = lib.signal(0); let acc = 0;
    const ds = Array.from({ length: 100 }, () => lib.effect(() => { acc += s.get(); }));
    const n = 5_000; const t = now();
    for (let i = 1; i <= n; i++) s.set(i);
    const ms = now() - t; ds.forEach((d) => d()); sink += acc; return { n, ms };
  } },
  { name: 'effect create and dispose', run(lib) {
    const s = lib.signal(1); let acc = 0; const n = 100_000; const t = now();
    for (let i = 0; i < n; i++) { const d = lib.effect(() => { acc += s.get(); }); d(); }
    const ms = now() - t; sink += acc; return { n, ms };
  } },
  { name: 'batch of 100 writes', run(lib) {
    const sigs = Array.from({ length: 100 }, () => lib.signal(0)); let acc = 0;
    const dispose = lib.effect(() => { let t = 0; for (let i = 0; i < 100; i++) t += sigs[i].get(); acc += t; });
    const n = 2_000; const t = now();
    for (let b = 1; b <= n; b++) lib.batch(() => { for (let i = 0; i < 100; i++) sigs[i].set(b); });
    const ms = now() - t; dispose(); sink += acc; return { n, ms };
  } },
];
