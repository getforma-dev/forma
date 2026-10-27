import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reconcile, validatePolicy} from './registry-reconcile.mjs';
import {validatePublicationRecoveryProof} from './release-publication-recovery.mjs';
import {actualPlaceholderBytes, placeholderFixture} from './fixtures/provider-placeholder.mjs';
import {PLACEHOLDER_HOST, PLACEHOLDER_ASSET, PLACEHOLDER_CONTRACT} from './release-provider-placeholder.mjs';

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

// Offline synthetic providers only. The injected finite plan has the same
// strict contract as the audited plan, but its archive hashes describe these
// small fixture bytes; it is never a live publication/qualification receipt.
function syntheticRecoveryProof(plan) {
  const original = plan.original;
  const actualRun = {repository: {full_name: 'getforma-dev/forma'}, id: original.runId,
    run_attempt: original.runAttempt, head_sha: original.commit, head_branch: original.tag,
    path: original.workflow, event: original.event, status: 'completed', conclusion: 'failure'};
  const provider = {latestRun: clone(actualRun), attempt: clone(actualRun),
    jobs: {total_count: plan.jobs.length, jobs: plan.jobs.map(job => ({...job,
      run_id: original.runId, run_attempt: original.runAttempt, head_sha: original.commit,
      head_branch: original.tag, status: 'completed', steps: job.name === 'record'
        ? [{name: 'Write DS12, the compatibility record and elapsed time', conclusion: 'failure'}]
        : job.name === 'verify' ? [{name: 'P17 packed corpus and both templates', conclusion: 'success'}] : [],
    }))},
    tagRef: {ref: `refs/tags/${original.tag}`, object: {type: 'tag', sha: original.tagObject}},
    annotatedTag: {tag: original.tag, sha: original.tagObject, object: {type: 'commit', sha: original.commit}},
    inventory: {total_count: 2, artifacts: Object.values(plan.artifacts).map(item => ({id: item.id,
      name: item.name, size_in_bytes: item.bytes, digest: `sha256:${item.sha256}`, expired: false,
      workflow_run: {id: original.runId, head_sha: original.commit, head_branch: original.tag},
      archive_download_url: `https://api.github.com/repos/getforma-dev/forma/actions/artifacts/${item.id}/zip`}))},
    recordLog: `release-record: ${original.failure}\n`,
  };
  const ds11 = {content: '{"fixture":"synthetic DS11; not qualification"}\n', sha256sums: 'synthetic checksums\n'};
  plan.artifacts.packed.setSha256 = sha(ds11.content);
  plan.artifacts.packed.manifestSha256 = sha(ds11.sha256sums);
  const d14 = {files: Object.fromEntries(Object.keys(plan.d14).map(name => [name, `${name}: synthetic test input\n`])),
    binding: {}, scope: 'offline test only'};
  for (const [name, bytes] of Object.entries(d14.files)) plan.d14[name] = sha(bytes);
  return {contract: 'forma-publication-recovery-proof-v1', disposition: 'inventory-only', original: clone(original),
    planSha256: sha(JSON.stringify(plan)), provider, ds11,
    p17: {...plan.artifacts.p17, filesVerified: 1, passed: true, elapsedSeconds: 1200, rawEvidenceAttached: false},
    d14, registry: plan.packages.map(item => {
      const archiveUrl = item.registry === 'npm'
        ? `https://registry.npmjs.org/${item.name}/-/${item.name.split('/')[1]}-${item.version}.tgz`
        : `https://static.crates.io/crates/${item.name}/${item.name}-${item.version}.crate`;
      const metadata = item.registry === 'npm'
        ? {name: item.name, version: item.version, dist: {integrity: item.integrity, shasum: item.shasum, tarball: archiveUrl}}
        : {version: {crate: item.name, num: item.version, checksum: item.sha256, yanked: false}};
      return {...item, archiveUrl, metadataUrl: 'offline synthetic fixture', metadata};
    })};
}
function recoveryFixture() {
  const f = fixture('3.2.0-rc.2', true), original = fixture('3.2.0-rc.1', true);
  const plan = JSON.parse(readFileSync(new URL('../docs/release/publication-recovery-3.2-rc1.json', import.meta.url), 'utf8'));
  for (const [name, metadata] of original.metadata) {
    const current = f.metadata.get(name);
    if (metadata.versions && !Array.isArray(metadata.versions)) Object.assign(current.versions, metadata.versions);
    else { current.versions.push(...metadata.versions); current.meta.total = current.versions.length; }
  }
  for (const [name, bytes] of original.archives) f.archives.set(name, bytes);
  for (const p of plan.packages) {
    const bytes = f.archives.get(p.file);
    p.sha256 = sha(bytes); p.bytes = bytes.length;
    if (p.registry === 'npm') {
      p.integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
      p.shasum = createHash('sha1').update(bytes).digest('hex');
    }
  }
  const proofValue = syntheticRecoveryProof(plan);
  let proofBytes = Buffer.from(JSON.stringify(proofValue));
  const proof = { asset: `publication-recovery-${plan.original.tag}-proof.json`, sha256: sha(proofBytes), bytes: proofBytes.length };
  const preparedBy = {tag: f.record.tag, commit: f.record.commit, runId: Number(f.record.run), runAttempt: 1,
    workflow: '.github/workflows/release.yml', event: 'push', job: 'check'};
  const receipt = {contract: 'forma-publication-recovery-v1', disposition: 'inventory-only',
    performanceBaselineEligible: false, soakEligible: false, preparedBy,
    recordedBy: {...preparedBy, job: 'record'}, original: clone(plan.original), packages: clone(plan.packages), proof,
    preparedManifestSha256: 'b'.repeat(64), planSha256: sha(JSON.stringify(plan)),
    preparedAt: '2026-10-27T05:00:00.000Z', recordedAt: '2026-10-27T05:01:00.000Z'};
  const host = f.releases.get('getforma-dev/forma')[0], assets = new Map();
  const providerAsset = (id, name, bytes) => ({id, name, size: bytes.length, digest: `sha256:${sha(bytes)}`});
  f.plan = plan; f.receipt = receipt; f.host = host; f.assetBodies = assets; f.proof = proofValue;
  f.sync = () => {
    const receiptBytes = Buffer.from(JSON.stringify(receipt));
    const pointer = {contract: receipt.contract, originalTag: plan.original.tag,
      asset: `publication-recovery-${plan.original.tag}.json`, sha256: sha(receiptBytes), bytes: receiptBytes.length, proof: clone(receipt.proof)};
    f.record.publicationRecoveries = [pointer];
    assets.set(124, receiptBytes); assets.set(125, proofBytes);
    host.assets = [providerAsset(123, 'release-record.json', Buffer.from(JSON.stringify(f.record))),
      providerAsset(124, pointer.asset, receiptBytes), providerAsset(125, pointer.proof.asset, proofBytes)];
  };
  f.syncProof = () => {
    proofBytes = Buffer.from(JSON.stringify(f.proof));
    receipt.proof = {asset: proof.asset, sha256: sha(proofBytes), bytes: proofBytes.length};
    f.sync();
  };
  f.syncHost = () => { host.assets[0] = providerAsset(123, 'release-record.json', Buffer.from(JSON.stringify(f.record))); };
  f.sync();
  f.overrides.push(url => {
    if (url.hostname === 'api.github.com') {
      const match = /^\/repos\/getforma-dev\/forma\/releases\/assets\/(\d+)$/.exec(url.pathname);
      if (match && assets.has(Number(match[1]))) return new Response(assets.get(Number(match[1])));
    }
  });
  f.run = () => reconcile({policy: f.policy, fetchImpl: f.fetchImpl, token: 'mock-github-token',
    limits: {timeoutMs: 1000, deadlineMs: 10000}, recoveryPlanForTagImpl: tag => tag === plan.hostTag ? plan : null});
  return f;
}
function alterAssetByte(f, id) {
  const changed = Buffer.from(f.assetBodies.get(id)); changed[0] ^= 1;
  f.assetBodies.set(id, changed);
}

