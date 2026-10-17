#!/usr/bin/env node
/**
 * Mutation-probe harness — a curated mutation-testing run.
 *
 * Each entry in `probes/corpus.json` is one surgical edit that breaks a real
 * property of this codebase, and most of them are edits that reproduce a defect
 * this repo actually shipped (see `docs/archive/2026-08-05-hardening-audit.md`). The harness
 * requires a clean baseline, applies each edit, records executed assertion
 * failures, restores the file, and verifies the restored suite. Infrastructure
 * errors and plain Error-only failures are UNQUALIFIED, never mutation kills.
 *
 * A SURVIVOR is always news: it means a property nothing in the suite defends.
 *
 * Why this and not Stryker: Stryker generates thousands of mutants, most of
 * them equivalent or uninteresting. This curated run also takes substantial
 * time with strict serial evidence; every mutant is a defect shape we have been bitten
 * by, so the score is meaningful rather than merely large. Every probe written
 * during a bug investigation gets committed here, which is what makes the audit
 * compound instead of expire.
 *
 * Usage:
 *   node scripts/run-probes.mjs                 # full run, writes probes/results.json
 *   node scripts/run-probes.mjs --check         # anchors only, no test runs (seconds)
 *   node scripts/run-probes.mjs --only=a,b      # named probes
 *   node scripts/run-probes.mjs --tag=security  # one subset
 *   node scripts/run-probes.mjs --floor=85      # exit non-zero below this rate
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { cleanProbeBaseline, classifyProbe, recoverableProbeFailure } from './probe-results.mjs';
import { expressionProbeFloor } from './expression-probe-floor.mjs';

const ROOT = process.cwd();
const CORPUS = resolve(ROOT, 'probes/corpus.json');
const OUT = resolve(ROOT, 'probes/results.json');

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const checkOnly = args.includes('--check');
const only = flag('only')?.split(',');
const tag = flag('tag');
const floor = flag('floor') === undefined ? null : Number(flag('floor'));
if (floor !== null && (!Number.isFinite(floor) || floor < 0 || floor > 100)) throw new Error('invalid detection floor');
const expressionFloor = flag('expr-floor') === undefined ? null : Number(flag('expr-floor'));
if (expressionFloor !== null && (!Number.isFinite(expressionFloor) || expressionFloor < 0 || expressionFloor > 100)) throw new Error('invalid expression floor');

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
const selected = corpus.filter(
  (p) => (!only || only.includes(p.id)) && (!tag || (p.tags ?? []).includes(tag)),
);

/**
 * `probe-corpus.test.ts` asserts that every probe's anchor still applies to the
 * file it names — by reading that production file. Under a probe, the anchor it
 * just replaced is by definition gone, so that test fails for EVERY mutant and
 * every mutant scores as CAUGHT whether or not a real test noticed. This lane's
 * own first measurement reported 93/93 for exactly that reason and was wrong.
 * It is excluded here, and it is the only file that may be.
 */
const SELF_REFERENTIAL = '**/probe-corpus.test.ts';
// Parallel bail can interrupt a second failing test before its completion
// event (observed in hosted run 38956279949). Serialize both files and explicit
// concurrent tests; do not turn incomplete assertion records into kills.
const VITEST_ARGS = ['--reporter=dot', '--reporter', fileURLToPath(new URL('./probe-reporter.mjs', import.meta.url)), '--bail=1', '--maxWorkers=1', '--maxConcurrency=1', '--exclude', SELF_REFERENTIAL];

