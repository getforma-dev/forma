import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readSupportHistory, assertPublicationAllowed } from './release-support-history.mjs';
const API = 'https://api.github.com/repos/getforma-dev/forma';
function fixture(tag = 'v3.0.0', at = '2026-10-31T23:30:00Z') {
  const commit = 'a'.repeat(40);
  const packages = [
    ...['core','compiler','build','create-app'].map(name => ({ registry: 'npm', name: `@getforma/${name}` })),
    ...['forma-ir','forma-ir-derive','forma-server'].map(name => ({ registry: 'crates', name })),
  ].map(p => ({ ...p, version: tag.slice(1), sha256: 'b'.repeat(64) }));
  const record = { schema: 1, tag, commit, packages, dryRun: false, measurements: { passed: true, commit } };
  const bytes = Buffer.from(JSON.stringify(record));
  const metadata = { tag_name: tag, draft: false, prerelease: tag.includes('-'), published_at: at,
    assets: [{ name: 'release-record.json', url: `${API}/releases/assets/123`, size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }] };
  return { record, bytes, metadata };
}
function transport(pages, bytes) {
  return async url => {
    const page = /[?&]page=(\d+)/.exec(url);
    return page ? new Response(JSON.stringify(pages[Number(page[1]) - 1] ?? [])) : new Response(bytes);
  };
}
test('complete paginated history authenticates published DS12 and original publication', async () => {
  const f = fixture(), old = Array.from({ length: 100 }, (_, i) => ({ tag_name: `old-${i}` }));
  const result = await readSupportHistory({ targetTag: 'v3.0.1', fetchImpl: transport([old, [f.metadata]], f.bytes) });
  assert.equal(result.sources[0].sha256, f.metadata.assets[0].digest.slice(7));
  assert.equal(result.releases[0].publishedAt, f.metadata.published_at);
  assert.equal(result.support.lines[0].until, '2027-04-30');
});
test('unreadable, missing, substituted and malformed prior history all refuse', async () => {
  const f = fixture();
  const options = { targetTag: 'v3.0.1' };
  await assert.rejects(readSupportHistory({ ...options, fetchImpl: async () => new Response('failure', { status: 503 }) }), /unreadable/);
  for (const mutate of [
    m => m.assets = [], m => m.assets[0].digest = `sha256:${'0'.repeat(64)}`,
    m => m.assets[0].url = 'https://example.com/asset', m => m.prerelease = true,
    m => m.draft = 'false', m => m.published_at = '2026-02-30T00:00:00Z',
  ]) {
    const metadata = structuredClone(f.metadata); mutate(metadata);
    await assert.rejects(readSupportHistory({ ...options, fetchImpl: transport([[metadata]], f.bytes) }));
  }
  await assert.rejects(readSupportHistory({ ...options, fetchImpl: transport([[f.metadata, f.metadata]], f.bytes) }), /duplicate/);
});
test('first final and rerun use real publication metadata; preflight can recover an unfinished current DS12', async () => {
  const f = fixture(); f.metadata.assets = [];
  const options = { targetTag: f.record.tag, fetchImpl: transport([[f.metadata]], f.bytes) };
  const preflight = await readSupportHistory(options);
  assert.equal(preflight.support.state, 'prerelease');
  assert.equal(assertPublicationAllowed(preflight, f.record.tag, new Date('2028-01-01T00:00:00Z')).lines[0].until, '2027-04-30');
  const published = await readSupportHistory({ ...options, currentRecord: f.record, currentMetadata: f.metadata });
  assert.equal(published.support.lines[0].until, '2027-04-30');
  await assert.rejects(readSupportHistory({ ...options, currentRecord: f.record, currentMetadata: { ...f.metadata, published_at: '2027-01-01T00:00:00Z' } }), /changed/);
});
test('prospective release guard rejects too-close next majors before publication without printing a provisional date', async () => {
  const f = fixture();
  const history = await readSupportHistory({ targetTag: 'v4.0.0', fetchImpl: transport([[f.metadata]], f.bytes) });
  assert.throws(() => assertPublicationAllowed(history, 'v4.0.0', new Date('2027-04-30T23:29:59Z')), /six calendar/);
  assert.equal(assertPublicationAllowed(history, 'v4.0.0', new Date('2027-04-30T23:30:00Z')).lines[1].until, '2027-10-30');
  assert.equal(history.support.lines[1].until, null);
});
