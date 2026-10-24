#!/usr/bin/env node
// node harness/score.mjs  -> results/summary.json
// Reads results/raw/<event>/<car>.json, scores per PROTOCOL.md: F1 points 25,18,15,12,10,8,6,4,2,1 by
// position, ties share their positions' points; Server = events 1-8, Client = 9-11, Overall = points
// per event entered by each stack (Amendment 2). Event 7 is two scored parts (image size, gzip bytes), each its own contest.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, EVENTS, stats } from './lib.mjs';
import { scoringProfile } from './score-profile.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const rawRoot = path.resolve(option('--raw', path.join(ROOT, 'results', 'raw')));
const output = path.resolve(option('--out', path.join(ROOT, 'results', 'summary.json')));

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// Finds the first numeric value or array of numbers under any of the given key names (breadth first).
function deepFind(obj, names) {
  const q = [obj];
  while (q.length) {
    const o = q.shift();
    if (!o || typeof o !== 'object') continue;
    for (const k of names) {
      const v = o[k];
      if (typeof v === 'number') return [v];
      if (Array.isArray(v) && v.length && v.every(x => typeof x === 'number')) return v;
      if (Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object')) {
        const inner = v.map(x => deepFind(x, names)?.[0]).filter(x => typeof x === 'number');
        if (inner.length) return inner;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) { const f = deepFind(v, ['total', 'value', 'mean', 'bytes']); if (f) return f; }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') q.push(v);
  }
  return null;
}
const own = raw => (Array.isArray(raw.values) && raw.values.length ? raw.values : null);
// One geometric mean per run across a record's benchmarks or operations ({name: {runs: [...]}}), so the
// spread shown is run to run, not one figure. Every operation stays in; a reading below the clock's
// resolution (Chrome's performance.now steps by 0.1 ms) counts as that resolution, not as zero.
function perRunGeomeans(group, floor = 0) {
  const lists = Object.values(group || {}).map(b => b?.runs);
  if (!lists.length || lists.some(l => !Array.isArray(l) || !l.length || l.length !== lists[0].length || l.some(x => typeof x !== 'number' || !isFinite(x)))) return null;
  return lists[0].map((_, i) => Math.exp(lists.reduce((a, l) => a + Math.log(Math.max(l[i], floor) || Number.MIN_VALUE), 0) / lists.length));
}
const CONTESTS = [
  { id: 'sprint', n: '1', title: 'SSR Sprint', group: 'server', unit: 'req/s', better: 'higher', get: own },
  { id: 'endurance', n: '2', title: 'SSR Endurance', group: 'server', unit: 'req/s', better: 'higher', get: own },
  { id: 'multicore', n: '3', title: 'Multi-core', group: 'server', unit: 'req/s', better: 'higher', get: own },
  { id: 'reaction', n: '4', title: 'Reaction time', group: 'server', unit: 'ms p99', better: 'lower', get: own },
  { id: 'fuel', n: '5', title: 'Fuel', group: 'server', unit: 'MiB peak', better: 'lower', get: own },
  { id: 'grid', n: '6', title: 'Grid start', group: 'server', unit: 'ms', better: 'lower', get: own },
  { id: 'weight', part: 'image', n: '7a', title: 'Weight: image size', group: 'server', unit: 'bytes', better: 'lower', get: r => r.parts?.image?.values },
  { id: 'weight', part: 'gzip', n: '7b', title: 'Weight: gzip response', group: 'server', unit: 'bytes', better: 'lower', get: r => r.parts?.gzip?.values },
  { id: 'pitstop', n: '8', title: 'Pit stop', group: 'server', unit: 'ms build', better: 'lower', get: own },
  { id: 'dom', n: '9', title: 'DOM race', group: 'client', unit: 'ms geomean', better: 'lower',
    get: r => own(r) || perRunGeomeans(r.ops, 0.1) || deepFind(r, ['runGeomeans', 'geomeans', 'geomeanMs', 'geomean_ms', 'geomean', 'score', 'value']) },
  { id: 'bundle', n: '10', title: 'Bundle', group: 'client', unit: 'bytes Brotli', better: 'lower',
    get: r => own(r) || deepFind(r, ['brotli', 'brotliBytes', 'br']) },
  { id: 'signals', n: '11', title: 'Signals', group: 'client', unit: 'ops/s geomean', better: 'higher',
    get: r => own(r) || perRunGeomeans(r.benches) || deepFind(r, ['geomeanOpsPerSec', 'runGeomeans', 'geomeans', 'geomeanOps', 'geomean', 'opsGeomean', 'score', 'value']) },
];

function loadRaw() {
  const out = {}, base = rawRoot;
  if (!fs.existsSync(base)) return out;
  for (const ev of fs.readdirSync(base)) {
    const dir = path.join(base, ev);
    if (!fs.statSync(dir).isDirectory()) continue;
    out[ev] = {};
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      try { out[ev][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { console.error('unreadable', ev, f, e.message); }
    }
  }
  return out;
}

export function rankWithPoints(entries, better) {
  const sorted = [...entries].sort((a, b) => better === 'higher' ? b.mean - a.mean : a.mean - b.mean);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && Math.abs(sorted[j + 1].mean - sorted[i].mean) <= 1e-12 * Math.max(1, Math.abs(sorted[i].mean))) j++;
    let pts = 0; for (let k = i; k <= j; k++) pts += POINTS[k] || 0;
    for (let k = i; k <= j; k++) { sorted[k].rank = i + 1; sorted[k].points = pts / (j - i + 1); sorted[k].tied = j > i; }
    i = j + 1;
  }
  return sorted;
}

