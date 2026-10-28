import fs from 'node:fs';
import path from 'node:path';
import { describe, stableStringify, compareMeans } from './statistics.mjs';
import { scoringProfile } from '../harness/score-profile.mjs';
import { validateCampaign } from '../harness/campaign.mjs';
import { validateProfile, parseCpuList, validateContainerResources } from '../harness/resource-profile.mjs';
import assert from 'node:assert/strict';

const EVENTS = {
  sprint: ['SSR · 100 rows', 'req/s', 'higher'],
  endurance: ['SSR · 1,000 rows', 'req/s', 'higher'],
  multicore: ['SSR · multiple cores', 'req/s', 'higher'],
  reaction: ['Request latency · p99', 'ms', 'lower'],
  fuel: ['Sampled container memory peak', 'MiB', 'lower'],
  grid: ['Container launch to first successful page', 'ms', 'lower'],
  pitstop: ['Production build', 'ms', 'lower'],
  weight: ['Runtime and response size', 'bytes', 'lower'],
  dom: ['DOM operations · script, style and layout', 'ms', 'lower'],
  bundle: ['Client JavaScript size', 'bytes', 'lower'],
  signals: ['Reactive operations', 'ops/s', 'higher'],
  'signals-version-check': ['Reactive reference version control', 'ops/s', 'higher'],
  islands: ['Island activation and interaction', 'ms', 'lower'],
};
const SERVER = new Set(['sprint', 'endurance', 'multicore', 'reaction', 'fuel', 'grid', 'pitstop', 'weight']);
const ordered = xs => [...xs].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const md = value => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const fmt = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 });
const percent = value => value === null || value === undefined ? '—' : `${fmt(value * 100)}%`;

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function loadEvidence(runDir) {
  const groups = [], evidence = [], errors = [], archives = [];
  const excluded = /^(?:node_modules|target|dist|\.git|contexts|harness-source|client-race|signals-race|contestants)$/;
  const relative = file => path.relative(runDir, file).split(path.sep).join('/');
  function readRecord(file, event, records, sources) {
    const source = relative(file), car = path.basename(file, '.json');
    try {
      const value = readJSON(file);
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Expected an object');
      (records[event] ||= {})[car] = value;
      sources[`${event}/${car}`] = source;
      evidence.push({ event, car, source, supported: Boolean(EVENTS[event]) || event === 'smoke' });
    } catch (error) { errors.push(`${source}: ${error.message}`); }
  }
  function visit(dir, depth) {
    if (depth > 12) { errors.push(`${relative(dir)}: discovery depth limit reached.`); return; }
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    if (path.basename(dir) === 'raw') {
      const records = {}, sources = {};
      for (const event of entries.filter(entry => entry.isDirectory())) {
        const eventDir = path.join(dir, event.name);
        for (const file of fs.readdirSync(eventDir, { withFileTypes: true })) {
          if (file.isFile() && file.name.endsWith('.json') && !file.name.startsWith('_')) readRecord(path.join(eventDir, file.name), event.name, records, sources);
        }
      }
      groups.push({ trial: relative(path.dirname(dir)) || '.', records, sources });
      return;
    }
    const islands = {}, islandSources = {};
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !excluded.test(entry.name) && !entry.name.endsWith('-contexts')) visit(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.zip')) archives.push(relative(file));
      else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'report.json') {
        // Island driver writes competitor JSON directly under islands-<run>/.
        try { const record = readJSON(file); if (record?.protocol === 'forma-264-island-v1' && record.car === path.basename(file, '.json')) readRecord(file, 'islands', islands, islandSources); } catch {}
      }
    }
    if (Object.keys(islands).length) {
      let driver = null;
      try { if (fs.existsSync(path.join(dir, 'run.json'))) driver = readJSON(path.join(dir, 'run.json')); }
      catch (error) { errors.push(`${relative(path.join(dir, 'run.json'))}: ${error.message}`); }
      groups.push({ trial: relative(dir) || '.', records: islands, sources: islandSources, driver });
    }
  }
  if (fs.existsSync(runDir)) visit(runDir, 0);
  return { groups, evidence, errors, archives };
}

function machineIdentity(machine = {}) {
  const m = machine.before || machine;
  return {
    cpu: m.cpu ?? m.hostCpuModel, cores: m.cores ?? m.cpus ?? m.visibleCores ?? m.hostCpus,
    platform: m.platform, node: m.node, chrome: m.chrome,
    dockerCpus: m.dockerCpus, dockerMemGB: m.dockerMemGB, dockerVersion: m.dockerVersion,
    dockerKernel: m.dockerKernel, cgroupCpuMax: m.cgroupCpuMax,
  };
}

function measurementContext(raw, manifest) {
  const config = { ...(raw.config || {}) };
  delete config.forced;
  return {
    config, class: raw.class, rows: raw.rows, concurrency: raw.concurrency,
    durationS: raw.durationS, warmupS: raw.warmupS, warmups: raw.warmups,
    // Timing-method revisions must never be silently compared.
    clock: raw.clock ?? raw.timingMethod ?? raw.protocolVersion,
    resourceProfile: raw.resourceProfile ?? raw.config?.resourceProfile,
    campaign: raw.campaign ?? null,
    browser: raw.browser ? { sha256: raw.browser.sha256, version: raw.browser.version } : undefined,
    machine: raw.machine ? machineIdentity(raw.machine) : manifest.environment,
  };
}

