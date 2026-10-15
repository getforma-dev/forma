import test from 'node:test';
import assert from 'node:assert/strict';
import { changelogEntry } from './release-record.mjs';

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
