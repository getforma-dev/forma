import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {reconcile, validatePolicy} from './registry-reconcile.mjs';

const identities = [
  ['npm', '@getforma/core', 'getforma-dev/formajs'],
  ['npm', '@getforma/compiler', 'getforma-dev/forma-tools'],
  ['npm', '@getforma/build', 'getforma-dev/forma-tools'],
  ['npm', '@getforma/create-app', 'getforma-dev/create-forma-app'],
  ['crates', 'forma-ir', 'getforma-dev/forma'],
  ['crates', 'forma-ir-derive', 'getforma-dev/forma'],
  ['crates', 'forma-server', 'getforma-dev/forma'],
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const filename = (registry, name, version) => registry === 'npm'
  ? `${name.replace('@', '').replace('/', '-')}-${version}.tgz` : `${name}-${version}.crate`;
const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: {'content-type': 'application/json', ...headers},
});
const clone = value => structuredClone(value);
const release = (id, tag, extra = {}) => ({
  id, tag_name: tag, draft: false, prerelease: tag.includes('-'),
  published_at: '2026-10-20T04:09:01Z', target_commitish: 'a'.repeat(40),
  html_url: `https://github.com/getforma-dev/forma/releases/tag/${tag}`,
  body: '', assets: [], ...extra,
});