export function validateIslandEvidence(raw, driver) {
  assert(driver?.protocol === 'forma-264-island-v1', 'Adjacent island driver run.json required');
  assert.equal(driver.passed, true, 'Island driver did not pass');
  assert.equal(driver.qualifiedProfile, true); assert.equal(driver.diagnostic, false);
  assert.deepEqual(driver.failures, []);
  const profile = validateProfile(raw.resourceProfile);
  assert.equal(profile.qualified, true); assert.equal(profile.diagnostic, false);
  assert.equal(raw.qualifiedProfile, true); assert.equal(raw.verified, true);
  assert.deepEqual(driver.resourceProfile, profile);
  validateCampaign(raw.campaign); assert.deepEqual(driver.campaign, raw.campaign);
  if (profile.name === 'gha-4-v1') assert.equal(raw.campaign.kind, 'github-actions');
  assert(/^[a-f0-9]{40}$/.test(raw.sourceCommit || ''), 'Exact island source commit required');
  assert.equal(driver.sourceCommit, raw.sourceCommit);
  assert.equal(raw.runs, 5); assert.equal(raw.warmups, 2);
  assert.equal(raw.samples?.length, 5); assert.equal(raw.warmupSamples?.length, 2);
  for (const sample of [...raw.samples, ...raw.warmupSamples]) {
    assert.equal(sample.verified, true); assert.deepEqual(sample.errors, []); assert.deepEqual(sample.failedJavaScript, []);
    assert(!sample.failure); assert.equal(sample.clickMs?.length, 2);
    assert(sample.javascript?.length, 'Retained script transfer evidence required');
    assert(sample.javascript.every(resource => resource.status === 200 && !resource.fromDiskCache && !resource.fromServiceWorker && Number.isFinite(resource.transferredBytes) && resource.transferredBytes > 0));
    assert.equal(sample.transferredJavaScriptBytes, sample.javascript.reduce((sum, resource) => sum + resource.transferredBytes, 0));
  }
  assert(/^[a-f0-9]{64}$/.test(raw.browser?.sha256 || ''), 'Browser digest required');
  assert.equal(driver.browser?.executableSha256, raw.browser.sha256, 'Raw browser differs from driver lock');
  assert.equal(raw.machine?.platform, 'linux'); assert.equal(raw.machine?.arch, driver.browser.arch);
  assert(raw.browser.version, 'Browser version required');
  assert.equal(raw.browser.version.split('/').at(-1), driver.browser.version, 'Browser version differs from driver lock');
  assert(Number(driver.engine?.cpus) >= profile.minimumCpus, 'Driver engine lacks required CPUs');
  assert(driver.engine?.os && !/docker desktop/i.test(driver.engine.os), 'Native Linux Docker engine required');
  if (profile.browser.cpuset !== null) {
    assert.deepEqual(raw.processAffinity, parseCpuList(profile.browser.cpuset));
    assert.deepEqual(raw.browser.processAffinity, parseCpuList(profile.browser.cpuset));
  }
  const steps = driver.steps?.filter(step => step.car === raw.car) || [];
  assert.equal(steps.length, 1, 'Exactly one matching island driver step required');
  const step = steps[0]; assert.equal(step.passed, true); assert.equal(step.sourceCommit, raw.sourceCommit);
  assert.equal(step.container?.id, raw.container?.id); assert.equal(step.image?.id, raw.container?.image);
  assert(/^[a-f0-9]{64}$/.test(raw.container?.id || ''), 'Full container identity required');
  assert(/^sha256:[a-f0-9]{64}$/.test(step.image.id), 'Full image digest required');
  assert.equal(step.container.nanoCpus, raw.container.nanoCpus); assert.equal(step.container.memoryBytes, raw.container.memoryBytes);
  validateContainerResources({ HostConfig: { NanoCpus: step.container.nanoCpus, Memory: step.container.memoryBytes, CpusetCpus: step.container.cpuset } }, profile.classA);
  assert(driver.cars?.includes(raw.car), 'Driver did not select this island car');
  return true;
}

