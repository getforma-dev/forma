#!/usr/bin/env node
// SR2/L-48: read registry bytes, never install or execute their contents.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_RECORD_MAX_BYTES } from './release-record-limits.mjs';
import { packageIdentitiesForVersion } from './release-package-inventory.mjs';

const identities = [
  ['npm', '@getforma/core', 'getforma-dev/formajs', 'v', '2.0.3'],
  ['npm', '@getforma/compiler', 'getforma-dev/forma-tools', 'compiler-v', '0.3.7'],
  ['npm', '@getforma/build', 'getforma-dev/forma-tools', 'build-v', '0.3.1'],
  ['npm', '@getforma/create-app', 'getforma-dev/create-forma-app', 'v', '0.6.2'],
  ['crates', 'forma-ir', 'getforma-dev/forma', 'ir-v', '0.2.2'],
  ['crates', 'forma-ir-derive', 'getforma-dev/forma', null, '0.0.0'],
  ['crates', 'forma-server', 'getforma-dev/forma', 'server-v', '0.2.2'],
  ['npm', '@getforma/router', 'getforma-dev/forma', null, '3.2.0'],
];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const hashPattern = /^[a-f0-9]{64}$/;
const key = (registry, name, version) => `${registry}:${name}@${version}`;
const identityKey = p => `${p.registry}:${p.name}`;
const known = new Map(identities.map(i => [`${i[0]}:${i[1]}`, i]));
const defaults = { metadataBytes: 16 * 1024 * 1024, recordBytes: RELEASE_RECORD_MAX_BYTES,
  archiveBytes: 128 * 1024 * 1024, timeoutMs: 120_000, maxPages: 100, deadlineMs: 15 * 60_000 };

export function artifactFilename(registry, name, version) {
  return registry === 'npm' ? `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz` : `${name}-${version}.crate`;
}
const npmArchive = (name, version) => `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${version}.tgz`;
const crateArchive = (name, version) => `https://static.crates.io/crates/${name}/${name}-${version}.crate`;

export function validatePolicy(policy) {
  assert.equal(policy?.schema, 1, 'unsupported reconciliation policy');
  assert(Array.isArray(policy.packages), 'policy package inventory missing');
  const router = policy.packages.some(p => p.name === '@getforma/router');
  const expected = identities.filter(([, name]) => router || name !== '@getforma/router').map(([registry, name]) => `${registry}:${name}`).sort();
  assert.deepEqual(policy.packages.map(identityKey).sort(), expected, 'policy must cover the complete published inventory');
  const seen = new Set();
  for (const p of policy.packages) {
    const id = identityKey(p), spec = known.get(id);
    assert(spec && !seen.has(id), 'unknown or duplicate policy package'); seen.add(id);
    assert.deepEqual(p.recordRepositories, [...new Set([spec[2], 'getforma-dev/forma'])], `${id}: record repositories differ`);
    assert(Array.isArray(p.baseline), `${id}: baseline missing`);
    if (p.name === '@getforma/router') assert.deepEqual(p.baseline, [], 'router has no pre-record historical releases');
    const versions = new Set();
    for (const b of p.baseline) {
      assert(typeof b.version === 'string' && /^\d+\.\d+\.\d+$/.test(b.version) && versionPattern.test(b.version), 'baseline requires an exact historical stable version');
      const parts = b.version.split('.').map(Number), cutoff = spec[4].split('.').map(Number);
      const firstDifference = parts.findIndex((part, i) => part !== cutoff[i]);
      assert(firstDifference >= 0 && parts[firstDifference] < cutoff[firstDifference], `${id}@${b.version}: baseline reaches the first recorded release`);
      assert(!versions.has(b.version), 'duplicate baseline version'); versions.add(b.version);
      assert(typeof b.reason === 'string' && b.reason.length > 10 && typeof b.evidence === 'string' && b.evidence.startsWith('https://'), 'baseline lacks reason/evidence');
    }
  }
  return policy;
}

function safeUrl(input) {
  const u = new URL(input);
  assert(u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash, 'unsafe transport URL');
  return u;
}