function fixture(version = '3.0.0', router = false) {
  const selected = router ? [...identities, ['npm', '@getforma/router', 'getforma-dev/forma']] : identities;
  const policy = {schema: 1, packages: selected.map(([registry, name, repo]) => ({
    registry, name, recordRepositories: [...new Set([repo, 'getforma-dev/forma'])], baseline: [],
  }))};
  const metadata = new Map(), archives = new Map(), calls = [];
  const record = {schema: 1, dryRun: false, tag: `v${version}`, commit: 'a'.repeat(40), run: '12345', packages: []};
  for (const [registry, name] of selected) {
    const file = filename(registry, name, version), bytes = Buffer.from(`archive:${name}:${version}`);
    archives.set(file, bytes);
    record.packages.push({registry, name, version, file, sha256: sha(bytes)});
    if (registry === 'npm') metadata.set(name, {name, time: {[version]: '2026-10-20T04:00:00Z'}, versions: {
      [version]: {name, version, dist: {tarball: `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${version}.tgz`,
        integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`}},
    }});
    else metadata.set(name, {versions: [{crate: name, num: version, checksum: sha(bytes),
      created_at: '2026-10-20T04:00:00Z', yanked: false,
      dl_path: `/api/v1/crates/${name}/${version}/download`}], meta: {total: 1, next_page: null}});
  }
  const releases = new Map([...new Set(policy.packages.flatMap(p => p.recordRepositories))].map(repo => [repo, []]));
  releases.set('getforma-dev/forma', [release(77, `v${version}`, {assets: [{id: 123, name: 'release-record.json',
    url: 'https://api.github.com/repos/getforma-dev/forma/releases/assets/123',
    browser_download_url: 'https://github.com/getforma-dev/forma/releases/download/v3.0.0/release-record.json',
    size: 4096}]} )]);
  const state = {policy, metadata, archives, releases, record, calls, overrides: [], assetRedirect: false};
  state.fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input)), headers = new Headers(options.headers);
    calls.push({url: url.href, authorization: headers.get('authorization'), accept: headers.get('accept'), redirect: options.redirect});
    for (const override of state.overrides) {
      const response = await override(url, options);
      if (response !== undefined) return response;
    }
    if (url.hostname === 'registry.npmjs.org') {
      if (url.pathname.includes('/-/')) {
        const bytes = archives.get(`getforma-${decodeURIComponent(url.pathname.split('/').at(-1))}`);
        return bytes ? new Response(bytes) : new Response('archive missing', {status: 404});
      }
      const doc = metadata.get(decodeURIComponent(url.pathname.slice(1)));
      return doc ? jsonResponse(doc) : new Response('package missing', {status: 404});
    }
    if (url.hostname === 'crates.io') {
      const match = /^\/api\/v1\/crates\/([^/]+)\/(versions|[^/]+\/download)$/.exec(url.pathname);
      if (match?.[2] === 'versions') return jsonResponse(metadata.get(match[1]));
      if (match) {
        const version = match[2].split('/')[0];
        return new Response(null, {status: 302, headers: {location: `https://static.crates.io/crates/${match[1]}/${match[1]}-${version}.crate`}});
      }
    }
    if (url.hostname === 'static.crates.io') {
      const bytes = archives.get(url.pathname.split('/').at(-1));
      return bytes ? new Response(bytes) : new Response('archive missing', {status: 404});
    }
    if (url.hostname === 'api.github.com') {
      const match = /^\/repos\/([^/]+\/[^/]+)\/releases(?:\/assets\/([0-9]+))?$/.exec(url.pathname);
      if (match?.[2]) {
        if (state.assetRedirect) return new Response(null, {status: 302, headers: {
          location: 'https://release-assets.githubusercontent.com/github-production-release-asset/123/release-record.json',
        }});
        return jsonResponse(state.record);
      }
      if (match) return jsonResponse(url.searchParams.get('page') === '2' ? [] : releases.get(match[1]) ?? []);
    }
    if (url.hostname === 'release-assets.githubusercontent.com') return jsonResponse(state.record);
    throw new Error(`UNMOCKED NETWORK REQUEST: ${url.href}`);
  };
  return state;
}
const run = f => reconcile({policy: f.policy, fetchImpl: f.fetchImpl, token: 'mock-github-token',
  limits: {timeoutMs: 1000, deadlineMs: 10000}});
const codes = result => result.findings.map(f => f.code);

test('router enrollment accepts the eight-package 3.2 set while retaining historical seven-package records', async () => {
  for (const version of ['3.0.0', '3.1.0']) assert.equal((await run(fixture(version))).passed, true);
  const current = await run(fixture('3.2.0-rc.1', true));
  assert.equal(current.passed, true, JSON.stringify(current.findings));
  assert.equal(current.packages.length, 8); assert.equal(current.verifiedArchives.length, 8);
  const historicalForgery = await run(fixture('3.1.0', true));
  assert(codes(historicalForgery).includes('RECORD_INVALID'));
  const missing = fixture('3.2.0-rc.1', true); missing.record.packages.pop();
  assert(codes(await run(missing)).includes('RECORD_INVALID'));
});
test('an unenrolled published router and a premature enrollment are visible failures, never suppressed 404s', async () => {
  const pending = fixture('3.2.0-rc.1', true); pending.policy.packages.pop();
  const result = await run(pending);
  assert(codes(result).includes('POLICY_PACKAGE_UNENROLLED')); assert.equal(result.passed, false);
  const premature = fixture('3.2.0-rc.1', true); premature.metadata.delete('@getforma/router');
  assert.equal((await run(premature)).passed, false);
  const fakeBaseline = fixture('3.2.0-rc.1', true);
  fakeBaseline.policy.packages.at(-1).baseline=[{version:'3.1.0',reason:'pretend historical package',evidence:'https://example.invalid'}];
  assert.throws(()=>validatePolicy(fakeBaseline.policy),/no pre-record/);
});

test('complete seven-package set is verified from actual archive bytes', async () => {
  const f = fixture(), result = await run(f);
  assert.equal(result.passed, true, JSON.stringify(result.findings));
  assert.deepEqual(result.findings, []);
  assert.equal(result.externalAlertDelivery, 'deferred-L60');
  assert.equal(result.packages.length, 7);
  assert.equal(result.packages.reduce((sum, p) => sum + p.verified, 0), 7);
  assert(f.calls.some(c => c.url.includes('/releases/assets/123')));
  for (const [, name] of identities) assert(result.packages.some(p => p.name === name));
});

test('missing record and changed archive are both reported in one run', async () => {
  const f = fixture();
  const core = f.metadata.get('@getforma/core');
  core.versions['3.0.1'] = {name: core.name, version: '3.0.1', dist: {tarball:
    'https://registry.npmjs.org/@getforma/core/-/core-3.0.1.tgz'}};
  f.archives.set('getforma-build-3.0.0.tgz', Buffer.from('changed bytes'));
  const result = await run(f);
  assert.equal(result.passed, false);
  assert(codes(result).includes('MISS_RECORD'), JSON.stringify(result.findings));
  assert(codes(result).includes('HASH_MISMATCH'), JSON.stringify(result.findings));
});

test('unreadable registry fails while the other packages remain inspectable', async () => {
  const f = fixture();
  f.overrides.push(url => url.hostname === 'registry.npmjs.org' && decodeURIComponent(url.pathname) === '/@getforma/core'
    ? new Response('unavailable', {status: 503}) : undefined);
  const result = await run(f);
  assert.equal(result.passed, false);
  assert(codes(result).includes('REGISTRY_UNREADABLE'), JSON.stringify(result.findings));
  assert(f.calls.some(c => c.url.includes('forma-server')));
});

test('malformed registry data is refused, never treated as zero versions', async () => {
  const f = fixture(); f.metadata.set('@getforma/core', {name: '@getforma/core', versions: []});
  const result = await run(f);
  assert.equal(result.passed, false);
  assert(result.findings.length > 0);
});

test('duplicate crate version entries fail closed', async () => {
  const f = fixture(), doc = f.metadata.get('forma-ir');
  doc.versions.push(clone(doc.versions[0])); doc.meta.total = 2;
  const result = await run(f);
  assert.equal(result.passed, false);
  assert(result.findings.length > 0);
});

test('unreadable GitHub record cannot become a successful empty inventory', async () => {
  const f = fixture();
  f.overrides.push(url => url.pathname.endsWith('/releases/assets/123') ? new Response('gone', {status: 404}) : undefined);
  const result = await run(f);
  assert.equal(result.passed, false);
  assert(codes(result).includes('RECORD_INVALID'), JSON.stringify(result.findings));
  assert(result.findings.some(f => f.message.includes('HTTP 404')));
});

test('record tag mismatch, dry run and duplicate package identities are rejected', async t => {
  for (const [name, mutate] of [
    ['tag', r => {r.tag = 'v3.0.1';}],
    ['dry-run', r => {r.dryRun = true;}],
    ['duplicate package', r => {r.packages[6] = clone(r.packages[0]);}],
    ['archive identity', r => {r.packages[0].file = 'getforma-build-3.0.0.tgz';}],
  ]) await t.test(name, async () => {
    const f = fixture(); mutate(f.record);
    const result = await run(f);
    assert.equal(result.passed, false);
    assert(codes(result).includes('RECORD_INVALID'), JSON.stringify(result.findings));
  });
});

test('conflicting duplicate release records are rejected', async () => {
  const f = fixture(), rows = f.releases.get('getforma-dev/forma');
  rows.push({...clone(rows[0]), id: 78});
  const result = await run(f);
  assert.equal(result.passed, false);
  assert(codes(result).includes('RECORD_UNREADABLE'), JSON.stringify(result.findings));
  assert(result.findings.some(f => f.message.includes('duplicate release')));
});

test('exact historical baseline exempts only the named old version', async () => {
  const f = fixture(), core = f.metadata.get('@getforma/core');
  f.policy.packages[0].baseline = [{version: '2.0.2', reason: 'A1 before the first checksummed record', evidence: 'https://github.com/getforma-dev/formajs/releases/tag/v2.0.3'}];
  core.versions['2.0.2'] = {name: core.name, version: '2.0.2', dist: {tarball:
    'https://registry.npmjs.org/@getforma/core/-/core-2.0.2.tgz'}};
  core.versions['1.99.0'] = {name: core.name, version: '1.99.0', dist: {tarball:
    'https://registry.npmjs.org/@getforma/core/-/core-1.99.0.tgz'}};
  const result = await run(f);
  assert.equal(result.passed, false);
  assert(codes(result).includes('MISS_RECORD'), JSON.stringify(result.findings));
  assert(result.findings.some(row => row.code === 'MISS_RECORD' && row.version === '1.99.0'));
  assert.equal(result.packages.find(p => p.name === '@getforma/core').baseline, 1);
  assert(!f.calls.some(c => c.url.endsWith('core-2.0.2.tgz')));
});

test('policy rejects wildcard, duplicate, future and bootstrap exemptions', () => {
  for (const version of ['2.*', '3.0.0', '9.0.0']) {
    const f = fixture(); f.policy.packages[0].baseline = [{version, reason: 'reason', evidence: 'https://example.test/evidence'}];
    assert.throws(() => validatePolicy(f.policy));
  }
  const f = fixture(); f.policy.packages[5].baseline = [{version: '0.0.0', reason: 'not an A1 version', evidence: 'https://example.test/evidence'}];
  assert.throws(() => validatePolicy(f.policy));
  const duplicate = fixture(); duplicate.policy.packages[6] = clone(duplicate.policy.packages[0]);
  assert.throws(() => validatePolicy(duplicate.policy));
  const duplicatedVersion = fixture(), baseline = {version: '2.0.2', reason: 'An explicit pre-record historical version', evidence: 'https://example.test/evidence'};
  duplicatedVersion.policy.packages[0].baseline = [baseline, clone(baseline)];
  assert.throws(() => validatePolicy(duplicatedVersion.policy), /duplicate baseline/);
});

test('legacy body records verify the exact archive and reject filename confusion', async t => {
  for (const scenario of ['valid', 'wrong filename', 'duplicate declaration']) await t.test(scenario, async () => {
    const f = fixture(), version = '2.1.0', name = '@getforma/core';
    const bytes = Buffer.from('legacy A2 core bytes'), file = filename('npm', name, version);
    f.archives.set(file, bytes);
    f.metadata.get(name).versions[version] = {name, version, dist: {tarball:
      'https://registry.npmjs.org/@getforma/core/-/core-2.1.0.tgz'}};
    const declaration = `Artefact: \`${scenario === 'wrong filename' ? 'getforma-build-2.1.0.tgz' : file}\` (npm), SHA-256 \`${sha(bytes)}\`.`;
    f.releases.get('getforma-dev/formajs').push(release(88, 'v2.1.0', {body:
      scenario === 'duplicate declaration' ? `${declaration}\n${declaration}` : declaration}));
    const result = await run(f);
    assert.equal(result.passed, scenario === 'valid', JSON.stringify(result.findings));
    if (scenario === 'valid') assert.equal(result.packages.find(p => p.name === name).verified, 2);
    else assert(codes(result).includes('RECORD_INVALID'), JSON.stringify(result.findings));
  });
});

test('GitHub inventory follows a full first page before deciding records are absent', async () => {
  const f = fixture(), real = clone(f.releases.get('getforma-dev/forma'));
  f.overrides.push(url => {
    if (url.hostname !== 'api.github.com' || url.pathname !== '/repos/getforma-dev/forma/releases') return undefined;
    return jsonResponse(url.searchParams.get('page') === '1'
      ? Array.from({length: 100}, (_, i) => release(1000 + i, `historical-${i}`)) : real);
  });
  const result = await run(f);
  assert.equal(result.passed, true, JSON.stringify(result.findings));
  assert(f.calls.some(c => c.url.endsWith('/forma/releases?per_page=100&page=2')));
});

test('yanked prereleases are still reconciled and missing cursor rows fail closed', async t => {
  await t.test('yanked prerelease', async () => {
    const f = fixture(), doc = f.metadata.get('forma-ir');
    doc.versions.push({...clone(doc.versions[0]), num: '3.0.0-beta.1', yanked: true}); doc.meta.total = 2;
    const result = await run(f);
    assert.equal(result.passed, false);
    assert(result.findings.some(row => row.code === 'MISS_RECORD' && row.version === '3.0.0-beta.1'));
  });
  await t.test('incomplete total', async () => {
    const f = fixture(); f.metadata.get('forma-ir').meta.total = 2;
    const result = await run(f);
    assert.equal(result.passed, false);
    assert(codes(result).includes('REGISTRY_UNREADABLE'), JSON.stringify(result.findings));
  });
});

test('crates cursor pagination includes later versions and refuses missing records there', async () => {
  const f = fixture(), original = clone(f.metadata.get('forma-ir'));
  f.overrides.push(url => {
    if (url.hostname !== 'crates.io' || !url.pathname.endsWith('/forma-ir/versions')) return undefined;
    if (url.searchParams.has('cursor')) return jsonResponse({versions: [{...original.versions[0], num: '3.0.1',
      dl_path: '/api/v1/crates/forma-ir/3.0.1/download'}], meta: {total: 2, next_page: null}});
    return jsonResponse({versions: original.versions, meta: {total: 2, next_page: '?cursor=second'}});
  });
  const result = await run(f);
  assert.equal(result.passed, false);
  assert(f.calls.some(c => c.url.includes('cursor=second')));
  assert(codes(result).includes('MISS_RECORD'), JSON.stringify(result.findings));
});

test('credential is sent only to GitHub API and stripped on an asset CDN redirect', async () => {
  const f = fixture(); f.assetRedirect = true;
  const result = await run(f);
  assert.equal(result.passed, true, JSON.stringify(result.findings));
  const api = f.calls.filter(c => new URL(c.url).hostname === 'api.github.com');
  assert(api.length > 0 && api.every(c => c.authorization?.includes('mock-github-token')));
  assert(f.calls.some(c => new URL(c.url).hostname === 'release-assets.githubusercontent.com'));
  for (const call of f.calls.filter(c => new URL(c.url).hostname !== 'api.github.com')) assert.equal(call.authorization, null, call.url);
});

test('archive URL leaving the authorized registry is refused before fetch', async () => {
  const f = fixture(); f.metadata.get('@getforma/core').versions['3.0.0'].dist.tarball = 'https://attacker.example/archive.tgz';
  const result = await run(f);
  assert.equal(result.passed, false);
  assert(!f.calls.some(c => new URL(c.url).hostname === 'attacker.example'));
});

test('configured metadata byte bound refuses oversized input', async () => {
  const f = fixture(); f.metadata.get('@getforma/core').padding = 'x'.repeat(20000);
  const result = await reconcile({policy: f.policy, fetchImpl: f.fetchImpl,
    limits: {metadataBytes: 10000, timeoutMs: 1000, deadlineMs: 10000}});
  assert.equal(result.passed, false);
  assert(codes(result).includes('REGISTRY_UNREADABLE'), JSON.stringify(result.findings));
});