function validation(event, raw, smoke) {
  const reasons = [];
  if (raw.campaign) { try { validateCampaign(raw.campaign); } catch (error) { reasons.push(`Invalid campaign: ${error.message}`); } }
  if (raw.error || raw.failure || raw.status === 'failed') reasons.push(String(raw.error || raw.failure || 'Runner failed.'));
  if (raw.correct === false || raw.verified === false || raw.pass === false) reasons.push('Correctness gate failed.');
  if (raw.checks?.some(check => check.ok === false)) reasons.push('At least one correctness check failed.');
  if (raw.pageErrors?.length) reasons.push(`${raw.pageErrors.length} browser error(s).`);
  if (event === 'islands' && raw.samples?.some(sample => sample.verified !== true || sample.errors?.length || sample.failure)) reasons.push('At least one browser sample failed its checks.');
  if (Array.isArray(raw.runs) && raw.runs.some(run => run.nonOk > 0 || (typeof run.successRate === 'number' && run.successRate < 1))) {
    reasons.push('Timed HTTP requests include errors; successful-request throughput is retained as diagnostic evidence.');
  }
  if (SERVER.has(event)) {
    if (smoke?.pass === false) reasons.push('Server correctness gate failed.');
    if (smoke?.image?.id && raw.image?.id && smoke.image.id !== raw.image.id) reasons.push('Smoke check and measurement used different images.');
  }
  if (reasons.length) return { status: 'excluded', reasons };
  if (event.startsWith('signals') && raw.correct !== true) return { status: 'unverified', reasons: ['No passing reactive correctness record.'] };
  if (['dom', 'islands'].includes(event) && raw.verified !== true) return { status: 'unverified', reasons: ['No passing browser correctness record.'] };
  if (SERVER.has(event) && smoke?.pass !== true && raw.verified !== true) return { status: 'unverified', reasons: ['No passing server correctness record.'] };
  return { status: 'measured', reasons: [] };
}

function qualityWarnings(raw, event, stats, manifest) {
  const warnings = [];
  const states = raw.machine?.before ? [raw.machine.before, raw.machine.after || {}] : [raw.machine || {}];
  if (states.some(m => m.quiet === false)) warnings.push('Host was recorded as busy; treat timing differences as exploratory.');
  else if (states.some(m => (m.loadavg?.[0] ?? m.hostLoadAvg?.[0] ?? 0) >= (m.cores ?? m.visibleCores ?? m.hostCpus ?? Infinity))) {
    warnings.push('Host load reached or exceeded its visible core count.');
  }
  if (raw.config?.forced) warnings.push('Runner bypassed a preflight gate.');
  if (stats?.n === 1 && !['weight', 'bundle'].includes(event)) warnings.push('One sample cannot estimate repeatability.');
  else if (stats && stats.n < 5 && !['weight', 'bundle'].includes(event)) warnings.push('Fewer than five samples: limited precision.');
  if (stats?.cv > 0.1) warnings.push('Run-to-run variation exceeds 10% of the mean.');
  if (raw.resourceProfile?.diagnostic || raw.config?.resourceProfile?.diagnostic || raw.qualifiedProfile === false) warnings.push('Diagnostic resource profile; not a qualified baseline.');
  if (manifest.mode === 'smoke' || manifest.profile === 'smoke' || manifest.config?.profile === 'smoke') warnings.push('Smoke profile: checks the harness, not performance.');
  if (event === 'fuel') warnings.push('Docker memory accounting sampled between requests; not process RSS, allocation volume, or a guaranteed instantaneous peak.');
  if (event === 'grid') warnings.push('Includes Docker launch and host polling overhead.');
  return warnings;
}

function series(event, raw) {
  const def = EVENTS[event];
  if (!def) return [];
  const out = [];
  const add = (metric, label, values, unit = def[1], direction = def[2], primary = true) => out.push({ metric, label, values, unit, direction, primary });
  if (event === 'islands') {
    const samples = raw.samples || [];
    for (const [key, label, unit] of [
      ['readinessMs', 'Navigation to readiness', 'ms'], ['activationMs', 'Native activation · framework-specific boundary', 'ms'],
      ['htmlBytes', 'Response HTML', 'bytes'], ['transferredJavaScriptBytes', 'Transferred JavaScript including response overhead', 'bytes'],
    ]) {
      const unavailable = key === 'activationMs' && samples.length > 0 && samples.every(sample => sample[key] === null) && ['next', 'astro'].includes(raw.car);
      add(key, label, unavailable ? null : samples.map(sample => sample[key]), unit);
      if (unavailable) { out.at(-1).unavailable = true; out.at(-1).required = false; }
    }
    // Two clicks in one context are not independent contexts: keep each position separate.
    add('click-1', 'First click to update', samples.map(sample => sample.clickMs?.[0]));
    add('click-2', 'Second click to update', samples.map(sample => sample.clickMs?.[1]));
    return out;
  }
  if (event === 'dom' || event.startsWith('signals')) {
    const group = raw[event === 'dom' ? 'ops' : 'benches'] || {};
    for (const key of ordered(Object.keys(group))) {
      add(key, key, group[key]?.runs);
      const unbatched = event.startsWith('signals') && key.toLowerCase().includes('batch') && (raw.noBatch === true || raw.checks?.some(check => check.name?.includes('library has no public batch')));
      out.at(-1).comparable = group[key]?.comparable !== false && !unbatched;
      out.at(-1).comparabilityNote = group[key]?.comparabilityNote ?? group[key]?.reason ?? group[key]?.note ?? (unbatched ? 'No public batch API; recorded work is uncoalesced writes, not equivalent batching.' : null);
    }
    if (!out.length) add('operations', 'Operation samples', null);
    return out;
  }
  if (event === 'bundle') {
    for (const [key, label] of [['brotli', 'JavaScript · Brotli'], ['gzip', 'JavaScript · gzip'], ['bytes', 'JavaScript · uncompressed']]) add(key, label, raw[key] === undefined ? null : [raw[key]]);
    return out;
  }
  if (event === 'weight') {
    add('image', 'Runtime image', raw.parts?.image?.values);
    add('gzip', 'Response · gzip level 9', raw.parts?.gzip?.values);
    add('response', 'Response · uncompressed', raw.parts?.gzip?.rawBytes === undefined ? null : [raw.parts.gzip.rawBytes]);
    return out;
  }
  add('value', def[0], raw.values);
  if (['sprint', 'endurance', 'multicore', 'reaction'].includes(event) && Array.isArray(raw.runs)) {
    for (const key of ['mean', 'p50', 'p95', 'p99', 'max']) {
      if (event === 'reaction' && key === 'p99') continue;
      if (raw.runs.some(run => run.latencyMs?.[key] !== undefined)) add(`latency-${key}`, `Request latency · ${key} per run`, raw.runs.map(run => run.latencyMs?.[key]), 'ms', 'lower', false);
    }
    if (raw.bytesPerRequest !== undefined) add('response-bytes', 'Bytes per response', [raw.bytesPerRequest], 'bytes', 'lower', false);
  }
  if (event === 'pitstop' && Array.isArray(raw.runs)) {
    for (const key of ['fmirMs', 'appCompileMs']) if (raw.runs.some(run => run[key] !== undefined)) add(key, key === 'fmirMs' ? 'FMIR build · diagnostic component' : 'App crate compile · diagnostic component', raw.runs.map(run => run[key]), 'ms', 'lower', false);
    if (raw.rust?.buildMs !== undefined) add('cold-rust', 'Cold Rust build · separate diagnostic', [raw.rust.buildMs], 'ms', 'lower', false);
  }
  return out;
}