test('authenticated inventory-only recovery verifies all original and host archives without baseline promotion', async () => {
  const f = recoveryFixture(), policy = clone(f.policy);
  assert.equal(validatePublicationRecoveryProof(f.proof, f.plan), f.proof);
  const result = await f.run();
  assert.equal(result.passed, true, JSON.stringify(result.findings));
  assert.equal(result.verifiedArchives.length, 16);
  const recovered = result.verifiedArchives.filter(row => row.version === '3.2.0-rc.1');
  assert.equal(recovered.length, 8);
  assert(recovered.every(row => row.source.kind === 'publication-recovery' && row.source.tag === 'v3.2.0-rc.2' &&
    row.source.originalTag === 'v3.2.0-rc.1' && row.source.disposition === 'inventory-only'));
  assert(f.calls.some(c => c.url.endsWith('/releases/assets/125')), 'proof bytes are retrieved');
  assert.equal(result.packages.reduce((n, p) => n + p.baseline, 0), 0);
  assert.deepEqual(f.policy, policy);
});

test('recovery receipt semantic refusals preserve the independently valid host but admit no original claims', async t => {
  for (const [name, change] of [
    ['performance eligibility', r => { r.performanceBaselineEligible = true; }],
    ['soak eligibility', r => { r.soakEligible = true; }],
    ['disposition', r => { r.disposition = 'qualified'; }],
    ['partial inventory', r => { r.packages.pop(); }],
    ['duplicate inventory', r => { r.packages[7] = clone(r.packages[0]); }],
    ['original tuple', r => { r.original.commit = 'c'.repeat(40); }],
    ['recorder context', r => { r.recordedBy.runId++; }],
    ['host commit', r => { r.preparedBy.commit = 'c'.repeat(40); }],
    ['prepared plan', r => { r.planSha256 = 'c'.repeat(64); }],
  ]) await t.test(name, async () => {
    const f = recoveryFixture(); change(f.receipt); f.sync();
    const result = await f.run();
    assert.equal(result.passed, false);
    assert(codes(result).includes('RECORD_INVALID'), JSON.stringify(result.findings));
    assert.equal(result.verifiedArchives.length, 8);
    assert(result.verifiedArchives.every(row => row.version === '3.2.0-rc.2'));
    assert.equal(result.findings.filter(row => row.code === 'MISS_RECORD').length, 8);
  });
});

