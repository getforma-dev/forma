// Versioned engineering decisions, separate from raw race data and release approval.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const defaultFile = fileURLToPath(new URL('../config/change-ledger.json', import.meta.url));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const stringList = (value, label, allowEmpty = false) => {
  assert(Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(nonempty), `${label}: nonempty string list required`);
  assert.equal(new Set(value).size, value.length, `${label}: duplicate values`);
};
export function validateLedger(ledger, { repositoryRoot } = {}) {
  assert.equal(ledger.schemaVersion, 1, 'unsupported change ledger schema');
  assert.match(ledger.updatedAt ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert(nonempty(ledger.purpose) && nonempty(ledger.claimBoundary), 'purpose and claim boundary required');
  assert(ledger.releases && ledger.sources && Array.isArray(ledger.changes) && ledger.changes.length, 'release, source and change inventories required');
  const evidence = rows => {
    assert(Array.isArray(rows) && rows.length, 'evidence required');
    for (const row of rows) {
      assert(nonempty(row.label) && nonempty(row.path), 'evidence label and path required');
      if (row.path.startsWith('https://')) { assert.equal(new URL(row.path).protocol, 'https:'); continue; }
      assert(!path.isAbsolute(row.path) && !row.path.split('/').includes('..') && !row.path.includes('\\') && !row.path.includes('://'), 'evidence must be repository-relative or HTTPS');
      if (repositoryRoot) assert(existsSync(path.join(repositoryRoot, row.path.split('#')[0])), `missing evidence: ${row.path}`);
    }
  };
  for (const release of Object.values(ledger.releases)) { assert.match(release.commit, /^[a-f0-9]{40}$/); evidence(release.evidence); }
  for (const source of Object.values(ledger.sources)) { assert.match(source.commit, /^[a-f0-9]{40}$/); assert(nonempty(source.label)); }
  const ids = new Set();
  for (const change of ledger.changes) {
    assert.match(change.id ?? '', /^GP-H\d{3}$/); assert(!ids.has(change.id), 'duplicate change ID'); ids.add(change.id);
    for (const field of ['title', 'finding', 'change']) assert(nonempty(change[field]), `${change.id}: ${field} required`);
    assert(['adopted', 'accepted-tradeoff', 'rejected', 'inconclusive'].includes(change.status), 'invalid disposition');
    for (const field of ['tickets', 'sourceCommits', 'tradeoffs', 'remainingTargets', 'guardrails', 'repeatOnlyIf']) stringList(change[field], `${change.id}.${field}`);
    for (const field of ['shippedReleases', 'inheritedBy']) {
      stringList(change[field], field, true);
      assert(change[field].every(version => ledger.releases[version]), 'unknown release');
    }
    assert(!change.shippedReleases.some(version => change.inheritedBy.includes(version)), 'a release cannot be both first-shipped and inherited');
    if (['rejected', 'inconclusive'].includes(change.status)) assert.equal(change.shippedReleases.length, 0, 'rejected/inconclusive design cannot be marked shipped');
    assert(change.sourceCommits.every(commit => Object.values(ledger.sources).some(source => source.commit === commit)), 'unknown source commit');
    assert(Array.isArray(change.measurements) && change.measurements.length, 'measurement evidence required');
    for (const measurement of change.measurements) {
      for (const field of ['metric', 'unit', 'campaignId', 'statistic']) assert(nonempty(measurement[field]), `measurement ${field} required`);
      assert(['lower', 'higher'].includes(measurement.direction), 'measurement direction required');
      assert(['same-campaign', 'same-campaign-ABBA', 'separate-runners-cache-pair', 'controlled-local-build', 'observation-only'].includes(measurement.pairing), 'explicit pairing required');
      assert(measurement.samplesPerSource === null || Number.isInteger(measurement.samplesPerSource) && measurement.samplesPerSource > 0, 'invalid sample count');
      assert.equal(measurement.baseline === null, measurement.pairing === 'observation-only', 'unpaired observations must not invent a before value');
      for (const value of [measurement.baseline, measurement.candidate].filter(Boolean)) {
        assert(ledger.sources[value.source], `unknown measurement source: ${value.source}`);
        assert(change.sourceCommits.includes(ledger.sources[value.source].commit), 'measurement source missing from change identity');
        assert(Number.isFinite(value.value) && value.value >= 0, 'measurement must be a finite nonnegative number');
      }
      assert(measurement.candidate, 'candidate observation required');
      if (measurement.target) {
        const target = measurement.target; assert(['<=', '>='].includes(target.operator)); assert(Number.isFinite(target.value));
        assert.equal(target.met, target.operator === '<=' ? measurement.candidate.value <= target.value : measurement.candidate.value >= target.value, 'target disposition contradicts recorded measurement');
      }
    }
    evidence(change.evidence);
  }
  return ledger;
}
export function readLedger(file = defaultFile, options = {}) {
  return validateLedger(JSON.parse(readFileSync(file, 'utf8')), options);
}
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
export function renderChanges(ledger) {
  validateLedger(ledger);
  const lines = [
    '# Forma Grand Prix engineering history', '',
    'Grand Prix findings drove the 3.1.0 work inherited by 3.2.0. This history separates shipped changes, accepted costs, rejected experiments and measurements still needed. Release ancestry does not establish new performance results.', '',
    `Updated ${ledger.updatedAt}. Canonical data: [change-ledger.json](../config/change-ledger.json).`, '',
    '## Read the evidence correctly', '',
    'Every number belongs to its campaign and exact source. Only rows marked as paired provide a before/after comparison; observation-only rows have no invented baseline. Fixed order, small samples and hosted-machine variance limit causal claims. Raw samples and independent audits remain authoritative.', '',
    'The original programme shipped in 3.1.0 (`9a570afe`); 3.2.0 (`fc76ea85`) inherits that source history. The separate 3.2 packed decoder and CI records below are release observations, not a fresh Grand Prix race.', '',
  ];
  for (const change of ledger.changes) {
    lines.push(`## ${change.id} — ${change.title}`, '', `**${change.status}** · ${change.tickets.join(', ')} · Shipped: ${change.shippedReleases.join(', ') || 'not shipped'}${change.inheritedBy.length ? '; inherited by ' + change.inheritedBy.join(', ') : ''}.`, '',
      `Finding: ${change.finding}`, '', `Decision: ${change.change}`, '',
      '| Measurement | Before | After / observed | Unit | Campaign | Boundary |', '| --- | ---: | ---: | --- | --- | --- |');
    for (const m of change.measurements) lines.push(`| ${escape(m.metric)} | ${m.baseline?.value ?? '—'} | ${m.candidate.value} | ${escape(m.unit)} | ${escape(m.campaignId)} | ${m.pairing}; ${escape(m.statistic)}${m.target ? '; target ' + m.target.operator + ' ' + m.target.value + ': ' + (m.target.met ? 'met' : 'missed') : ''} |`);
    for (const [title, field] of [['Tradeoffs and limits', 'tradeoffs'], ['Remaining targets', 'remainingTargets'], ['Guardrails', 'guardrails'], ['Run another experiment only when', 'repeatOnlyIf']]) lines.push('', `**${title}**`, '', ...change[field].map(text => '- ' + text));
    lines.push('', '**Evidence and source identity**', '', ...change.evidence.map(e => `- [${e.label}](${e.path.startsWith('https://') ? e.path : '../../../' + e.path})`),
      '- Exact source commits: ' + change.sourceCommits.map(commit => `[${commit.slice(0, 8)}](https://github.com/getforma-dev/forma/commit/${commit})`).join(', '), '');
  }
  lines.push('## Ledger schema and update discipline', '',
    '`config/change-ledger.json` uses schemaVersion 1. `sources` maps stable source IDs to full Git commits; `releases` binds versions to exact tags and publication evidence. `changes` owns stable GP-H IDs, ticket links, disposition, first-shipped releases, inherited releases, source commits, measurements, evidence, tradeoffs, remaining targets, guardrails and conditions for another experiment.', '',
    'Each measurement declares a metric, unit, direction, campaign ID, pairing, statistic, sample count (null when not asserted), candidate observation and either a paired baseline or null. Targets retain their original operator/value and an arithmetically checked met flag. Local evidence paths are repository-relative; external evidence uses HTTPS. The schema validator rejects duplicate IDs, unknown sources/releases, unsafe or missing local paths, fabricated baselines on unpaired observations and inconsistent target outcomes.', '',
    'Add a new stable entry when a finding changes an engineering decision. Update release linkage only with publication/source evidence. Preserve superseded campaigns, rejected options, source identities and missed targets. Do not turn a product acceptance into a numerical pass, a waived task into completed work, or inherited code into a fresh timing result. Before another race, name the changed hypothesis/source, reuse applicable authenticated evidence, and freeze workload, versions, resource profile and analysis rule.', '');
  return lines.join('\n');
}
