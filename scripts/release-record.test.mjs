import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { changelogEntry, measurementsNotes, releaseNotes, releaseTitle } from './release-record.mjs';
import { ROOT, json, releaseMilestone } from './release-set.mjs';

test('the GitHub Release names the milestone, where it went on npm, and every gate still open before later milestones', () => {
  const contracts = json(join(ROOT, 'scripts/release-contracts.json'));
  const milestone = releaseMilestone(contracts, '3.0.0-alpha.1');
  const set = { tag: 'v3.0.0-alpha.1', commit: 'a'.repeat(40), run: 1, contracts, milestone, packages: [{ name: 'forma-ir', version: '3.0.0-alpha.1', sha256: 'b'.repeat(64) }] };
  const notes = releaseNotes(set, { ciRun: 2, elapsedSeconds: 12.34 }, '## [3.0.0-alpha.1]\n\nFirst alpha.', milestone);
  assert.match(notes, /^## \[3\.0\.0-alpha\.1\]\n\nFirst alpha\.\n\nMilestone: alpha \(M2\), pre-release on npm `next`\./);
  assert.match(notes, /\n- before beta \(M3\): .*FORMA-188 fixture applications: the three fixture applications in P17/);
  assert.match(notes, /\n- before rc \(M4\): .*FORMA-145 audit/);
  assert.match(notes, /\n- before final \(M5\): .*FORMA-191: the per-release measurements in P17/);
  assert.match(notes, /\| forma-ir \| 3\.0\.0-alpha\.1 \| `b{64}` \|/);
  assert.match(notes, /Tag-event run to record: 12\.3 seconds/);
  const measured = releaseNotes(set, { ciRun: 2, elapsedSeconds: 12.34, measurements: { measurements: {
    p17: { seconds: 301.4, limitSeconds: 1800 },
    n2: [{ app: 'ledger', route: '/household', formaGzip: 25366, limit: 27500 }],
    machine: { runner: 'Linux X64', cpus: 4, node: 'v24.22.0' },
  } } }, '## [3.0.0-alpha.1]\n\nFirst alpha.', milestone);
  assert.match(measured, /Milestone: alpha \(M2\)/);
  assert.match(measured, /P17 ran 301 s of 1,800 s; the most Forma code on any fixture route is 25,366 B of 27,500 B/);
  assert.equal(releaseTitle('3.0.0-alpha.1', milestone), 'Forma 3.0.0-alpha.1 (alpha, M2)');
  const done = structuredClone(contracts);
  for (const m of Object.values(done.milestones)) for (const gate of Object.values(m.gates)) gate.status = 'done';
  const final = releaseMilestone(done, '3.0.0');
  const finalNotes = releaseNotes({ ...set, tag: 'v3.0.0', contracts: done, milestone: final }, { ciRun: 2, elapsedSeconds: 1 }, '## [3.0.0]\n\nFinal.', final);
  assert.match(finalNotes, /Milestone: final \(M5\), npm `latest`\./);
  assert.match(finalNotes, /Pending before later milestones: none\./);
  assert.equal(releaseTitle('3.0.0', final), 'Forma 3.0.0 (final, M5)');
  assert.throws(() => releaseNotes(set, { ciRun: 2, elapsedSeconds: 1 }, 'x', releaseMilestone(contracts, '3.0.0-beta.1')), /ready milestone/);
});

test('release notes retain paragraphs, bullets and subheadings up to the next release', () => {
  const entry = '## [3.0.0] - 2026-10-15\n\nNew wire format.\n\n### Upgrading\n\n- Recompile IR.\n- Keep the packages aligned.\n\nSecond paragraph.';
  const source = `# Changelog\n\n## [Unreleased]\n\nFuture work.\n\n${entry}\n\n## [2.1.0]\n\nOld changes.\n`;
  assert.equal(changelogEntry(source, '3.0.0'), entry);
  assert.equal(changelogEntry(source.replaceAll('\n', '\r\n'), '3.0.0'), entry);
});

test('last release extends to true EOF and an unbracketed version is accepted', () => {
  const entry = '## 3.0.0-alpha.1 - 2026-10-15\n\nFirst preview.\n\n### Changes\n\n- Complete final paragraph.';
  assert.equal(changelogEntry(`# Changelog\n\n${entry}`, '3.0.0-alpha.1'), entry);
});

test('stable tags cannot select prereleases or other version prefixes', () => {
  const source = '## [3.0.0-alpha.1]\n\nPreview.\n\n## 3.0.01\n\nDifferent version.\n';
  assert.throws(() => changelogEntry(source, '3.0.0'), /missing CHANGELOG/);
  assert.throws(() => changelogEntry('## [3.0.0]\n\n## [2.1.0]\nOld.', '3.0.0'), /empty CHANGELOG/);
});

test('the Release notes carry one line of P17\'s measurements when it took them, and nothing otherwise', () => {
  assert.equal(measurementsNotes({ passed: true }), '');
  const machine = { runner: 'Linux X64', cpus: 4, node: 'v24.22.0' };
  const line = measurementsNotes({ measurements: { p17: { seconds: 301.4, limitSeconds: 1800 }, n2: [{ app: 'ledger', route: '/household', formaGzip: 25366, limit: 25500 }], machine } });
  assert.match(line, /^\nP17 ran 301 s of 1,800 s; the most Forma code on any fixture route is 25,366 B of 25,500 B gzip -9 \(ledger \/household\)/);
});