export async function reconcile({ policy, fetchImpl = fetch, token = '', limits = {} }) {
  const report = { schema: 1, startedAt: new Date().toISOString(), passed: false,
    externalAlertDelivery: 'deferred-L60', findings: [], packages: [], verifiedArchives: [] };
  const finding = (code, message, detail = {}) => report.findings.push({ code, message, ...detail });
  const finish = () => { report.completedAt = new Date().toISOString(); report.passed = report.findings.length === 0; return report; };
  try { validatePolicy(policy); } catch (e) { finding('BASELINE_INVALID', e.message); return finish(); }
  const budget = { ...defaults, ...limits };
  for (const [name, value] of Object.entries(budget)) assert(Number.isSafeInteger(value) && value > 0 && value <= defaults[name], `invalid ${name} limit`);
  const deadline = Date.now() + budget.deadlineMs;
  const repos = new Set(policy.packages.flatMap(p => p.recordRepositories));
  function apiAllowed(u) {
    return u.hostname === 'api.github.com' && [...repos].some(repo =>
      u.pathname === `/repos/${repo}/releases` || new RegExp(`^/repos/${repo}/releases/assets/[1-9][0-9]*$`).test(u.pathname));
  }
  // Each request's initial address is constructed from checked identities. Only
  // GitHub's asset CDN may receive a redirect; the API credential is not forwarded.
  async function read(url, maxBytes, { asset = false, hash = false } = {}) {
    let current = safeUrl(url);
    const remaining = Math.min(budget.timeoutMs, deadline - Date.now());
    assert(remaining > 0, 'reconciliation deadline exceeded');
    const signal = AbortSignal.timeout(remaining);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const headers = { 'User-Agent': 'getforma-registry-reconciliation (https://github.com/getforma-dev/forma)' };
      if (apiAllowed(current)) {
        headers.Accept = asset ? 'application/octet-stream' : 'application/vnd.github+json';
        headers['X-GitHub-Api-Version'] = '2022-11-28';
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetchImpl(current.href, { headers, redirect: 'manual', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        assert(asset && redirects < 3, 'unexpected redirect');
        const location = response.headers.get('location'); assert(location, 'redirect location absent');
        const next = safeUrl(new URL(location, current).href);
        assert(next.hostname === 'release-assets.githubusercontent.com', 'unapproved asset redirect');
        current = next; continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`source unreadable (HTTP ${response.status})`);
      }
      const reader = response.body?.getReader(); assert(reader, 'response body absent');
      let complete = false, size = 0; const chunks = [], digest = hash ? createHash('sha256') : null;
      try {
        const length = response.headers.get('content-length');
        assert(length === null || (/^\d+$/.test(length) && Number(length) <= maxBytes), 'response exceeds byte limit');
        for (;;) {
          const { value, done } = await reader.read();
          if (done) { complete = true; return hash ? { sha256: digest.digest('hex'), bytes: size } : Buffer.concat(chunks, size); }
          assert(value instanceof Uint8Array, 'non-byte response'); size += value.byteLength;
          assert(size <= maxBytes, 'response exceeds byte limit');
          if (digest) digest.update(value); else chunks.push(Buffer.from(value));
        }
      } finally { if (!complete) await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    throw Error('redirect limit exceeded');
  }
  const json = async (url, size = budget.metadataBytes, opts) => JSON.parse((await read(url, size, opts)).toString('utf8'));
  const records = new Map();
  function addRecord(p, source) {
    assert(known.has(identityKey(p)) && versionPattern.test(p.version) && hashPattern.test(p.sha256), 'invalid record package identity/digest');
    assert.equal(p.file, artifactFilename(p.registry, p.name, p.version), 'record archive filename differs');
    const k = key(p.registry, p.name, p.version);
    const previous = records.get(k) ?? [];
    previous.push({ registry: p.registry, name: p.name, version: p.version, sha256: p.sha256, source }); records.set(k, previous);
  }
  // Inventory releases first, including old maintenance repositories. No missing
  // API response or malformed record becomes an exemption.
  for (const repo of repos) {
    const seenIds = new Set(), seenTags = new Set();
    try {
      for (let page = 1; ; page++) {
        assert(page <= budget.maxPages, 'GitHub page limit exceeded');
        const releases = await json(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`);
        assert(Array.isArray(releases) && releases.length <= 100, 'invalid GitHub release listing');
        for (const release of releases) {
          assert(Number.isSafeInteger(release.id) && release.id > 0 && typeof release.tag_name === 'string' && typeof release.draft === 'boolean', 'invalid GitHub release metadata');
          assert(!seenIds.has(release.id) && !seenTags.has(release.tag_name), 'duplicate release id/tag across pages');
          seenIds.add(release.id); seenTags.add(release.tag_name);
          if (release.draft) continue;
          assert(typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at)), 'release publication time missing');
          const tag = release.tag_name;
          const source = { repository: repo, releaseId: release.id, tag, url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}` };
          const unified = repo === 'getforma-dev/forma' && tag.startsWith('v') && versionPattern.test(tag.slice(1)) && Number(tag.slice(1).split('.')[0]) >= 3;
          if (unified) {
            try {
              assert(Array.isArray(release.assets), 'release assets absent');
              const assets = release.assets.filter(a => a.name === 'release-record.json');
              assert.equal(assets.length, 1, 'missing or duplicate release-record.json');
              const asset = assets[0];
              assert(Number.isSafeInteger(asset.id) && asset.id > 0 && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= budget.recordBytes, 'invalid release record asset size/id');
              const record = await json(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, budget.recordBytes, { asset: true });
              assert(record.schema === 1 && record.dryRun === false && record.tag === tag && /^[a-f0-9]{40}$/.test(record.commit) && /^[1-9][0-9]*$/.test(String(record.run)), 'record producer/tag binding invalid');
              assert(Array.isArray(record.packages), 'incomplete unified package set');
              assert.deepEqual(record.packages.map(identityKey).sort(), packageIdentitiesForVersion(tag.slice(1)), 'incomplete versioned unified package set');
              const ids = new Set();
              for (const p of record.packages) {
                assert(known.has(identityKey(p)) && !ids.has(identityKey(p)) && p.version === tag.slice(1), 'duplicate/wrong unified package version');
                assert(hashPattern.test(p.sha256) && p.file === artifactFilename(p.registry, p.name, p.version), 'invalid unified digest/filename');
                ids.add(identityKey(p));
              }
              for (const p of record.packages) {
                addRecord(p, { ...source, assetId: asset.id });
                if (!policy.packages.some(item => identityKey(item) === identityKey(p)))
                  finding('POLICY_PACKAGE_UNENROLLED', 'published package is absent from the active registry monitor policy', { ...source, name: p.name, version: p.version });
              }
            } catch (e) { finding('RECORD_INVALID', e.message, source); }
          } else {
            for (const spec of identities) {
              const [registry, name, legacyRepo, prefix] = spec;
              if (repo !== legacyRepo || !prefix || !tag.startsWith(prefix)) continue;
              const version = tag.slice(prefix.length);
              if (!versionPattern.test(version) || Number(version.split('.')[0]) >= 3) continue;
              const p = policy.packages.find(p => p.name === name);
              if (p.baseline.some(b => b.version === version)) continue;
              try {
                const lines = String(release.body ?? '').split(/\r?\n/).filter(line => line.startsWith('Artefact:'));
                assert.equal(lines.length, 1, 'missing or ambiguous legacy artifact declaration');
                const match = /^Artefact: `([^`]+)` \((npm|crates\.io)\), SHA-256 `([a-f0-9]{64})`(?:\.|, npm integrity `sha512-[A-Za-z0-9+/=]+`\.)$/.exec(lines[0]);
                assert(match && match[2] === (registry === 'npm' ? 'npm' : 'crates.io'), 'invalid legacy artifact declaration');
                addRecord({ registry, name, version, file: match[1], sha256: match[3] }, source);
              } catch (e) { finding('RECORD_INVALID', e.message, { ...source, name, version }); }
            }
          }
        }
        if (releases.length < 100) break;
      }
    } catch (e) { finding('RECORD_UNREADABLE', e.message, { repository: repo }); }
  }
  for (const p of policy.packages) {
    const detail = { registry: p.registry, name: p.name }, result = { ...detail, versions: 0, baseline: 0, verified: 0 };
    report.packages.push(result);
    let versions;
    try {
      versions = new Map();
      if (p.registry === 'npm') {
        const data = await json(`https://registry.npmjs.org/${encodeURIComponent(p.name)}`);
        assert(data.name === p.name && data.versions && typeof data.versions === 'object' && !Array.isArray(data.versions), 'invalid npm version inventory');
        for (const [version, row] of Object.entries(data.versions)) {
          assert(versionPattern.test(version) && row.name === p.name && row.version === version, 'invalid npm version identity');
          versions.set(version, row);
        }
      } else {
        let next = `https://crates.io/api/v1/crates/${p.name}/versions`, total;
        const pages = new Set();
        while (next) {
          assert(pages.size < budget.maxPages && !pages.has(next), 'crates page limit/loop'); pages.add(next);
          const u = safeUrl(next);
          assert(u.hostname === 'crates.io' && u.pathname === `/api/v1/crates/${p.name}/versions`, 'unsafe crates pagination URL');
          const data = await json(next);
          assert(Array.isArray(data.versions) && Number.isSafeInteger(data.meta?.total) && data.meta.total >= 0 && (data.meta.next_page === null || typeof data.meta.next_page === 'string'), 'invalid crates version inventory');
          if (total === undefined) total = data.meta.total;
          assert.equal(data.meta.total, total, 'crates inventory changed during pagination');
          for (const row of data.versions) {
            assert(row.crate === p.name && versionPattern.test(row.num) && hashPattern.test(row.checksum) && !versions.has(row.num), 'invalid/duplicate crate version');
            versions.set(row.num, row);
          }
          assert(data.meta.next_page === null || data.versions.length > 0, 'empty crates continuation');
          next = data.meta.next_page === null ? null : new URL(data.meta.next_page, u).href;
        }
        assert.equal(versions.size, total, 'incomplete crates inventory');
      }
      assert(versions.size > 0, 'empty package version inventory'); result.versions = versions.size;
      for (const b of p.baseline) assert(versions.has(b.version), `baseline version absent: ${b.version}`);
    } catch (e) { finding('REGISTRY_UNREADABLE', e.message, detail); continue; }
    for (const [version, row] of versions) {
      if (p.baseline.some(b => b.version === version)) { result.baseline++; continue; }
      const identity = { ...detail, version }, matches = records.get(key(p.registry, p.name, version)) ?? [];
      if (!matches.length) { finding('MISS_RECORD', 'published version has no valid release record', identity); continue; }
      if (matches.length !== 1) { finding('AMBIGUOUS_RECORD', 'multiple records claim this version', { ...identity, sources: matches.map(m => m.source) }); continue; }
      const expected = matches[0];
      try {
        const url = p.registry === 'npm' ? npmArchive(p.name, version) : crateArchive(p.name, version);
        if (p.registry === 'npm') assert.equal(row.dist?.tarball, url, 'npm archive URL differs from canonical package URL');
        const actual = await read(url, budget.archiveBytes, { hash: true });
        if (actual.sha256 !== expected.sha256 || (p.registry === 'crates' && actual.sha256 !== row.checksum)) {
          finding('HASH_MISMATCH', 'registry archive differs from release record or registry checksum', { ...identity, source: expected.source, expected: expected.sha256, actual: actual.sha256, registryChecksum: row.checksum ?? null, bytes: actual.bytes });
        } else {
          result.verified++;
          report.verifiedArchives.push({ ...identity, sha256: actual.sha256, bytes: actual.bytes, archiveUrl: url, source: expected.source });
        }
      } catch (e) { finding('ARCHIVE_UNREADABLE', e.message, { ...identity, source: expected.source }); }
    }
    for (const matches of records.values()) {
      const entry = matches[0];
      if (entry.registry === p.registry && entry.name === p.name && !versions.has(entry.version)) finding('REGISTRY_MISSING', 'release record names a version absent from the complete registry inventory', { ...detail, version: entry.version, source: entry.source });
    }
  }
  return finish();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output;
  try {
    const args = process.argv.slice(2), options = {};
    assert(args.length % 2 === 0, 'usage: --policy FILE --output FILE');
    for (let i = 0; i < args.length; i += 2) { assert(['--policy', '--output'].includes(args[i]) && !options[args[i]] && args[i + 1], 'unknown/duplicate option'); options[args[i]] = args[i + 1]; }
    assert(options['--output'], '--output required'); output = resolve(options['--output']);
    const policy = JSON.parse(readFileSync(options['--policy'] ?? new URL('./registry-reconcile-policy.json', import.meta.url), 'utf8'));
    const report = await reconcile({ policy, token: process.env.GH_TOKEN ?? '' });
    mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`Registry reconciliation ${report.passed ? 'PASS' : 'FAIL'}: ${report.packages.reduce((n, p) => n + p.verified, 0)} archives verified; ${report.findings.length} findings. External delivery deferred (L-60).`);
    for (const f of report.findings) console.log(JSON.stringify(f));
    if (!report.passed) process.exitCode = 1;
  } catch (e) {
    if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify({ schema: 1, passed: false, externalAlertDelivery: 'deferred-L60', findings: [{ code: 'CHECK_FAILED', message: e.message }] }, null, 2) + '\n'); }
    console.error(`registry-reconcile: ${e.message}`); process.exitCode = 1;
  }
}