const raw = loadRaw();
const resourceQualification = scoringProfile(raw);
const contests = [];
for (const def of CONTESTS) {
  const entries = [];
  for (const [car, r] of Object.entries(raw[def.id] || {})) {
    const v = def.get(r);
    if (!v || !v.length || v.some(x => typeof x !== 'number' || !isFinite(x))) continue;
    const s = stats(v);
    entries.push({ car, mean: s.mean, sd: s.sd, n: s.n, min: s.min, max: s.max, values: v, source: `results/raw/${def.id}/${car}.json` });
  }
  const standings = rankWithPoints(entries, def.better);
  if (def.id === 'pitstop') for (const e of standings) { const rr = raw.pitstop[e.car]?.rust; if (rr?.buildMs != null) e.reportedApart = { label: 'Rust compile (not scored)', ms: rr.buildMs }; }
  if (def.id === 'weight') for (const e of standings) { e.extra = def.part === 'gzip' ? { rawBytes: raw.weight[e.car].parts.gzip.rawBytes } : {}; }
  if (def.id === 'sprint' || def.id === 'endurance' || def.id === 'multicore') for (const e of standings) e.extra = { bytesPerRequest: raw[def.id][e.car].bytesPerRequest, nonOk: (raw[def.id][e.car].runs || []).reduce((a, r) => a + (r.nonOk || 0), 0) };
  contests.push({ id: def.id + (def.part ? '-' + def.part : ''), event: def.id, n: def.n, title: def.title, group: def.group, unit: def.unit, better: def.better, standings,
    metric: Object.values(raw[def.id] || {})[0]?.metric || null });
}

