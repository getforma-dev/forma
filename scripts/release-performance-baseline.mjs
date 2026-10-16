// FORMA-191: read the previous published DS12 through GitHub's authenticated
// release API. A transport/parse/contract error is never an absent baseline.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SEMVER, NPM, CRATES} from './release-set.mjs';

export const PERFORMANCE_CONTRACT = 'measured-v1';
export const N1_SHAPES = [300, 1500, 10000, 15000, 20000];
const API = 'https://api.github.com/repos/getforma-dev/forma';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function version(tag) {
  assert(typeof tag === 'string' && tag.startsWith('v') && SEMVER.test(tag.slice(1)) && !tag.endsWith('-dev'), 'DS12: invalid release tag');
  const [core, pre] = tag.slice(1).split('-');
  const [kind, counter] = pre?.split('.') ?? ['final', '0'];
  return [...core.split('.').map(BigInt), BigInt(['alpha', 'beta', 'rc', 'final'].indexOf(kind)), BigInt(counter)];
}
export function compareReleaseTags(left, right) {
  const a = version(left), b = version(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** The writer embeds the complete P17 report under record.measurements. */
export function validateBaselineRecord(record, {tag, currentTag, publishedAt, before, digest}) {
  assert(compareReleaseTags(tag, currentTag) < 0, 'DS12: baseline is not a prior version');
  assert(Number.isFinite(Date.parse(publishedAt)) && Number.isFinite(Date.parse(before)) && Date.parse(publishedAt) < Date.parse(before), 'DS12: baseline is not an earlier published release');
  assert.equal(record.schema, 1, 'DS12: unsupported record schema');
  assert.equal(record.dryRun, false, 'DS12: a dry run is not a published baseline');
  assert.equal(record.tag, tag, 'DS12: asset tag differs from release');
  assert(/^[a-f0-9]{40}$/.test(record.commit), 'DS12: missing exact source commit');
  assert.equal(record.measurements?.commit, record.commit, 'DS12: P17 source differs from release');
  assert.equal(record.measurements?.passed, true, 'DS12: previous P17 did not pass');
  assert(record.contracts && typeof record.contracts === 'object', 'DS12: missing contracts');
  const expected = [...CRATES.map(name => `crates:${name}`), ...NPM.map(name => `npm:@getforma/${name}`)].sort();
  assert(Array.isArray(record.packages), 'DS12: missing packed set');
  assert.deepEqual(record.packages.map(p => `${p.registry}:${p.name}`).sort(), expected, 'DS12: expected exact seven-package set');
  for (const p of record.packages) {
    assert.equal(p.version, tag.slice(1), 'DS12: package version differs from release');
    assert(/^[a-f0-9]{64}$/.test(p.sha256), 'DS12: package hash absent');
  }
  assert(/^[a-f0-9]{64}$/.test(digest), 'DS12: asset digest missing');
  const provenance = {tag, commit:record.commit, publishedAt, sha256:digest};
  const contract = record.contracts.performance;
  if (contract === undefined || contract === null) {
    assert(/^v3\.0\.0-beta\.1$/.test(currentTag), 'DS12: only first beta may establish an absent performance baseline');
    assert(!record.measurements.measurements?.performance, 'DS12: performance figures without their contract');
    return {...provenance, status:'bootstrap', reason:'previous published DS12 predates the performance contract'};
  }
  assert.equal(contract, PERFORMANCE_CONTRACT, 'DS12: unsupported performance contract');
  const performance = record.measurements.measurements?.performance;
  assert.equal(performance?.contract, PERFORMANCE_CONTRACT, 'DS12: declared performance record missing');
  assert.equal(performance.passed, true, 'DS12: previous performance gate failed');
  assert(performance.machine?.profile && performance.machine?.cpuModel && performance.machine?.node, 'DS12: performance machine/profile missing');
  assert(performance.nativeProfile?.includes('cargo build --release --locked'), 'DS12: comparable native profile missing');
  assert.deepEqual(performance.controls, {deadActivationRefused:true,longTaskRefused:true}, 'DS12: performance controls missing');
  assert.deepEqual(performance.n5?.points?.map(p=>p.rows).sort((a,b)=>a-b), [100,200,400,800,1600,3200], 'DS12: N5 figures missing');
  assert(Number.isFinite(performance.n5.medianTimeRatio) && performance.n5.medianTimeRatio>0 && performance.n5.medianTimeRatio<64, 'DS12: invalid N5 time');
  assert.equal(performance.boundaries?.onePastIteration?.code, 'RENDER-302', 'DS12: iteration boundary missing');
  assert.equal(performance.boundaries?.onePastOutput?.code, 'RENDER-301', 'DS12: output boundary missing');
  assert.deepEqual(performance.mobile?.map(p=>p.id).sort(), ['islands-100','tenant-login'], 'DS12: mobile figures missing');
  for (const mobile of performance.mobile) {
    assert.equal(mobile.runs?.length,20,'DS12: mobile samples missing');
    assert(Number.isFinite(mobile.p95TbtMs) && mobile.p95TbtMs>=0 && mobile.p95TbtMs<200,'DS12: invalid mobile TBT');
    for (const run of mobile.runs) assert(typeof run.lighthouse?.rawLhr==='string' && run.activation?.responded===(mobile.id==='islands-100'?100:2),'DS12: mobile raw report or responses missing');
  }
  assert.deepEqual(Object.keys(performance.client?.browsers??{}).sort(), ['chromium','firefox','webkit'], 'DS12: client comparison figures missing');

  assert(Array.isArray(performance.n1), 'DS12: N1 figures missing');
  assert.deepEqual(performance.n1.map(row => row.nominalNodes).sort((a,b)=>a-b), N1_SHAPES, 'DS12: N1 shape set differs');
  for (const row of performance.n1) {
    assert.equal(row.walks, 20000, 'DS12: N1 sample count differs');
    assert(Number.isFinite(row.p99NodesPerSecond) && row.p99NodesPerSecond >= 1_500_000, 'DS12: invalid N1 rate');
  }
  return {...provenance, status:'comparable', n1:performance.n1.map(({nominalNodes,p99NodesPerSecond})=>({nominalNodes,p99NodesPerSecond}))};
}

/** Read all relevant release pages; do not infer absence from a failed fetch. */
export async function readPerformanceBaseline({currentTag, before, token=process.env.GH_TOKEN, fetchImpl=fetch}) {
  version(currentTag);
  assert(Number.isFinite(Date.parse(before)), 'DS12: missing current run start');
  const headers = {'User-Agent':'getforma-release-measurements', Accept:'application/vnd.github+json', ...(token ? {Authorization:`Bearer ${token}`} : {})};
  async function request(url, accept) {
    assert(url.startsWith(`${API}/`), 'DS12: untrusted API asset URL');
    const response = await fetchImpl(url, {headers:{...headers, ...(accept ? {Accept:accept} : {})}, signal:AbortSignal.timeout(20000)});
    assert(response.ok, `DS12: GitHub request failed (${response.status})`);
    return response;
  }
  const releases = [];
  for (let page=1; ; page++) {
    assert(page <= 100, 'DS12: release inventory exceeds bounded pagination');
    const batch = await (await request(`${API}/releases?per_page=100&page=${page}`)).json();
    assert(Array.isArray(batch), 'DS12: malformed release inventory');
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const eligible = releases.filter(r=>!r.draft && /^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(r.tag_name) && compareReleaseTags(r.tag_name,currentTag)<0);
  eligible.sort((a,b)=>compareReleaseTags(b.tag_name,a.tag_name));
  const prior = eligible[0];
  assert(prior, 'DS12: no previous published unified release');
  assert(Number.isFinite(Date.parse(prior.published_at)) && Date.parse(prior.published_at)<Date.parse(before), 'DS12: previous version has invalid publication chronology');
  const assets = prior.assets?.filter(a=>a.name==='release-record.json');
  assert.equal(assets?.length, 1, 'DS12: previous release has no unique record asset');
  const asset=assets[0];
  assert(/^sha256:[a-f0-9]{64}$/.test(asset.digest), 'DS12: GitHub asset has no SHA-256 digest');
  assert(Number.isInteger(asset.size) && asset.size>0 && asset.size<=32*1024*1024, 'DS12: invalid record size');
  const bytes = Buffer.from(await (await request(asset.url, 'application/octet-stream')).arrayBuffer());
  assert.equal(bytes.length, asset.size, 'DS12: asset length differs');
  const digest=sha256(bytes);
  assert.equal(`sha256:${digest}`, asset.digest, 'DS12: asset digest differs');
  return validateBaselineRecord(JSON.parse(bytes.toString('utf8')), {tag:prior.tag_name,currentTag,publishedAt:prior.published_at,before,digest});
}