test('internally rehashed recovery proofs still require the complete shared semantic contract', async t => {
  for (const [name, change] of [
    ['wrong schema', proof => { proof.contract = 'other-proof-v1'; }],
    ['incomplete proof', proof => { delete proof.provider; }],
    ['original failure erased', proof => { proof.provider.latestRun.conclusion = 'success'; }],
    ['original source changed', proof => { proof.original.commit = 'c'.repeat(40); }],
    ['partial registry inventory', proof => { proof.registry.pop(); }],
    ['registry metadata mismatch', proof => { proof.registry.find(item => item.registry === 'npm').metadata.dist.integrity = 'wrong'; }],
    ['DS11 bytes altered', proof => { proof.ds11.content += ' '; }],
    ['D14 bytes altered', proof => { proof.d14.files['d14-report.json'] += ' '; }],
    ['P17 qualification promoted', proof => { proof.p17.rawEvidenceAttached = true; }],
  ]) await t.test(name, async () => {
    const f = recoveryFixture(); change(f.proof); f.syncProof();
    const result = await f.run();
    assert.equal(result.passed, false);
    assert(codes(result).includes('RECORD_INVALID'), JSON.stringify(result.findings));
    assert.equal(result.verifiedArchives.length, 8, 'valid host survives, no recovered claims enter');
    assert.equal(result.findings.filter(row => row.code === 'MISS_RECORD').length, 8);
  });
});