function championship(group) {
  const by = {};
  for (const c of contests.filter(c => !group || c.group === group)) {
    // Event 7's two parts (image size, gzip bytes) are half an event each, so Weight counts once.
    const w = c.event === 'weight' ? 0.5 : 1;
    for (const s of c.standings) { const e = (by[s.car] ||= { car: s.car, points: 0, events: 0, perEvent: {} }); e.points += s.points * w; e.events += w; e.perEvent[c.n] = s.points * w; }
  }
  const list = Object.values(by).map(e => ({ ...e, mean: e.points / e.events }));
  return rankPoints(list, 'points');
}
// Overall ranks stacks (PROTOCOL.md Amendment 2): a server car with the client cars of the UI library it
// ships to the browser, scored as points per event entered. Astro ships no script on this page.
export const STACKS = {
  forma: { ui: 'forma', signals: 'forma' },
  'vanilla-node': { ui: 'vanilla' }, 'vanilla-bun': { ui: 'vanilla' }, 'vanilla-deno': { ui: 'vanilla' },
  'react-node': { ui: 'react' }, 'react-bun': { ui: 'react' }, 'react-deno': { ui: 'react' }, next: { ui: 'react' }, 'react-router': { ui: 'react' },
  'preact-node': { ui: 'preact', signals: 'preact-signals' }, 'solid-node': { ui: 'solid', signals: 'solid' },
  'svelte-node': { ui: 'svelte' }, 'vue-node': { ui: 'vue', signals: 'vue-reactivity' }, astro: {},
};
function overall() {
  const by = {};
  for (const c of contests) {
    const w = c.event === 'weight' ? 0.5 : 1;
    for (const s of c.standings) {
      const owners = c.group === 'server' ? [s.car]
        : Object.keys(STACKS).filter(k => (c.event === 'signals' ? STACKS[k].signals : STACKS[k].ui) === s.car);
      for (const car of owners) {
        const e = (by[car] ||= { car, stack: [STACKS[car]?.ui, STACKS[car]?.signals].filter(Boolean), points: 0, events: 0, perEvent: {} });
        e.points += s.points * w; e.events += w; e.perEvent[c.n] = s.points * w;
      }
    }
  }
  for (const e of Object.values(by)) e.stack = [...new Set(e.stack)];
  return rankPoints(Object.values(by).map(e => ({ ...e, mean: e.points / e.events })), 'mean');
}
function rankPoints(list, key) {
  list.sort((a, b) => b[key] - a[key]);
  list.forEach((e, i) => { e.rank = i > 0 && Math.abs(list[i - 1][key] - e[key]) < 1e-9 ? list[i - 1].rank : i + 1; e.pointsPerEvent = e.points / e.events; });
  return list;
}

const smoke = Object.fromEntries(Object.entries(raw.smoke || {}).map(([car, r]) => [car, { pass: r.pass, at: r.at, checks: r.checks, imageBytes: r.image?.sizeBytes, readyMs: r.readyMs }]));
const dnq = Object.entries(smoke).filter(([, s]) => !s.pass).map(([car]) => car);

// machine states, one per event (from the first car's record or the runner's _machine.json)
const machine = {};
for (const e of EVENTS) {
  const dir = path.join(rawRoot, e.id);
  let m = null;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, '_machine.json'), 'utf8')); } catch {}
  const first = Object.values(raw[e.id] || {})[0];
  machine[e.id] = m || first?.machine || null;
}