// Resolve the installed workspace package; it may be hoisted by npm ci.
const require = createRequire(import.meta.url);
let vitest;
if (!checkOnly) {
  try { vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'); }
  catch { console.error('vitest not installed — run npm ci first'); process.exit(2); }
}
if (!selected.length || only?.some(id => !selected.some(probe => probe.id === id))) throw new Error('no probes or unknown probe selected');

// Validate every anchor before running a baseline or changing production source.
const results = [], originals = new Map();
for (const p of selected) {
  const abs = resolve(ROOT, p.file);
  if (!existsSync(abs)) { results.push({ id: p.id, file: p.file, status: 'FILE_MISSING' }); continue; }
  const original = readFileSync(abs, 'utf8'), norm = original.replace(/\r\n/g, '\n');
  const hits = norm.split(p.find).length - 1;
  if (hits === 0 || (hits > 1 && !p.all)) results.push({ id: p.id, file: p.file, status: 'ANCHOR_STALE', hits });
  else { originals.set(abs, original); if (checkOnly) results.push({ id: p.id, status: 'APPLIES' }); }
}
if (checkOnly) {
  console.log(`${results.filter(r => r.status === 'APPLIES').length}/${selected.length} probes still apply`);
  process.exit(results.some(r => r.status !== 'APPLIES') ? 1 : 0);
}
if (results.length) {
  writeFileSync(OUT, JSON.stringify(results, null, 1) + '\n');
  console.error('unqualified mutation anchors:', results);
  process.exit(1);
}

const runsRoot = resolve(ROOT, 'probes/runs'); mkdirSync(runsRoot, { recursive: true });
const runDir = mkdtempSync(join(runsRoot, 'run-'));
const persist = () => {
  const text = JSON.stringify(results, null, 1) + '\n';
  writeFileSync(OUT, text); writeFileSync(join(runDir, 'results.json'), text);
};
function execute(label) {
  const reportPath = join(runDir, `${label}.json`);
  const r = spawnSync(process.execPath, [vitest, 'run', ...VITEST_ARGS], {
    cwd: ROOT, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, FORMA_PROBE_REPORT: reportPath },
  });
  writeFileSync(join(runDir, `${label}.log`), `${r.stdout ?? ''}${r.stderr ?? ''}`);
  const processResult = { status: r.status, signal: r.signal, error: r.error?.message ?? null };
  writeFileSync(join(runDir, `${label}.process.json`), JSON.stringify(processResult, null, 2) + '\n');
  return { processResult, text: existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '' };
}
function baseline(label) {
  const r = execute(label);
  try { return cleanProbeBaseline(r.text, r.processResult); }
  catch (error) { console.error(`unqualified ${label}: ${error.message}; raw evidence: ${runDir}`); process.exit(1); }
}
function verifyRestoredSources() {
  for (const [path, original] of originals) {
    if (!readFileSync(path).equals(Buffer.from(original))) throw new Error(`source was not restored: ${path}`);
  }
}
persist(); // A failed new baseline cannot leave old canonical mutation results.
const before = baseline('baseline-before');
console.log(`clean baseline: ${before.filter(test => test.state === 'passed').length} executed tests; ${runDir}`);
let invalid = false;
for (const [index, p] of selected.entries()) {
  const abs = resolve(ROOT, p.file), original = originals.get(abs);
  if (readFileSync(abs, 'utf8') !== original) throw new Error(`source changed before mutation: ${p.file}`);
  const row = { id: p.id, file: p.file, tags: p.tags ?? [], note: p.note, equivalent: p.equivalent ?? null };
  let recoverable = false;
  try {
    writeFileSync(abs, original.replace(/\r\n/g, '\n').split(p.find).join(p.replace));
    const label = `mutant-${index}-${p.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`, r = execute(label);
    row.evidence = `${runDir}/${label}.json`;
    try {
      const result = classifyProbe(r.text, r.processResult, before);
      Object.assign(row, result, { status: result.caught ? 'CAUGHT' : p.equivalent ? 'EQUIVALENT' : 'SURVIVED' });
    } catch (error) {
      Object.assign(row, { status: 'UNQUALIFIED', killedBy: null, error: error.message }); invalid = true;
      recoverable = recoverableProbeFailure(r.text, r.processResult, before);
    }
    results.push(row); persist();
    console.log(`${p.id.padEnd(44)} ${row.status}${row.killedBy ? `  ${row.killedBy}` : ''}`);
  } finally {
    writeFileSync(abs, original);
  }
  // A completed body exception is useful evidence but never a kill. Continue
  // only after exact source restoration and a fresh, unchanged clean baseline.
  // invalid stays sticky: collecting later evidence cannot rescue this run.
  if (row.status === 'UNQUALIFIED') {
    if (!recoverable) break;
    const label = `recovery-${index}`, recovery = { evidence: `${runDir}/${label}.json`, passed: false };
    row.recovery = recovery;
    try {
      verifyRestoredSources();
      const r = execute(label);
      cleanProbeBaseline(r.text, r.processResult);
      if (classifyProbe(r.text, r.processResult, before).caught) throw new Error('recovery baseline failed');
      verifyRestoredSources();
      recovery.passed = true;
    } catch (error) { recovery.error = error.message; }
    persist();
    if (!recovery.passed) break;
  }
}
// One restored run for the campaign, not another suite for every mutation.
const afterRun = execute('baseline-after');
try {
  cleanProbeBaseline(afterRun.text, afterRun.processResult);
  const restored = classifyProbe(afterRun.text, afterRun.processResult, before);
  if (restored.caught) throw new Error('restored source failed');
} catch (error) { console.error(`unqualified restored baseline: ${error.message}; raw evidence: ${runDir}`); invalid = true; }
persist();
if (invalid) { console.error(`mutation campaign is unqualified; raw evidence: ${runDir}`); process.exit(1); }

const scored = results.filter((r) => r.status === 'CAUGHT' || r.status === 'SURVIVED');
const rate = (subset) =>
  subset.length ? Math.round((100 * subset.filter((r) => r.status === 'CAUGHT').length) / subset.length) : null;

const overall = rate(scored);
const security = rate(scored.filter((r) => (r.tags ?? []).includes('security')));

console.log('\n--- detection ---');
console.log(`overall        ${scored.filter((r) => r.status === 'CAUGHT').length}/${scored.length} = ${overall}%`);
if (security !== null) console.log(`security       ${security}%`);

const equivalent = results.filter((r) => r.status === 'EQUIVALENT');
if (equivalent.length) {
  console.log(`\nequivalent mutants, excluded from the rate (${equivalent.length}):`);
  for (const e of equivalent) console.log(`  ${e.id.padEnd(40)} ${e.equivalent}`);
}

const survivors = results.filter((r) => r.status === 'SURVIVED');
if (survivors.length) {
  console.log('\nsurvivors (each one is a property nothing defends):');
  for (const s of survivors) console.log(`  ${s.id.padEnd(40)} ${s.note}`);
}

if (expressionFloor !== null) {
  const expression = expressionProbeFloor(selected, results, expressionFloor);
  writeFileSync(resolve(ROOT, 'probes/expression-floor.json'), JSON.stringify(expression, null, 2) + '\n');
  console.log(`expression ${expression.caught}/${expression.caught + expression.survived} = ${expression.rate.toFixed(2)}%`);
  if (!expression.passed) process.exit(1);
}

if (floor !== null && overall < floor) {
  console.error(`\ndetection ${overall}% is below the ${floor}% floor`);
  process.exit(1);
}