function expectedEntries(manifest) {
  if (Array.isArray(manifest.expected)) return manifest.expected;
  const selection = manifest.selection || manifest.config || {};
  const events = selection.events || manifest.events || [];
  const cars = selection.cars || manifest.cars || [];
  if (!Array.isArray(events) || !Array.isArray(cars)) return [];
  return events.flatMap(event => cars.map(car => ({ event, car })));
}

export function collectReport(runDir) {
  const manifestFile = path.join(runDir, 'manifest.json');
  const manifest = fs.existsSync(manifestFile) ? readJSON(manifestFile) : { id: path.basename(runDir), status: 'historical', mode: 'legacy' };
  const { groups, evidence, errors, archives } = loadEvidence(runDir);
  const measurements = [];
  for (const { trial, records, sources, driver } of groups) {
  let qualification = null, qualificationError = null;
  try { qualification = scoringProfile(records); } catch (error) { qualificationError = error.message; }
  for (const event of Object.keys(EVENTS)) {
    for (const car of ordered(Object.keys(records[event] || {}))) {
      const raw = records[event][car];
      const gate = validation(event, raw, records.smoke?.[car]);
      let rowQualification = qualificationError ? 'unverified' : qualification?.diagnostic === false ? 'qualified' : 'exploratory';
      if (event === 'islands' && raw.qualifiedProfile === true) {
        try { validateIslandEvidence(raw, driver); rowQualification = 'qualified'; }
        catch (error) { rowQualification = 'unverified'; if (gate.status !== 'excluded') gate.status = 'unverified'; gate.reasons.push(`Island qualification failed: ${error.message}`); }
      }
      if (car.endsWith('.failed')) { gate.status = 'excluded'; gate.reasons.push('Runner retained this record as a failed attempt.'); }
      if (qualificationError && event !== 'islands') { if (gate.status !== 'excluded') gate.status = 'unverified'; gate.reasons.push(`Qualification failed: ${qualificationError}`); }
      for (const item of series(event, raw)) {
        let stats = null, status = gate.status;
        const reasons = [...gate.reasons];
        try { stats = describe(item.values); } catch (error) { status = 'invalid'; reasons.push(error.message); }
        if (stats && typeof raw.runs === 'number' && ['dom', 'signals', 'signals-version-check', 'islands'].includes(event) && stats.n !== raw.runs) {
          status = 'invalid'; reasons.push(`Expected ${raw.runs} samples, found ${stats.n}.`);
        }
        if (!stats && status !== 'invalid' && status !== 'excluded') {
          status = item.unavailable && gate.status === 'measured' ? 'unavailable' : 'missing';
          reasons.push(item.unavailable ? 'Framework does not expose the same native activation boundary; common readiness is reported separately.' : 'No numeric sample series was recorded.');
        }
        measurements.push({ trial, campaignId: raw.campaign?.id ?? null, event, eventLabel: EVENTS[event][0], car, version: raw.version ?? null, ...item, samples: item.values ?? [], values: undefined,
          status, reasons, statistics: stats, warnings: [...qualityWarnings(raw, event, stats, manifest), ...(item.comparabilityNote ? [item.comparabilityNote] : [])],
          qualification: rowQualification,
          source: sources[`${event}/${car}`], context: measurementContext(raw, manifest) });
      }
    }
  }
  }
  for (const { event, car } of expectedEntries(manifest)) {
    if (!EVENTS[event] || groups.some(group => group.records[event]?.[car])) continue;
    measurements.push({ trial: 'expected', campaignId: null, event, eventLabel: EVENTS[event][0], car, metric: 'missing', label: EVENTS[event][0], unit: EVENTS[event][1], direction: EVENTS[event][2], primary: true,
      samples: [], status: 'missing', reasons: ['Selected event/competitor produced no raw record.'], statistics: null, warnings: [], source: null, context: {} });
  }
  const comparisons = [];
  for (const forma of measurements.filter(row => row.car === 'forma' && row.primary)) {
    for (const other of measurements.filter(row => row.car !== 'forma' && row.trial === forma.trial && row.event === forma.event && row.metric === forma.metric)) {
      const reasons = [];
      if (forma.status !== 'measured' || other.status !== 'measured') reasons.push('Both measurements must pass their correctness and sample checks.');
      if (forma.comparable === false || other.comparable === false) reasons.push('Adapter does not implement equivalent operation semantics; diagnostic samples only.');
      if (stableStringify(forma.context) !== stableStringify(other.context)) reasons.push('Recorded workload, runtime or machine differs.');
      if (!forma.campaignId || !other.campaignId || forma.campaignId !== other.campaignId) reasons.push('Same-campaign provenance is required for ratios.');
      if (forma.event === 'islands' && forma.metric === 'activationMs') reasons.push('Internal activation boundaries differ by framework; inspect these observations separately.');
      const difference = reasons.length ? null : compareMeans(other.statistics, forma.statistics, forma.direction);
      if (!difference && !reasons.length) reasons.push('A zero or unavailable baseline mean cannot produce a ratio.');
      comparisons.push({ trial: forma.trial, campaignId: forma.campaignId, event: forma.event, metric: forma.metric, label: forma.label, competitor: other.car, direction: forma.direction,
        status: difference ? 'descriptive' : 'not-comparable', reasons, ...difference,
        warnings: [...new Set([...forma.warnings, ...other.warnings])], formaSource: forma.source, competitorSource: other.source });
    }
  }
  // Paired source trials intentionally share a campaign. Prefer an explicitly
  // named published control; never pick the fastest or most recent baseline.
  const sourceComparisons = [];
  const published = measurements.filter(row => row.car === 'forma' && row.primary && path.basename(row.trial) === 'published');
  for (const current of measurements.filter(row => row.car === 'forma' && row.primary && path.basename(row.trial) !== 'published')) {
    const candidates = published.filter(row => row.event === current.event && row.metric === current.metric && row.campaignId === current.campaignId);
    if (candidates.length !== 1) continue;
    const baseline = candidates[0], reasons = [];
    if (!current.campaignId) reasons.push('No campaign provenance.');
    if (current.status !== 'measured' || baseline.status !== 'measured') reasons.push('Both source trials must pass correctness and sample checks.');
    if (current.comparable === false || baseline.comparable === false) reasons.push('Adapter operation semantics are not equivalent.');
    if (stableStringify(current.context) !== stableStringify(baseline.context)) reasons.push('Recorded workload, runtime or machine differs.');
    const difference = reasons.length ? null : compareMeans(baseline.statistics, current.statistics, current.direction);
    if (!difference && !reasons.length) reasons.push('No positive baseline mean.');
    sourceComparisons.push({ trial: current.trial, baselineTrial: baseline.trial, campaignId: current.campaignId, event: current.event, metric: current.metric,
      label: current.label, competitor: `Forma published control (${baseline.trial})`, direction: current.direction, status: difference ? 'descriptive' : 'not-comparable',
      reasons, ...difference, warnings: [...new Set([...current.warnings, ...baseline.warnings])], formaSource: current.source, competitorSource: baseline.source });
  }
  const warnings = [...errors];
  if (!fs.existsSync(manifestFile)) warnings.push('Historical evidence has no versioned run manifest. It cannot establish an improvement against a new run.');
  if (!manifest.testHash && !manifest.testFingerprint) warnings.push('No test fingerprint: cross-run improvement claims are disabled.');
  if (!measurements.length) warnings.push('No recognized measurements were recorded.');
  if (archives.length) warnings.push(`${archives.length} ZIP archive(s) retained but not expanded. Summaries are not substituted for raw samples; analyze a verified extraction to review its measurements.`);
  if (manifest.status && !['completed', 'complete', 'passed', 'historical', 'imported'].includes(manifest.status)) warnings.push(`Run status is ${manifest.status}; this report may contain partial evidence.`);
  return {
    schemaVersion: 1, title: 'Forma Grand Prix · Engineering evidence', runId: manifest.id ?? manifest.runId ?? path.basename(runDir),
    status: manifest.status ?? 'unknown', manifestAvailable: fs.existsSync(manifestFile), manifest, warnings, measurements, comparisons, sourceComparisons, evidence, archives,
    interpretation: 'Comparisons describe this workload on the recorded machine. No overall score, winner, statistical significance, or causal improvement is inferred. Missing, failed, and incompatible evidence remains visible.',
    nextSteps: [
      'Investigate Forma metrics with a lower observed throughput or a higher observed time/size, starting with low-variation repeated results.',
      'Repeat noisy timings on a quiet, controlled machine; use identical test fingerprints, workload settings and environment for historical comparisons.',
      'Keep response size, runtime architecture and build-cache differences visible when explaining a result.',
    ],
  };
}