// Telemetry: what the raw records hold beyond the scored figure, per car (not scored).
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const latency = (r, k) => avg((r?.runs || []).map(x => x.latencyMs?.[k]).filter(v => typeof v === 'number'));
const parseMiB = t => { const m = /([\d.]+)\s*(KiB|MiB|GiB)/.exec(t || ''); return m ? +m[1] * ({ KiB: 1 / 1024, MiB: 1, GiB: 1024 })[m[2]] : null; };
const telemetry = { server: {}, dom: {}, signals: {}, signalsVersionCheck: {} };
for (const car of Object.keys(raw.sprint || {})) {
  const sp = raw.sprint[car], en = raw.endurance?.[car], mc = raw.multicore?.[car], re = raw.reaction?.[car], fu = raw.fuel?.[car], gr = raw.grid?.[car], we = raw.weight?.[car], pi = raw.pitstop?.[car];
  const rps = r => avg(r?.values || []), spR = rps(sp), enR = rps(en), mcR = rps(mc);
  const load = (r, R) => r && { rps: R, p50: latency(r, 'p50'), p95: latency(r, 'p95'), p99: latency(r, 'p99'), max: latency(r, 'max'), mbPerS: R * r.bytesPerRequest / 1e6, bytes: r.bytesPerRequest };
  telemetry.server[car] = {
    sprint: load(sp, spR), endurance: load(en, enR), multicore: load(mc, mcR),
    scaling: mcR / spR, multicoreCpus: Number(resourceQualification.resourceProfile?.classB.cpus ?? 4), scaling4: mcR / spR, loss100to1000: spR / enR,
    usPerPage100: 1e6 / spR, usPerPage1000: 1e6 / enR,
    nsPerByte: en && (1e9 / enR - 1e9 / spR) / (en.bytesPerRequest - sp.bytesPerRequest),
    reaction: re && { mean: latency(re, 'mean'), p50: latency(re, 'p50'), p99: avg(re.values), max: latency(re, 'max') },
    idleMiB: parseMiB(fu?.idleAtStart), peakMiB: avg(fu?.values || []), rpsPerMiB: spR / avg(fu?.values || []),
    grid: gr && { total: avg(gr.values), dockerRun: avg(gr.runs.map(r => r.dockerRunReturnedMs)), appBoot: avg(gr.runs.map(r => r.ms - r.dockerRunReturnedMs)) },
    imageBytes: we?.parts?.image?.values?.[0], gzipBytes: we?.parts?.gzip?.values?.[0], rawBytes: we?.parts?.gzip?.rawBytes, compressesWhenAsked: we?.parts?.gzip?.contentEncodingWhenAsked || null,
    buildMs: avg(pi?.values || []), buildSplit: pi?.runs?.[0]?.fmirMs != null ? { fmirMs: avg(pi.runs.map(r => r.fmirMs)), appCompileMs: avg(pi.runs.map(r => r.appCompileMs)), coldRustMs: pi.rust?.buildMs } : null,
  };
}
for (const [car, r] of Object.entries(raw.dom || {})) if (r.ops) telemetry.dom[car] = Object.fromEntries(Object.entries(r.ops).map(([op, o]) => [op, { mean: o.mean, sd: o.sd }]));
for (const [car, r] of Object.entries(raw.signals || {})) if (r.benches) telemetry.signals[car] = { version: r.version, benches: Object.fromEntries(Object.entries(r.benches).map(([b, o]) => [b, { mean: o.mean, sd: o.sd }])) };
for (const [car, r] of Object.entries(raw['signals-version-check'] || {})) if (r.benches) telemetry.signalsVersionCheck[car] = { version: r.version, geomean: r.geomeanOpsPerSec, measuredAt: r.measuredAt, benches: Object.fromEntries(Object.entries(r.benches).map(([b, o]) => [b, { mean: o.mean, sd: o.sd }])) };

const summary = {
  generated: new Date().toISOString(), points: POINTS, ...resourceQualification,
  rule: 'Formula 1 points 25,18,15,12,10,8,6,4,2,1; ties share their positions\' points. Server = events 1-8 (event 7 has two parts, image size and gzip bytes, each scored apart at half weight), Client = 9-11, Overall = stacks (a server car with the client cars of the UI library it ships, Amendment 2), points per event entered.',
  contests, championships: { server: championship('server'), client: championship('client'), overall: overall() },
  smoke, dnq, machine, telemetry,
  configs: Object.fromEntries(EVENTS.map(e => [e.id, Object.values(raw[e.id] || {})[0]?.config || null])),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(summary, null, 2));
for (const c of contests) console.log(`${c.n.padEnd(3)} ${c.title.padEnd(24)} ${c.standings.map(s => `${s.rank}.${s.car} ${s.mean.toFixed(2)}±${s.sd.toFixed(2)} (${s.points}p)`).join('  ') || '(no entries)'}`);
for (const g of ['server', 'client', 'overall']) console.log(g.toUpperCase().padEnd(8), summary.championships[g].map(e => `${e.rank}.${e.car} ${g === 'overall' ? e.mean.toFixed(1) + '/ev' : e.points}`).join('  ') || '(none)');
if (dnq.length) console.log('DNQ (failed smoke):', dnq.join(', '));
