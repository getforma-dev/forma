// FORMA-191: read the previous published DS12 through GitHub's authenticated
// release API. A transport/parse/contract error is never an absent baseline.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SEMVER} from './release-set.mjs';
import {RELEASE_RECORD_MAX_BYTES,readBoundedBody} from './release-record-limits.mjs';

import {PERFORMANCE_CONTRACT} from './release-performance-spec.mjs';
export {PERFORMANCE_CONTRACT,N1_SHAPES} from './release-performance-spec.mjs';
import {validatePerformanceRecord,validateHistorical30BaselinePerformance} from './release-performance-contract.mjs';
import {packageIdentitiesForVersion} from './release-package-inventory.mjs';
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
  assert(validUtc(publishedAt) && validUtc(before) && Date.parse(publishedAt) < Date.parse(before), 'DS12: baseline is not an earlier published release');
  assert.equal(record.schema, 1, 'DS12: unsupported record schema');
  assert.equal(record.dryRun, false, 'DS12: a dry run is not a published baseline');
  assert.equal(record.tag, tag, 'DS12: asset tag differs from release');
  assert(/^[a-f0-9]{40}$/.test(record.commit), 'DS12: missing exact source commit');
  assert.equal(record.measurements?.commit, record.commit, 'DS12: P17 source differs from release');
  assert.equal(record.measurements?.passed, true, 'DS12: previous P17 did not pass');
  assert(record.contracts && typeof record.contracts === 'object', 'DS12: missing contracts');
  const expected = packageIdentitiesForVersion(tag.slice(1));
  assert(Array.isArray(record.packages), 'DS12: missing packed set');
  assert.deepEqual(record.packages.map(p => `${p.registry}:${p.name}`).sort(), expected, 'DS12: expected exact versioned package set');
  for (const p of record.packages) {
    assert.equal(p.version, tag.slice(1), 'DS12: package version differs from release');
    assert(/^[a-f0-9]{64}$/.test(p.sha256), 'DS12: package hash absent');
  }
  assert(/^[a-f0-9]{64}$/.test(digest), 'DS12: asset digest missing');
  const provenance = {tag, commit:record.commit, publishedAt, sha256:digest};
  const contract = record.contracts.performance;
  if (contract === undefined || contract === null) {
    // A failed immutable beta tag may never have published a record. The
    // authenticated inventory reader selects the newest published predecessor:
    // bootstrap remains possible only while that predecessor is a 3.0 alpha.
    // A published beta with missing performance must fail, never fall back.
    assert(/^v3\.0\.0-beta\.[1-9]\d*$/.test(currentTag) && /^v3\.0\.0-alpha\.[1-9]\d*$/.test(tag), 'DS12: only first published beta after alpha may establish an absent performance baseline');
    assert(!record.measurements.measurements?.performance, 'DS12: performance figures without their contract');
    return {...provenance, status:'bootstrap', reason:'previous published DS12 predates the performance contract'};
  }
  assert.equal(contract, PERFORMANCE_CONTRACT, 'DS12: unsupported performance contract');
  const performance = record.measurements.measurements?.performance;
  assert.equal(performance?.contract, PERFORMANCE_CONTRACT, 'DS12: declared performance record missing');
  // Published predecessor records retain their original input protocol and
  // controls. This compatibility path is never used for current qualification.
  if(/^v3\.0\.\d+(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/.test(tag))validateHistorical30BaselinePerformance(performance,tag);
  else validatePerformanceRecord(performance);
  return {...provenance, status:'comparable', n1:performance.n1.map(({nominalNodes,p99NodesPerSecond})=>({nominalNodes,p99NodesPerSecond}))};
}

// Validate recognized unified rows before classification can exclude any row.
function validUtc(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return false;
 const time=Date.parse(value);if(!Number.isFinite(time))return false;
 return new Date(time).toISOString()===value.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction)=>`.${(fraction??'').padEnd(3,'0')}Z`);
}
function validateInventory(releases){
 const tags=new Set(),ids=new Set();
 return releases.filter(row=>{
  assert(row&&typeof row==='object'&&!Array.isArray(row),'DS12: malformed release inventory row');
  assert(typeof row.tag_name==='string','DS12: inventory tag missing');
  if(!/^v\d/.test(row.tag_name))return false;
  version(row.tag_name);
  assert.equal(typeof row.draft,'boolean','DS12: inventory draft must be boolean');
  assert.equal(typeof row.prerelease,'boolean','DS12: inventory prerelease must be boolean');
  assert.equal(row.prerelease,row.tag_name.includes('-'),'DS12: inventory classification disagrees with tag');
  assert(Number.isSafeInteger(row.id)&&row.id>0,'DS12: inventory release identity missing');
  assert(!tags.has(row.tag_name)&&!ids.has(row.id),'DS12: duplicate unified release identity');tags.add(row.tag_name);ids.add(row.id);
  if(!row.draft)assert(validUtc(row.published_at),'DS12: inventory publication is not a real UTC timestamp');
  else assert(row.published_at===null||validUtc(row.published_at),'DS12: malformed draft publication');
  return true;
 });
}
/** Read all relevant release pages; do not infer absence from a failed fetch. */
export async function readPerformanceBaseline({currentTag, before, token=process.env.GH_TOKEN, fetchImpl=fetch}) {
  version(currentTag);
  assert(validUtc(before), 'DS12: missing or malformed current run start');
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
  const eligible = validateInventory(releases).filter(r=>!r.draft && compareReleaseTags(r.tag_name,currentTag)<0);
  eligible.sort((a,b)=>compareReleaseTags(b.tag_name,a.tag_name));
  const prior = eligible[0];
  assert(prior, 'DS12: no previous published unified release');
  assert(Number.isFinite(Date.parse(prior.published_at)) && Date.parse(prior.published_at)<Date.parse(before), 'DS12: previous version has invalid publication chronology');
  const assets = prior.assets?.filter(a=>a.name==='release-record.json');
  assert.equal(assets?.length, 1, 'DS12: previous release has no unique record asset');
  const asset=assets[0];
  assert(/^sha256:[a-f0-9]{64}$/.test(asset.digest), 'DS12: GitHub asset has no SHA-256 digest');
  assert(Number.isInteger(asset.size) && asset.size>0 && asset.size<=RELEASE_RECORD_MAX_BYTES, 'DS12: invalid record size');
  const bytes = await readBoundedBody(await request(asset.url, 'application/octet-stream'), RELEASE_RECORD_MAX_BYTES);
  assert.equal(bytes.length, asset.size, 'DS12: asset length differs');
  const digest=sha256(bytes);
  assert.equal(`sha256:${digest}`, asset.digest, 'DS12: asset digest differs');
  return validateBaselineRecord(JSON.parse(bytes.toString('utf8')), {tag:prior.tag_name,currentTag,publishedAt:prior.published_at,before,digest});
}
