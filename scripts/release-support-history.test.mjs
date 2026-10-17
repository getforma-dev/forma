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
  assert.equal(preflight.currentRecordPending, true);
  assert.equal(preflight.support.state, 'stable');
  assert.equal(assertPublicationAllowed(preflight, f.record.tag, new Date('2028-01-01T00:00:00Z')).lines[0].until, '2027-04-30');
  const published = await readSupportHistory({ ...options, currentRecord: f.record, currentMetadata: f.metadata });
  assert.equal(published.support.lines[0].until, '2027-04-30');
  assert.equal(published.currentRecordPending, false);
  await assert.rejects(readSupportHistory({ ...options, currentRecord: f.record, currentMetadata: { ...f.metadata, published_at: '2027-01-01T00:00:00Z' } }), /changed/);
});
test('rerunning a first final after a published patch retains the original support start', async () => {
  const current = fixture(), patch = fixture('v3.0.1', '2027-01-01T00:00:00Z');
  current.metadata.assets = [];
  const history = await readSupportHistory({ targetTag: current.record.tag,
    fetchImpl: transport([[current.metadata, patch.metadata]], patch.bytes) });
  assert.equal(history.currentRecordPending, true);
  assert.deepEqual(history.sources.map(r => r.tag), ['v3.0.1']);
  assert.equal(history.support.lines[0].until, '2027-04-30');
  assert.equal(assertPublicationAllowed(history, current.record.tag, new Date('2028-01-01T00:00:00Z')).lines[0].until, '2027-04-30');
});
test('prospective release guard rejects too-close next majors before publication without printing a provisional date', async () => {
  const f = fixture();
  const history = await readSupportHistory({ targetTag: 'v4.0.0', fetchImpl: transport([[f.metadata]], f.bytes) });
  assert.throws(() => assertPublicationAllowed(history, 'v4.0.0', new Date('2027-04-30T23:29:59Z')), /six calendar/);
  assert.equal(assertPublicationAllowed(history, 'v4.0.0', new Date('2027-04-30T23:30:00Z')).lines[1].until, '2027-10-30');
  assert.equal(history.support.lines[1].until, null);
});

function visibilityFixture(snapshots, { paginated = false, onRead = () => {} } = {}) {
  const prior = fixture(), current = fixture('v3.0.1', '2026-11-01T00:00:00Z');
  let clock = 0, reads = 0, downloads = 0, pages = 0;
  const sleeps = [], old = Array.from({ length: 100 }, (_, i) => ({ tag_name: `old-${i}` }));
  const options = { targetTag: current.record.tag, currentRecord: current.record, currentMetadata: current.metadata,
    waitForCurrent: true, now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms; },
    fetchImpl: async (url, { signal }) => {
      assert(signal instanceof AbortSignal);
      const page = /[?&]page=(\d+)/.exec(url);
      if (!page) { downloads++; return new Response(prior.bytes); }
      pages++;
      if (page[1] === '1') { reads++; clock += onRead(reads) ?? 0; }
      const snapshot = snapshots[Math.min(reads - 1, snapshots.length - 1)];
      const rows = snapshot(prior, current);
      if (rows instanceof Response) return rows;
      return Response.json(paginated && page[1] === '1' ? old : rows);
    } };
  return { options, prior, current, state: () => ({ clock, reads, downloads, pages, sleeps }) };
}

test('acknowledged publication waits for complete inventory visibility without redownloading prior DS12', async () => {
  const missing = p => [p.metadata], visible = (p, c) => [p.metadata, c.metadata];
  const f = visibilityFixture([missing, missing, visible], { paginated: true });
  const history = await readSupportHistory(f.options);
  assert.deepEqual(f.state(), { clock: 4000, reads: 3, downloads: 1, pages: 6, sleeps: [2000, 2000] });
  assert.deepEqual(history.releases.map(r => r.tag), ['v3.0.0', 'v3.0.1']);
  assert.equal(history.targetMetadata.published_at, f.current.metadata.published_at);
  assert.equal(history.sources[0].sha256, f.prior.metadata.assets[0].digest.slice(7));
  assert.equal(history.sources[1].source, 'current verified DS11 and P17');
  assert.equal(history.support.lines[0].until, '2027-04-30');
  const finalInventory = [...Array.from({ length: 100 }, (_, i) => ({ tag_name: `old-${i}` })), f.prior.metadata, f.current.metadata];
  assert.equal(history.inventorySha256, createHash('sha256').update(JSON.stringify(finalInventory)).digest('hex'));
});

test('persistent current absence stops after three additional complete inventories', async () => {
  const f = visibilityFixture([p => [p.metadata]]);
  await assert.rejects(readSupportHistory(f.options), /current publication absent from complete inventory/);
  assert.deepEqual(f.state(), { clock: 6000, reads: 4, downloads: 1, pages: 4, sleeps: [2000, 2000, 2000] });
});