function findingText(comparison) {
  if (comparison.status !== 'descriptive') return `${comparison.trial} · ${comparison.event} / ${comparison.label} vs ${comparison.competitor}: not comparable (${comparison.reasons.join(' ')})`;
  const effect = comparison.improvementPercent;
  const relation = Math.abs(effect) < 1e-10 ? 'equal observed mean' : effect > 0 ? 'favorable observed mean' : 'improvement opportunity';
  return `${comparison.trial} · ${comparison.event} / ${comparison.label} vs ${comparison.competitor}: ${relation}; Forma ${fmt(comparison.ratio)}× the competitor mean (${fmt(Math.abs(comparison.changePercent))}% ${comparison.changePercent < 0 ? 'lower' : 'higher'}, ${comparison.direction} is preferred).${comparison.warnings.length ? ' Exploratory: ' + comparison.warnings.join(' ') : ''}`;
}

function toMarkdown(report) {
  const lines = [
    '# Forma Grand Prix · Engineering evidence', '', `Run: **${md(report.runId)}** · Status: **${md(report.status)}**`, '', report.interpretation, '',
    `[Machine-readable report](report.json) · [Measurement table](measurements.csv)${report.manifestAvailable ? ' · [Run manifest](manifest.json)' : ''}`, '',
    '## Evidence quality', '', ...(report.warnings.length ? report.warnings.map(w => `- ${md(w)}`) : ['- Run provenance is available. Per-measurement caveats below still apply.']), '',
    'Mean and median summarize recorded samples. SD is sample standard deviation; CV = SD / mean. A single sample has no SD/CV. No outliers are discarded. Counts represent repetitions, not individual requests.', '',
    '## Forma observations', '', ...report.comparisons.map(c => `- ${md(findingText(c))}`), '',
    '## Paired Forma source observations', '', ...(report.sourceComparisons.length ? report.sourceComparisons.map(c => `- ${md(findingText(c))}`) : ['No unambiguous published/candidate control pair in one campaign.']), '',
    '## Measurements', '', '| Trial / event / metric | Competitor | Status | n | Mean | Median | SD | CV | Min | Max | Unit |', '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const row of report.measurements) {
    const s = row.statistics;
    lines.push(`| ${md(row.trial)} / ${md(row.event)} / ${md(row.label)} | ${md(row.car)} | ${row.status} | ${s?.n ?? 0} | ${fmt(s?.mean)} | ${fmt(s?.median)} | ${fmt(s?.sd)} | ${percent(s?.cv)} | ${fmt(s?.min)} | ${fmt(s?.max)} | ${md(row.unit)} |`);
  }
  lines.push('', '## Raw samples and caveats', '');
  for (const row of report.measurements) lines.push(`- **${md(row.trial)} / ${md(row.event)} / ${md(row.label)} / ${md(row.car)}:** ${row.source ? `[raw record](${encodeURI(row.source)})` : 'No raw record'}. Campaign: ${md(row.campaignId || 'unrecorded')}. Samples: ${row.samples.map(fmt).join(', ') || 'none'}. ${[...row.reasons, ...row.warnings].map(md).join(' ')}`);
  lines.push('', '## Retained archives', '', ...report.archives.map(source => `- [${md(source)}](${encodeURI(source)}) — not expanded or remeasured.`));
  lines.push('', '## Additional evidence', '', ...report.evidence.filter(item => !item.supported).map(item => `- [${md(item.source)}](${encodeURI(item.source)}) — instrumentation record; no aggregate metric inferred.`));
  lines.push('', '## Investigation plan', '', ...report.nextSteps.map(step => `- ${step}`), '');
  return lines.join('\n');
}

