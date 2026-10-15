import test from 'node:test';
import assert from 'node:assert/strict';
import { changelogEntry, measurementsNotes } from './release-record.mjs';

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
