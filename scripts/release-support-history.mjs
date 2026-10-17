// Standard-library GitHub reader. API metadata authenticates each DS12 digest;
// no missing, malformed or unreadable stable record is treated as no history.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readRecordedSet, publishedRelease, supportRecord, assertPublishedHistory, validatedReleaseInventory } from './release-support.mjs';
import {RELEASE_RECORD_MAX_BYTES,readBoundedBody} from './release-record-limits.mjs';
const API = 'https://api.github.com/repos/getforma-dev/forma';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const unified = /^v(?:[3-9]|[1-9]\d+)\./;

function reader(fetchImpl, token) {
  return async (url, binary = false, timeout = 20_000) => {
    assert(url.startsWith(`${API}/`), 'untrusted release-history URL');
    const response = await fetchImpl(url, {
      headers: { Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json', 'User-Agent': 'getforma-release-support', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(timeout),
    });
    const bytes = await readBoundedBody(response, binary ? RELEASE_RECORD_MAX_BYTES : 4 * 1024 * 1024);
    return binary ? bytes : JSON.parse(bytes);
  };
}
export async function githubReleaseMetadata(tag, { fetchImpl = fetch, token = process.env.GH_TOKEN } = {}) {
  return reader(fetchImpl, token)(`${API}/releases/tags/${encodeURIComponent(tag)}`);
}

async function releaseInventory(get) {
  const inventory = [];
  for (let page = 1; ; page++) {
    assert(page <= 50, 'GitHub release inventory exceeds 5000 records');
    const rows = await get(`${API}/releases?per_page=100&page=${page}`);
    assert(Array.isArray(rows) && rows.length <= 100, 'malformed GitHub release inventory page');
    inventory.push(...rows);
    if (rows.length < 100) return inventory;
  }
}
function historyCandidates(inventory, targetTag) {
  const candidates = inventory.filter(r => unified.test(r.tag_name) && !r.draft && r.tag_name !== targetTag);
  // Stable records are exhaustive; keep one latest prerelease as before.
  const latestPreview = candidates.filter(r => r.prerelease).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  return candidates.filter(r => !r.prerelease || r === latestPreview);
}
function historyIdentity(inventory, targetTag) {
  return historyCandidates(inventory, targetTag).map(m => ({ tag: m.tag_name, publishedAt: m.published_at,
    assets: m.assets?.filter(a => a.name === 'release-record.json').map(({ url, size, digest }) => ({ url, size, digest })),
  })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** targetTag is the tag currently being qualified. Preflight validates its
 * metadata but excludes its possibly unfinished DS12. Post-publication uses
 * only the current locally verified DS11/P17 record as that one override.
 * waitForCurrent is opt-in only after an acknowledged release write. */
export async function readSupportHistory({ targetTag, currentRecord, currentMetadata, waitForCurrent = false,
  fetchImpl = fetch, token = process.env.GH_TOKEN, now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  assert(/^v(?:[3-9]|[1-9]\d+)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/.test(targetTag), 'invalid current release tag');
  assert(!waitForCurrent || (currentRecord && currentMetadata), 'visibility wait requires the current verified publication');
  const get = reader(fetchImpl, token);
  let inventory = await releaseInventory(get);
  const byTag = validatedReleaseInventory(inventory);
  let targetMetadata = byTag.get(targetTag);
  if (targetMetadata) assert.equal(targetMetadata.draft, false, 'current tag already has a draft release; resolve it before publishing');
  // Stable records are exhaustive. One latest prerelease proves a pre-final
  // history without downloading every superseded prerelease forever.
  const selected = historyCandidates(inventory, targetTag);
  const releases = [], sources = [];
  for (const metadata of selected) {
    assert(Array.isArray(metadata.assets), `${metadata.tag_name}: missing release assets`);
    const assets = metadata.assets.filter(a => a.name === 'release-record.json');
    assert.equal(assets.length, 1, `${metadata.tag_name}: requires one release-record.json`);
    const asset = assets[0];
    assert(new RegExp(`^${API.replaceAll('.', '\\.')}\\/releases\\/assets\\/[1-9][0-9]*$`).test(asset.url), 'untrusted DS12 asset URL');
    assert(/^sha256:[a-f0-9]{64}$/.test(asset.digest), 'DS12 requires GitHub SHA-256 digest');
    assert(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= RELEASE_RECORD_MAX_BYTES, 'DS12 invalid asset size');
    const bytes = await get(asset.url, true);
    assert.equal(bytes.length, asset.size, 'DS12 asset length differs');
    const digest = asset.digest.slice(7), record = readRecordedSet(bytes, digest);
    releases.push(publishedRelease(record, metadata));
    sources.push({ tag: record.tag, commit: record.commit, sha256: digest, publishedAt: metadata.published_at });
  }
  if (currentRecord || currentMetadata) {
    assert(currentRecord && currentMetadata, 'current publication requires both record and metadata');
    assert.equal(currentRecord.tag, targetTag);
    const bytes = Buffer.from(JSON.stringify(currentRecord));
    const verified = readRecordedSet(bytes, sha(bytes));
    const current = publishedRelease(verified, currentMetadata);
    if (!targetMetadata && waitForCurrent) {
      // Only the acknowledged current write may be temporarily absent. Validate
      // prior history before waiting, and never synthesize an inventory entry.
      assertPublishedHistory(releases, inventory);
      supportRecord([...releases, current]);
      // At most three additional full inventories within one 20-second budget.
      // Authenticate prior DS12 only once; a changed history fails immediately.
      const identity = historyIdentity(inventory, targetTag), deadline = now() + 20_000;
      const remaining = () => {
        const ms = deadline - now();
        assert(ms > 0, 'current publication inventory visibility deadline exceeded');
        return ms;
      };
      for (let attempt = 0; attempt < 3 && !targetMetadata; attempt++) {
        await sleep(Math.min(2_000, remaining()));
        inventory = await releaseInventory(async url => {
          const rows = await get(url, false, Math.ceil(Math.min(20_000, remaining())));
          remaining();
          return rows;
        });
        const refreshed = validatedReleaseInventory(inventory);
        targetMetadata = refreshed.get(targetTag);
        if (targetMetadata) assert.equal(targetMetadata.draft, false, 'current tag already has a draft release; resolve it before publishing');
        assert.deepEqual(historyIdentity(inventory, targetTag), identity, 'published history changed during current publication visibility wait');
        assertPublishedHistory(releases, inventory.filter(r => r.tag_name !== targetTag));
      }
    }
    assert(targetMetadata, 'current publication absent from complete inventory');
    assert.equal(targetMetadata.published_at, current.publishedAt, 'current publication time changed between API reads');
    releases.push(current);
    sources.push({ tag: current.tag, commit: current.commit, publishedAt: current.publishedAt, source: 'current verified DS11 and P17' });
    assertPublishedHistory(releases, inventory);
  } else assertPublishedHistory(releases, inventory.filter(r => r.tag_name !== targetTag));
  // On a rerun of the first final, later patch records are not a complete
  // support history by themselves. Keep the validated original publication in
  // arithmetic while explicitly marking its DS12 as pending the record stage.
  const currentRecordPending = Boolean(targetMetadata && !currentRecord);
  const supportHistory = currentRecordPending ? [...releases, {
    tag: targetTag, publishedAt: targetMetadata.published_at, prerelease: targetMetadata.prerelease,
  }] : releases;
  return { releases, sources, targetMetadata, currentRecordPending, inventorySha256: sha(Buffer.from(JSON.stringify(inventory))), support: supportRecord(supportHistory) };
}

export function assertPublicationAllowed(history, targetTag, now = new Date()) {
  // This is a prospective guard only. A support document uses actual GitHub
  // publication metadata later; it never prints this provisional date.
  const publishedAt = history.targetMetadata?.published_at ?? now.toISOString();
  return supportRecord([...history.releases.filter(r => r.tag !== targetTag), {
    tag: targetTag, publishedAt, prerelease: targetTag.includes('-'),
  }]);
}
