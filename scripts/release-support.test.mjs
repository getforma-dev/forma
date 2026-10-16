import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readRecordedSet, recallPlan, publishedRelease, supportRecord, addCalendarMonths, renderSecurity, SUPPORT_START, SUPPORT_END, assertPublishedHistory } from './release-support.mjs';
const packages = [
  ...['core','compiler','build','create-app'].map(n => ({ registry: 'npm', name: `@getforma/${n}` })),
  ...['forma-ir','forma-ir-derive','forma-server'].map(name => ({ registry: 'crates', name })),
].map(p => ({ ...p, version: '3.0.0', sha256: 'a'.repeat(64) }));
const record = { schema: 1, dryRun: false, tag: 'v3.0.0', commit: 'b'.repeat(40), packages, measurements: { passed: true, commit: 'b'.repeat(40) } };
const parse = value => { const bytes = Buffer.from(JSON.stringify(value)); return readRecordedSet(bytes, createHash('sha256').update(bytes).digest('hex')); };
const release = (tag, publishedAt) => ({ tag, publishedAt, prerelease: tag.includes('-') });

test('exact set recall covers every registry version and has no shell interpolation', () => {
  const plan = recallPlan(parse(record), 'Security recall; upgrade to the replacement set.');
  assert.equal(plan.actions.length, 7);
  assert.equal(plan.actions.filter(a => a.registry === 'npm').length, 4);
  assert.equal(plan.actions.filter(a => a.registry === 'crates').length, 3);
  assert.deepEqual(plan.actions[0].args, ['deprecate', '@getforma/core@3.0.0', 'Security recall; upgrade to the replacement set.']);
  assert(plan.actions.slice(4).every(a => a.action === 'yank' && a.url.endsWith('/3.0.0')));
});
test('record authentication and identity refuse incomplete, duplicate, dry, failed and mismatched sets', () => {
  assert.throws(() => readRecordedSet(Buffer.from('{}'), '0'.repeat(64)), /checksum/);
  for (const mutate of [
    r => r.packages.pop(), r => r.packages[0] = r.packages[1], r => r.dryRun = true,
    r => r.packages[0].version = '3.0.1', r => r.packages[0].sha256 = '',
    r => r.measurements.passed = false, r => r.measurements.commit = 'c'.repeat(40),
  ]) { const copy = structuredClone(record); mutate(copy); assert.throws(() => parse(copy)); }
});
test('publication comes from matching non-draft GitHub metadata, never the DS12 generation time', () => {
  const metadata = { tag_name: 'v3.0.0', published_at: '2026-10-31T23:30:00Z', draft: false, prerelease: false };
  const result = publishedRelease({ ...record, recordedAt: '2027-03-31T00:00:00Z' }, metadata);
  assert.equal(result.publishedAt, metadata.published_at);
  assert.throws(() => publishedRelease(record, { ...metadata, tag_name: 'v3.0.1' }));
  assert.throws(() => publishedRelease(record, { ...metadata, draft: true }));
  assert.throws(() => publishedRelease(record, { ...metadata, published_at: '2026-02-30T00:00:00Z' }));
});
test('six calendar months clamp month ends and preserve UTC time including leap years', () => {
  assert.equal(addCalendarMonths('2026-08-31T17:45:00Z', 6), '2027-02-28T17:45:00.000Z');
  assert.equal(addCalendarMonths('2027-08-31T17:45:00Z', 6), '2028-02-29T17:45:00.000Z');
  assert.equal(addCalendarMonths('2026-10-31T23:30:00Z', 6), '2027-04-30T23:30:00.000Z');
});
test('prereleases start no window; patch records never restart it', () => {
  assert.equal(supportRecord([release('v3.0.0-rc.1', '2026-10-10T00:00:00Z')]).state, 'prerelease');
  const initial = release('v3.0.0', '2026-10-31T23:30:00Z');
  const support = supportRecord([release('v3.0.1', '2027-03-01T00:00:00Z'), initial]);
  assert.equal(support.lines[0].until, '2027-04-30');
  assert.equal(support.lines[1].until, null);
  assert.equal(support.nextMajorNotBefore, '2027-04-30T23:30:00.000Z');
});
test('missing history and too-close unified majors refuse; exact six-month boundary admits', () => {
  const initial = release('v3.0.0', '2026-10-31T23:30:00Z');
  assert.throws(() => supportRecord([release('v3.0.1', initial.publishedAt)]), /first final/);
  assert.throws(() => supportRecord([initial, initial]), /duplicate/);
  assert.throws(() => supportRecord([initial, release('v5.0.0', '2027-10-31T23:30:00Z')]), /missing/);
  assert.throws(() => supportRecord([initial, release('v4.0.0', '2027-04-30T23:29:59Z')]), /six calendar/);
  const support = supportRecord([initial, release('v4.0.0', '2027-04-30T23:30:00Z')]);
  assert.equal(support.lines[1].until, '2027-10-30');
});
test('generated support block preserves reviewed threat policy and refuses ambiguous marker ownership', () => {
  const template = `# Security\nThreat policy stays.\n${SUPPORT_START}\nstale\n${SUPPORT_END}\nReport privately.\n`;
  const output = renderSecurity(template, supportRecord([release('v3.0.0', '2026-10-31T23:30:00Z')]));
  assert(output.startsWith('# Security\nThreat policy stays.\n'));
  assert(output.endsWith('\nReport privately.\n'));
  assert(output.includes('2027-04-30'));
  assert(!output.includes('stale'));
  assert.throws(() => renderSecurity(template + SUPPORT_START, supportRecord([])), /one support/);
});

test('complete published inventory cannot hide an advertised stable record or change its first publication', () => {
  const r = release('v3.0.0', '2026-10-31T23:30:00Z');
  const metadata = { tag_name: r.tag, published_at: r.publishedAt, draft: false, prerelease: false };
  assertPublishedHistory([r], [[metadata]]);
  assert.throws(() => assertPublishedHistory([], [[metadata]]), /missing advertised/);
  assert.throws(() => assertPublishedHistory([r], []), /absent/);
  assert.throws(() => assertPublishedHistory([r], [{ ...metadata, published_at: '2026-11-01T00:00:00Z' }]), /contradictory/);
});

test('omitted unified inventory entries are validated before draft and prerelease filtering', () => {
  const metadata = { tag_name: 'v3.0.0', published_at: '2026-10-31T23:30:00Z', draft: false, prerelease: false };
  for (const changed of [
    { prerelease: true }, { draft: undefined }, { draft: 'false' },
    { prerelease: 'false', published_at: 'invalid' },
    { tag_name: 'v3.0.0-beta.1', prerelease: true, published_at: '2026-02-30T00:00:00Z' },
    { tag_name: 'v3.bad', prerelease: true },
  ]) assert.throws(() => assertPublishedHistory([], [{ ...metadata, ...changed }]));
  // Legitimate unpublished drafts and obsolete prereleases require no DS12.
  assertPublishedHistory([], [
    { ...metadata, draft: true, published_at: null },
    { ...metadata, tag_name: 'v3.0.0-beta.1', prerelease: true },
    { ...metadata, tag_name: 'v4.0.0-rc.1', draft: true, prerelease: true, published_at: null },
  ]);
});