function toHTML(report) {
  const groups = Object.keys(EVENTS).filter(event => report.measurements.some(row => row.event === event));
  const sections = groups.map(event => {
    const rows = report.measurements.filter(row => row.event === event);
    return `<section id="${event}"><h2>${html(EVENTS[event][0])}</h2><p>Preferred direction: ${html(EVENTS[event][2])}. Every result retains its original samples and caveats.</p><div class="table-scroll"><table><caption>${html(EVENTS[event][0])} · measurements</caption><thead><tr>${['Metric', 'Competitor', 'Status', 'n', 'Mean', 'Median', 'SD', 'CV', 'Min–max', 'Unit', 'Evidence'].map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => {
      const s = row.statistics;
      return `<tr><th scope="row">${html(row.label)}<small>Trial: ${html(row.trial)}</small></th><td>${html(row.car)}${row.version ? `<small>${html(row.version)}</small>` : ''}</td><td>${html(row.status)}</td><td>${s?.n ?? 0}</td><td>${fmt(s?.mean)}</td><td>${fmt(s?.median)}</td><td>${fmt(s?.sd)}</td><td>${percent(s?.cv)}</td><td>${fmt(s?.min)}–${fmt(s?.max)}</td><td>${html(row.unit)}</td><td><details><summary>Samples and caveats</summary><p>Campaign: ${html(row.campaignId || 'unrecorded')}</p><p>${html(row.samples.map(fmt).join(', ') || 'No samples')}</p>${[...row.reasons, ...row.warnings].map(w => `<p>${html(w)}</p>`).join('')}${row.source ? `<a href="${html(encodeURI(row.source))}">Raw JSON</a>` : ''}</details></td></tr>`;
    }).join('')}</tbody></table></div></section>`;
  }).join('');
  const observations = [...report.comparisons, ...report.sourceComparisons].length ? [...report.comparisons, ...report.sourceComparisons].map(c => `<li>${html(findingText(c))}</li>`).join('') : '<li>No comparable Forma/competitor pairs are available in this run.</li>';
  const inventory = `<section><h2>Evidence inventory</h2><details><summary>${report.evidence.length} raw records · ${report.archives.length} unexpanded archives</summary><ul>${report.evidence.map(item => `<li><a href="${html(encodeURI(item.source))}">${html(item.source)}</a>${item.supported ? '' : ' · instrumentation record; no aggregate metric inferred'}</li>`).join('')}${report.archives.map(source => `<li><a href="${html(encodeURI(source))}">${html(source)}</a> · not expanded or remeasured</li>`).join('')}</ul></details></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forma Grand Prix · ${html(report.runId)}</title><link rel="icon" href="data:,"/><style>
  :root{color-scheme:dark;--bg:#0c1322;--panel:#131e31;--ink:#eff5ff;--muted:#bdcce0;--accent:#6de3ce}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,sans-serif}main{max-width:1480px;margin:auto;padding:40px 24px 72px}header{border-top:5px solid var(--accent);padding:25px 0}h1{font-size:clamp(2rem,4vw,3.4rem);letter-spacing:-.04em;margin:.3em 0}h2{font-size:1.5rem}p{max-width:95ch;color:var(--muted);overflow-wrap:anywhere}a{color:var(--accent)}nav{display:flex;gap:16px;flex-wrap:wrap}section{margin-top:30px;padding:24px;background:var(--panel);border-radius:10px}table{width:100%;border-collapse:collapse;text-align:left;font-variant-numeric:tabular-nums;font-size:.88rem}caption{text-align:left;padding:8px 0;color:var(--muted)}th,td{padding:12px 9px;border-bottom:1px solid #31415c;vertical-align:top}thead th{color:var(--accent)}td{white-space:nowrap}td:last-child{white-space:normal;min-width:180px}small{display:block;color:var(--muted)}summary{cursor:pointer}details p{font-size:.85rem;max-width:42ch}li{margin-bottom:12px}.table-scroll{overflow:auto}label{display:block;margin:20px 0}input{display:block;width:min(100%,450px);padding:12px;border:1px solid #6c819e;border-radius:6px;background:var(--bg);color:var(--ink);font:inherit}.eyebrow{font-size:.85rem;font-weight:700;letter-spacing:.12em;color:var(--accent)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}@media print{:root{color-scheme:light;--bg:white;--panel:white;--ink:black;--muted:#333;--accent:#075b4e}main{padding:0}section{padding:10px 0}input,label{display:none}details{display:block}.table-scroll{overflow:visible}table{font-size:8px}}
  </style></head><body><main><header><div class="eyebrow">FORMA · PERFORMANCE LAB</div><h1>Grand Prix evidence</h1><p>Run <strong>${html(report.runId)}</strong> · ${html(report.status)}</p><p>${html(report.interpretation)}</p><nav aria-label="Report downloads"><a href="report.md">Readable Markdown</a><a href="measurements.csv">Measurements CSV</a><a href="report.json">Report JSON</a>${report.manifestAvailable ? '<a href="manifest.json">Run manifest</a>' : ''}</nav></header><section><h2>Evidence quality</h2><ul>${(report.warnings.length ? report.warnings : ['Run provenance is available. Read the per-measurement caveats before interpreting differences.']).map(w => `<li>${html(w)}</li>`).join('')}</ul><p>SD is sample standard deviation. CV is SD / mean. Single measurements have no SD/CV. Repetitions are the sample unit; individual requests are not independent samples. No outliers are removed and no significance test is claimed.</p></section><section><h2>Forma strengths and investigation opportunities</h2><p>These are descriptive workload observations. They do not establish broad framework superiority.</p><details><summary>Review ${report.comparisons.length + report.sourceComparisons.length} metric comparisons</summary><ul>${observations}</ul></details></section><label for="filter">Filter measurement rows<input id="filter" type="search" placeholder="e.g. forma, create1000, excluded"></label><nav aria-label="Events">${groups.map(event => `<a href="#${event}">${html(event)}</a>`).join('')}</nav>${sections}${inventory}<section><h2>Next investigations</h2><ol>${report.nextSteps.map(step => `<li>${html(step)}</li>`).join('')}</ol></section></main><script>document.getElementById('filter').addEventListener('input',function(){const q=this.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(row=>{row.hidden=!row.textContent.toLowerCase().includes(q)})});</script></body></html>\n`;
}