test('recovery requires the finite host pointer and provider-authenticated receipt and proof', async t => {
  for (const [name, change] of [
    ['missing pointer', f => { delete f.record.publicationRecoveries; f.syncHost(); }],
    ['duplicate pointer', f => { f.record.publicationRecoveries.push(clone(f.record.publicationRecoveries[0])); f.syncHost(); }],
    ['wrong host', f => { f.plan.hostTag = 'v3.2.0-rc.3'; }],
    ['missing receipt', f => { f.host.assets = f.host.assets.filter(a => a.id !== 124); }],
    ['duplicate receipt', f => { f.host.assets.push({...f.host.assets[1], id: 126}); }],
    ['receipt HTTP 404', f => { f.overrides.unshift(url => url.pathname.endsWith('/assets/124') ? new Response('missing', {status: 404}) : undefined); }],
    ['altered receipt bytes', f => { alterAssetByte(f, 124); }],
    ['receipt provider digest', f => { f.host.assets[1].digest = `sha256:${'c'.repeat(64)}`; }],
    ['receipt provider length', f => { f.host.assets[1].size++; }],
    ['receipt pointer digest', f => { f.record.publicationRecoveries[0].sha256 = 'c'.repeat(64); f.syncHost(); }],
    ['receipt pointer name', f => { f.record.publicationRecoveries[0].asset = 'other.json'; f.syncHost(); }],
    ['missing proof', f => { f.host.assets = f.host.assets.filter(a => a.id !== 125); }],
    ['altered proof bytes', f => { alterAssetByte(f, 125); }],
    ['proof provider digest', f => { f.host.assets[2].digest = `sha256:${'c'.repeat(64)}`; }],
    ['proof pointer disagreement', f => { f.record.publicationRecoveries[0].proof.sha256 = 'c'.repeat(64); f.syncHost(); }],
  ]) await t.test(name, async () => {
    const f = recoveryFixture(); change(f);
    const result = await f.run();
    assert.equal(result.passed, false);
    assert(codes(result).includes('RECORD_INVALID'), JSON.stringify(result.findings));
    assert.equal(result.verifiedArchives.length, 8);
    assert.equal(result.findings.filter(row => row.code === 'MISS_RECORD').length, 8);
  });
});

test('recovery host DS12 must itself match the GitHub provider hash and length', async t => {
  for (const field of ['digest', 'size']) await t.test(field, async () => {
    const f = recoveryFixture();
    if (field === 'digest') f.host.assets[0].digest = `sha256:${'c'.repeat(64)}`;
    else f.host.assets[0].size++;
    const result = await f.run();
    assert.equal(result.passed, false); assert(codes(result).includes('RECORD_INVALID'));
    assert.equal(result.verifiedArchives.length, 0);
  });
});

test('audited default plan requires the RC2 recovery pointer even without fixture injection', async () => {
  const f = recoveryFixture(); delete f.record.publicationRecoveries; f.syncHost();
  const result = await run(f);
  assert.equal(result.passed, false);
  assert(result.findings.some(row => row.code === 'RECORD_INVALID' && /requires exactly one DS12 pointer/.test(row.message)));
});

test('recovered inventory still refuses missing registry versions and mismatched archive bytes', async t => {
  for (const scenario of ['missing version', 'archive mismatch', 'archive 404']) await t.test(scenario, async () => {
    const f = recoveryFixture();
    if (scenario === 'missing version') delete f.metadata.get('@getforma/core').versions['3.2.0-rc.1'];
    else if (scenario === 'archive mismatch') f.archives.set('getforma-core-3.2.0-rc.1.tgz', Buffer.from('altered registry archive'));
    else f.archives.delete('getforma-core-3.2.0-rc.1.tgz');
    const result = await f.run();
    assert.equal(result.passed, false);
    assert.equal(result.verifiedArchives.length, 15);
    assert(result.findings.some(row => row.name === '@getforma/core' && row.version === '3.2.0-rc.1' && row.code ===
      {'missing version': 'REGISTRY_MISSING', 'archive mismatch': 'HASH_MISMATCH', 'archive 404': 'ARCHIVE_UNREADABLE'}[scenario]));
  });
});