test('visibility deadline includes request time and refuses late visibility without another request', async () => {
  for (const visible of [false, true]) {
    const f = visibilityFixture([p => [p.metadata], (p, c) => visible ? [p.metadata, c.metadata] : [p.metadata]],
      { onRead: n => n === 2 ? 18_000 : 0 });
    await assert.rejects(readSupportHistory(f.options), /visibility deadline exceeded/);
    assert.deepEqual(f.state(), { clock: 20_000, reads: 2, downloads: 1, pages: 2, sleeps: [2000] });
  }
});

test('default preflight and current-history reads do not enable a visibility wait', async () => {
  const f = visibilityFixture([p => [p.metadata]]);
  await assert.rejects(readSupportHistory({ ...f.options, waitForCurrent: false }), /current publication absent/);
  assert.equal(f.state().reads, 1); assert.deepEqual(f.state().sleeps, []);
  const preflight = visibilityFixture([p => [p.metadata]]);
  const result = await readSupportHistory({ ...preflight.options, waitForCurrent: false, currentRecord: undefined, currentMetadata: undefined });
  assert.equal(result.targetMetadata, undefined); assert.equal(result.currentRecordPending, false);
  assert.equal(preflight.state().reads, 1); assert.deepEqual(preflight.state().sleeps, []);
  await assert.rejects(readSupportHistory({ ...preflight.options, currentRecord: undefined }), /requires the current verified publication/);
  assert.equal(preflight.state().reads, 1);
});

test('visibility polling immediately refuses transport, malformed, draft, contradictory and changed history', async () => {
  const cases = [
    [() => new Response('failure', { status: 503 }), /unreadable/],
    [() => new Response('not JSON'), /JSON/],
    [() => Response.json({}), /malformed/],
    [(p, c) => [p.metadata, c.metadata, c.metadata], /duplicate/],
    [(p, c) => [p.metadata, { ...c.metadata, draft: true }], /draft/],
    [(p, c) => [p.metadata, { ...c.metadata, prerelease: true }], /classification/],
    [(p, c) => [p.metadata, { ...c.metadata, published_at: '2026-02-30T00:00:00Z' }], /calendar/],
    [(p, c) => [p.metadata, { ...c.metadata, published_at: '2026-11-02T00:00:00Z' }], /changed/],
    [(p, c) => [c.metadata], /history changed/],
    [(p, c) => [{ ...p.metadata, draft: true }, c.metadata], /history changed/],
    [(p, c) => [{ ...p.metadata, assets: [] }, c.metadata], /history changed/],
    [(p, c) => [{ ...p.metadata, assets: [{ ...p.metadata.assets[0], digest: `sha256:${'0'.repeat(64)}` }] }, c.metadata], /history changed/],
    [(p, c) => [p.metadata, c.metadata, fixture('v3.0.2', '2026-11-02T00:00:00Z').metadata], /history changed/],
  ];
  for (const [unsafe, expected] of cases) {
    const f = visibilityFixture([p => [p.metadata], unsafe, (p, c) => [p.metadata, c.metadata]]);
    await assert.rejects(readSupportHistory(f.options), expected);
    assert.equal(f.state().reads, 2); assert.equal(f.state().downloads, 1);
    assert.deepEqual(f.state().sleeps, [2000], 'unsafe response must not be retried into the following good response');
  }
});

test('invalid current publication and incomplete prior stable history refuse before visibility polling', async () => {
  for (const mutate of [
    f => { f.options.currentRecord = { ...f.current.record, dryRun: true }; },
    f => { f.options.currentMetadata = { ...f.current.metadata, draft: true }; },
    f => { f.options.currentMetadata = { ...f.current.metadata, tag_name: 'v3.0.2' }; },
    f => { f.options.currentMetadata = { ...f.current.metadata, published_at: 'invalid' }; },
    f => { f.prior.metadata.assets = []; },
    f => { f.prior.metadata.assets[0].digest = `sha256:${'0'.repeat(64)}`; },
  ]) {
    const f = visibilityFixture([p => [p.metadata]]); mutate(f);
    await assert.rejects(readSupportHistory(f.options));
    assert.equal(f.state().reads, 1); assert.deepEqual(f.state().sleeps, []);
  }
  const patch = fixture('v3.0.1'), current = fixture('v3.0.2', '2026-11-01T00:00:00Z');
  let sleeps = 0;
  await assert.rejects(readSupportHistory({ targetTag: current.record.tag, currentRecord: current.record, currentMetadata: current.metadata,
    waitForCurrent: true, fetchImpl: transport([[patch.metadata]], patch.bytes), sleep: async () => { sleeps++; },
  }), /omits the first final/);
  assert.equal(sleeps, 0);
});