function csvCell(value) {
  let text = String(value ?? '');
  // Spreadsheet applications must not interpret evidence-controlled strings as formulas.
  if (typeof value === 'string' && /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function toCSV(report) {
  const fields = ['trial', 'campaign', 'event', 'metric', 'car', 'version', 'status', 'unit', 'direction', 'n', 'mean', 'median', 'sd', 'cv', 'min', 'max', 'samples', 'source', 'caveats'];
  return [fields, ...report.measurements.map(row => [row.trial, row.campaignId, row.event, row.metric, row.car, row.version, row.status, row.unit, row.direction,
    row.statistics?.n ?? 0, row.statistics?.mean, row.statistics?.median, row.statistics?.sd, row.statistics?.cv, row.statistics?.min, row.statistics?.max,
    JSON.stringify(row.samples), row.source, [...row.reasons, ...row.warnings].join(' ')])].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function generateReport(runDir) {
  const report = collectReport(runDir);
  fs.mkdirSync(runDir, { recursive: true });
  for (const [filename, contents] of Object.entries({ 'report.json': JSON.stringify(report, null, 2) + '\n', 'report.md': toMarkdown(report), 'report.html': toHTML(report), 'measurements.csv': toCSV(report) })) {
    fs.writeFileSync(path.join(runDir, filename), contents);
  }
  return report;
}

function compareIdentity(manifest) {
  return {
    protocolVersion: manifest.protocolVersion ?? manifest.protocol?.version,
    testHash: manifest.testHash ?? manifest.testFingerprint,
    config: manifest.comparisonConfig ?? manifest.config,
    environment: manifest.environment,
  };
}

export function compareRuns(baseDir, currentDir) {
  const baseline = collectReport(baseDir), current = collectReport(currentDir);
  const a = compareIdentity(baseline.manifest), b = compareIdentity(current.manifest);
  const reasons = [];
  for (const key of Object.keys(a)) {
    if (a[key] === undefined || a[key] === null || b[key] === undefined || b[key] === null) reasons.push(`Missing ${key} provenance.`);
    else if (stableStringify(a[key]) !== stableStringify(b[key])) reasons.push(`${key} changed.`);
  }
  for (const report of [baseline, current]) {
    if (!['completed', 'complete', 'passed'].includes(report.status)) reasons.push(`${report.runId}: only completed runs qualify for historical comparisons.`);
    if (report.manifest.mode === 'smoke' || report.manifest.profile === 'smoke' || report.manifest.config?.profile === 'smoke') reasons.push(`${report.runId}: smoke profiles cannot establish performance changes.`);
  }
  const changes = [];
  const matched = new Set();
  for (const row of current.measurements) {
    const candidates = baseline.measurements.filter(r => r.event === row.event && r.metric === row.metric && r.car === row.car);
    const exact = candidates.filter(r => r.trial === row.trial);
    const previous = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
    if (!previous) { changes.push({ trial: row.trial, event: row.event, metric: row.metric, car: row.car, status: candidates.length ? 'ambiguous-baseline' : 'missing-baseline' }); continue; }
    matched.add(previous);
    const localReasons = [...reasons];
    if (row.status !== 'measured' || previous.status !== 'measured') localReasons.push('Both runs must pass correctness and sample checks.');
    if (row.comparable === false || previous.comparable === false) localReasons.push('Adapter operation semantics are not equivalent.');
    if (stableStringify(row.context) !== stableStringify(previous.context)) localReasons.push('Measurement workload or machine changed.');
    if (!row.campaignId || !previous.campaignId || row.campaignId !== previous.campaignId) localReasons.push('Separate campaigns: display observations separately; no paired improvement claim.');
    const difference = localReasons.length ? null : compareMeans(previous.statistics, row.statistics, row.direction);
    changes.push({ baselineTrial: previous.trial, currentTrial: row.trial, event: row.event, metric: row.metric, car: row.car, unit: row.unit,
      status: difference ? 'descriptive' : 'not-comparable', reasons: localReasons,
      baseline: previous.statistics, current: row.statistics, ...difference,
      warnings: [...new Set([...previous.warnings, ...row.warnings])] });
  }
  for (const row of baseline.measurements) if (!matched.has(row)) changes.push({ trial: row.trial, event: row.event, metric: row.metric, car: row.car, status: 'missing-current' });
  return { schemaVersion: 1, baseline: baseline.runId, current: current.runId, comparable: !reasons.length && changes.length > 0 && changes.every(change => change.status === 'descriptive'),
    reasons, changes, interpretation: 'Descriptive changes on compatible recorded conditions. Different dependency pins are intentional experimental variables; they do not prove causation. No significance claim is made.' };
}