test('ordinary and recovered duplicate claims remain AMBIGUOUS_RECORD', async () => {
  const f = recoveryFixture();
  const ordinary = {schema: 1, dryRun: false, tag: 'v3.2.0-rc.1', commit: f.plan.original.commit,
    run: String(f.plan.original.runId), packages: clone(f.plan.packages)};
  f.assetBodies.set(126, Buffer.from(JSON.stringify(ordinary)));
  f.releases.get('getforma-dev/forma').push(release(78, ordinary.tag, {assets: [
    {id: 126, name: 'release-record.json', size: JSON.stringify(ordinary).length},
  ]}));
  const result = await f.run();
  assert.equal(result.passed, false);
  assert.equal(result.findings.filter(row => row.code === 'AMBIGUOUS_RECORD').length, 8);
  assert.equal(result.verifiedArchives.length, 8);
});

test('later recovery does not suppress a malformed original release record', async () => {
  const f = recoveryFixture();
  f.releases.get('getforma-dev/forma').push(release(78, 'v3.2.0-rc.1'));
  const result = await f.run();
  assert.equal(result.passed, false);
  assert.equal(result.verifiedArchives.length, 16);
  assert(result.findings.some(row => row.code === 'RECORD_INVALID' && row.tag === 'v3.2.0-rc.1'));
});

test('the real CLI does not expose the offline fixture plan injection', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./registry-reconcile.mjs', import.meta.url)),
    '--recovery-plan', 'untrusted-plan.json'], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown\/duplicate option/);
});

// Use the shipped default policy, including its exact historical exemptions.
// Synthetic metadata supplies those same old versions; no live baseline changes.
function configuredFixture(version = '3.2.0-rc.1', routerRecord = true) {
  const f = fixture(version, routerRecord);
  f.policy = JSON.parse(readFileSync(new URL('./registry-reconcile-policy.json', import.meta.url), 'utf8'));
  if (!f.metadata.has('@getforma/router')) {
    const name = '@getforma/router', current = '3.2.0-rc.1';
    f.metadata.set(name, {name, versions: {[current]: {name, version: current,
      dist: {tarball: `https://registry.npmjs.org/${name}/-/router-${current}.tgz`}}}});
  }
  for (const p of f.policy.packages) {
    const doc = f.metadata.get(p.name);
    for (const baseline of p.baseline) {
      const version = baseline.version;
      if (p.registry === 'npm') doc.versions[version] = {name: p.name, version};
      else doc.versions.push({crate: p.name, num: version, checksum: 'b'.repeat(64), yanked: false});
    }
    if (p.registry === 'crates') doc.meta.total = doc.versions.length;
  }
  return f;
}

test('shipped target policy enrolls exactly eight with no fabricated router history', async () => {
  const f = configuredFixture(), original = clone(f.policy);
  validatePolicy(f.policy);
  assert.equal(f.policy.packages.length, 8);
  assert.deepEqual(f.policy.packages.find(p => p.name === '@getforma/router'), {
    registry: 'npm', name: '@getforma/router', recordRepositories: ['getforma-dev/forma'], baseline: [],
  });
  const result = await run(f);
  assert.equal(result.passed, true, JSON.stringify(result.findings));
  assert.equal(result.packages.length, 8); assert.equal(result.verifiedArchives.length, 8);
  assert.equal(result.packages.reduce((n, p) => n + p.verified, 0), 8);
  assert.equal(result.packages.find(p => p.name === '@getforma/router').baseline, 0);
  assert.equal(result.packages.reduce((n, p) => n + p.baseline, 0), f.policy.packages.reduce((n, p) => n + p.baseline.length, 0));
  assert.deepEqual(f.policy, original, 'reconciliation never promotes observations to exemptions');
});

test('shipped target policy refuses missing router package, record and altered archive bytes', async t => {
  for (const kind of ['package', 'record', 'bytes']) await t.test(kind, async () => {
    const f = kind === 'record' ? configuredFixture('3.1.0', false) : configuredFixture();
    const original = clone(f.policy);
    if (kind === 'package') f.metadata.delete('@getforma/router');
    if (kind === 'bytes') f.archives.set('getforma-router-3.2.0-rc.1.tgz', Buffer.from('altered router archive'));
    const result = await run(f);
    assert.equal(result.passed, false);
    const finding = result.findings.find(row => row.name === '@getforma/router');
    assert(finding, JSON.stringify(result.findings));
    assert.equal(finding.code, {package: 'REGISTRY_UNREADABLE', record: 'MISS_RECORD', bytes: 'HASH_MISMATCH'}[kind]);
    if (kind === 'package') assert.match(finding.message, /HTTP 404/);
    assert.equal(result.packages.length, 8);
    assert.equal(result.verifiedArchives.length, 7, 'failure cannot disappear or discard the seven independently verified peers');
    assert.equal(result.packages.find(p => p.name === '@getforma/router').baseline, 0);
    assert.deepEqual(f.policy, original);
  });
});

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
test('an unconfigured published router and an unavailable target are visible failures, never suppressed 404s', async () => {
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

// The archive and finite plan are the actual authenticated provider bytes. All
// future RC3 host/run/receipt responses here are labeled synthetic offline data.
function providerPlaceholderFixture() {
  const f = fixture(PLACEHOLDER_HOST.slice(1), true), ph = placeholderFixture();
  const doc = f.metadata.get('@getforma/router');
  doc.versions['0.0.0-stage'] = clone(ph.metadata); doc.time['0.0.0-stage'] = ph.binding.plan.metadata.publishedAt;
  f.archives.set('getforma-router-0.0.0-stage.tgz', actualPlaceholderBytes);
  f.placeholder = ph; f.receipt = ph.receipt;
  const hosted = f.releases.get('getforma-dev/forma')[0];
  const receiptAsset = {id: 987, name: PLACEHOLDER_ASSET, url: 'https://api.github.com/repos/getforma-dev/forma/releases/assets/987'};
  hosted.assets.push(receiptAsset);
  f.refresh = () => {
    const bytes = Buffer.from(JSON.stringify(f.receipt));
    Object.assign(receiptAsset, {size: bytes.length, digest: `sha256:${sha(bytes)}`});
    f.record.providerPlaceholders = [{contract: PLACEHOLDER_CONTRACT, asset: PLACEHOLDER_ASSET, bytes: bytes.length, sha256: sha(bytes)}];
    f.refreshHost();
  };
  f.refreshHost = () => {
    const bytes = Buffer.from(JSON.stringify(f.record));
    Object.assign(hosted.assets[0], {size: bytes.length, digest: `sha256:${sha(bytes)}`});
  };
  f.refresh();
  f.overrides.push(url => {
    if (url.pathname.endsWith('/releases/assets/987')) return jsonResponse(f.receipt);
    if (ph.provider.has(url.href)) return jsonResponse(ph.provider.get(url.href));
  });
  return f;
}
test('finite provider placeholder requires a real DS12 attachment, with ordinary package counts unchanged', async () => {
  const f = providerPlaceholderFixture(), result = await run(f);
  assert.equal(result.passed, true, JSON.stringify(result.findings));
  assert.equal(result.verifiedArchives.length, 8); assert.equal(result.verifiedProviderPlaceholders.length, 1);
  assert.equal(result.verifiedProviderPlaceholders[0].sha256, sha(actualPlaceholderBytes));
  assert.equal(result.verifiedProviderPlaceholders[0].source.kind, 'provider-placeholder');
  assert.equal(result.verifiedProviderPlaceholders[0].qualificationEligible, false);
  const router = result.packages.find(p => p.name === '@getforma/router');
  assert.equal(router.baseline, 0); assert.equal(router.verified, 1); assert.equal(router.providerPlaceholders, 1);
  assert(f.calls.some(call => call.url === f.placeholder.binding.plan.archive.url));
  for (const call of f.calls.filter(call => call.url.startsWith('https://registry.'))) assert.equal(call.authorization, null);
});
test('before successor receipt exists the actual placeholder remains a missing record', async () => {
  const f = fixture('3.2.0-rc.1', true), ph = placeholderFixture(), doc = f.metadata.get('@getforma/router');
  doc.versions['0.0.0-stage'] = ph.metadata; doc.time['0.0.0-stage'] = ph.binding.plan.metadata.publishedAt;
  f.archives.set('getforma-router-0.0.0-stage.tgz', actualPlaceholderBytes);
  const result = await run(f); assert.equal(result.passed, false);
  assert(result.findings.some(row => row.code === 'MISS_RECORD' && row.version === '0.0.0-stage'));
  assert.equal(result.verifiedProviderPlaceholders.length, 0);
});
for (const [name, mutate, code] of [
  ['planned pointer missing', f => { delete f.record.providerPlaceholders; f.refreshHost(); }, 'RECORD_INVALID'],
  ['pointer hash wrong', f => { f.record.providerPlaceholders[0].sha256 = '0'.repeat(64); f.refreshHost(); }, 'RECORD_INVALID'],
  ['pointer asset wrong', f => { f.record.providerPlaceholders[0].asset = 'other.json'; f.refreshHost(); }, 'RECORD_INVALID'],
  ['pointer duplicated', f => { f.record.providerPlaceholders.push(clone(f.record.providerPlaceholders[0])); f.refreshHost(); }, 'RECORD_INVALID'],
  ['receipt missing', f => { f.releases.get('getforma-dev/forma')[0].assets.pop(); }, 'RECORD_INVALID'],
  ['receipt provider digest wrong', f => { f.releases.get('getforma-dev/forma')[0].assets[1].digest = `sha256:${'0'.repeat(64)}`; }, 'RECORD_INVALID'],
  ['host record provider digest wrong', f => { f.releases.get('getforma-dev/forma')[0].assets[0].digest = `sha256:${'0'.repeat(64)}`; }, 'RECORD_INVALID'],
  ['rehashed receipt has wrong source', f => { f.receipt.recordedBy.commit = 'e'.repeat(40); f.refresh(); }, 'RECORD_INVALID'],
  ['rehashed receipt has wrong embedded bytes', f => { f.receipt.observation.archiveBase64 = Buffer.from('bad').toString('base64'); f.refresh(); }, 'RECORD_INVALID'],
  ['rehashed receipt invents qualification', f => { f.receipt.qualificationEligible = true; f.refresh(); }, 'RECORD_INVALID'],
  ['rehashed receipt invents transfer digest', f => { f.receipt.preparedManifestSha256 = '0'.repeat(64); f.refresh(); }, 'RECORD_INVALID'],
  ['provider workflow failure', f => { [...f.placeholder.provider.values()][0].conclusion = 'failure'; }, 'RECORD_INVALID'],
  ['original check upload failed', f => { f.placeholder.checkJobs.jobs[0].steps[1].conclusion = 'failure'; }, 'RECORD_INVALID'],
  ['provider API unavailable', f => { f.overrides.unshift(url => url.pathname.includes('/actions/runs/') ? new Response('unavailable', {status: 503}) : undefined); }, 'RECORD_INVALID'],
  ['provider source replaced', f => { const source = [...f.placeholder.provider.values()].find(v => v.type === 'file'); source.content = 'e30='; source.size = 2; }, 'RECORD_INVALID'],
  ['live stub marker removed', f => { f.metadata.get('@getforma/router').versions['0.0.0-stage'].stub = false; }, 'ARCHIVE_UNREADABLE'],
  ['live publication time changed', f => { f.metadata.get('@getforma/router').time['0.0.0-stage'] = '2026-10-27T02:07:02.211Z'; }, 'ARCHIVE_UNREADABLE'],
  ['live canonical URL changed', f => { f.metadata.get('@getforma/router').versions['0.0.0-stage'].dist.tarball = 'https://example.invalid/bad.tgz'; }, 'ARCHIVE_UNREADABLE'],
  ['live bytes changed', f => { f.archives.set('getforma-router-0.0.0-stage.tgz', Buffer.from('bad')); }, 'ARCHIVE_UNREADABLE'],
  ['live archive missing', f => { f.archives.delete('getforma-router-0.0.0-stage.tgz'); }, 'ARCHIVE_UNREADABLE'],
  ['live archive unavailable', f => { f.overrides.unshift(url => url.href === f.placeholder.binding.plan.archive.url ? new Response('unavailable', {status: 503}) : undefined); }, 'ARCHIVE_UNREADABLE'],
  ['live version missing', f => { delete f.metadata.get('@getforma/router').versions['0.0.0-stage']; }, 'REGISTRY_MISSING'],
  ['unplanned package stub', f => { f.metadata.get('@getforma/core').versions['3.2.0-rc.3'].stub = true; }, 'UNKNOWN_PROVIDER_PLACEHOLDER'],
  ['unplanned version stub', f => { const row = clone(f.metadata.get('@getforma/router').versions['0.0.0-stage']); row.version = '0.0.1-stage'; f.metadata.get('@getforma/router').versions['0.0.1-stage'] = row; }, 'UNKNOWN_PROVIDER_PLACEHOLDER'],
  ['ordinary product claim for placeholder', f => { f.record.packages.find(p => p.name === '@getforma/router').version = '0.0.0-stage'; f.refreshHost(); }, 'RECORD_INVALID'],
]) test(`provider placeholder reconciliation refuses ${name}`, async () => {
  const f = providerPlaceholderFixture(); mutate(f); const result = await run(f);
  assert.equal(result.passed, false); assert(codes(result).includes(code), JSON.stringify(result.findings));
});
test('a second host cannot silently deduplicate or replace the finite receipt', async () => {
  const f = providerPlaceholderFixture(), original = f.releases.get('getforma-dev/forma')[0], second = clone(original);
  second.id = 88; second.tag_name = 'v3.2.0'; second.assets[0].id = 124;
  const secondRecord = clone(f.record); secondRecord.tag = 'v3.2.0';
  for (const p of secondRecord.packages) { p.version = '3.2.0'; p.file = filename(p.registry, p.name, p.version); }
  const bytes = Buffer.from(JSON.stringify(secondRecord)); second.assets[0].size = bytes.length; second.assets[0].digest = `sha256:${sha(bytes)}`;
  f.releases.get('getforma-dev/forma').push(second);
  f.overrides.unshift(url => url.pathname.endsWith('/releases/assets/124') ? new Response(bytes) : undefined);
  const result = await run(f); assert.equal(result.passed, false);
  assert(result.findings.some(row => row.code === 'RECORD_INVALID' && /unplanned host/.test(row.message)));
});
test('later provider attempt does not overwrite the original successful recorder attribution', async () => {
  const f = providerPlaceholderFixture(), latest = [...f.placeholder.provider.values()][0];
  latest.run_attempt = 3; latest.conclusion = 'failure';
  const result = await run(f); assert.equal(result.passed, true, JSON.stringify(result.findings));
  const observed = result.verifiedProviderPlaceholders[0].source.hostObservation;
  assert.deepEqual(observed.recorded, {jobId: 54321, runAttempt: 2});
  assert.deepEqual(observed.latestObserved, {runAttempt: 3, status: 'completed', conclusion: 'failure'});
});
