// FORMA-189: pure release-record validation, recall plan and support arithmetic.
// Reading this module never accesses a credential, network or registry.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertReleaseSet, CRATES, NPM } from './release-set.mjs';

const identities = [...NPM.map(name => `npm:@getforma/${name}`), ...CRATES.map(name => `crates:${name}`)].sort();
const unifiedTag = /^v(?:[3-9]|[1-9]\d+)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/;
export function readRecordedSet(bytes, expectedSha256) {
  assert.match(expectedSha256 ?? '', /^[a-f0-9]{64}$/, 'a trusted release-record SHA-256 is required');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedSha256, 'release-record checksum mismatch');
  const record = JSON.parse(bytes);
  assert.equal(record.schema, 1, 'unsupported release-record schema');
  assert.equal(record.dryRun, false, 'a dry-run set is not a published release');
  assertReleaseSet(record.packages, record.tag);
  assert.deepEqual(record.packages.map(p => `${p.registry}:${p.name}`).sort(), identities, 'record must name the exact seven-package set once');
  assert.match(record.commit ?? '', /^[a-f0-9]{40}$/, 'record must name a commit');
  for (const p of record.packages) assert.match(p.sha256 ?? '', /^[a-f0-9]{64}$/, `${p.name}: missing archive hash`);
  assert.equal(record.measurements?.passed, true, 'record has no successful P17');
  assert.equal(record.measurements?.commit, record.commit, 'P17 names another commit');
  return record;
}

export function recallPlan(record, reason) {
  // Revalidate identity even when called directly with an object by tooling.
  const bytes = Buffer.from(JSON.stringify(record));
  readRecordedSet(bytes, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(typeof reason, 'string');
  assert(reason.trim() && reason.length <= 1000 && !/[\u0000-\u001f\u007f]/u.test(reason), 'recall reason must be one nonempty line, at most 1000 characters');
  return {
    tag: record.tag, commit: record.commit,
    actions: record.packages.map(p => p.registry === 'npm'
      ? { registry: 'npm', name: p.name, version: p.version, command: 'npm', args: ['deprecate', `${p.name}@${p.version}`, reason], authority: 'founder interactive sign-in and two-factor authentication' }
      : { registry: 'crates', name: p.name, version: p.version, action: 'yank', url: `https://crates.io/crates/${p.name}/${p.version}`, authority: 'founder registry web session; verify this exact version is yanked' }),
  };
}

function date(value, label) {
  assert.equal(typeof value, 'string', `${label}: missing timestamp`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/, `${label}: expected UTC timestamp`);
  const parsed = new Date(value);
  assert(Number.isFinite(parsed.getTime()), `${label}: invalid timestamp`);
  // JavaScript otherwise silently turns an impossible February date into March.
  assert.equal(parsed.toISOString().slice(0, 19), value.slice(0, 19), `${label}: invalid calendar date`);
  return parsed;
}
export function addCalendarMonths(value, months) {
  const from = date(value, 'publishedAt');
  assert(Number.isInteger(months) && months >= 0 && months <= 120);
  const lastDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months + 1, 0)).getUTCDate();
  const result = new Date(from);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  result.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return result.toISOString();
}

/** Metadata comes from the GitHub Release, not its mutable generated record time. */
export function publishedRelease(record, metadata) {
  assert.equal(metadata.tag_name, record.tag, 'GitHub release and DS12 tags disagree');
  assert.equal(metadata.draft, false, 'draft releases start no support clock');
  const prerelease = record.tag.includes('-');
  assert.equal(metadata.prerelease, prerelease, 'GitHub prerelease classification disagrees with tag');
  date(metadata.published_at, 'GitHub published_at');
  return { tag: record.tag, commit: record.commit, publishedAt: metadata.published_at, prerelease };
}

/** The first stable unified set starts the L-29 maintenance window. */
export function supportRecord(releases) {
  assert(Array.isArray(releases), 'expected published release history');
  const tags = new Set();
  for (const release of releases) {
    assert(unifiedTag.test(release.tag), 'invalid unified release tag');
    assert(!tags.has(release.tag), 'duplicate release in support history');
    tags.add(release.tag);
    assert.equal(release.prerelease, release.tag.includes('-'));
    date(release.publishedAt, release.tag);
  }
  const stable = releases.filter(r => !r.prerelease).sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  const first = new Map();
  for (const release of stable) {
    const major = Number(release.tag.slice(1).split('.')[0]);
    if (!first.has(major)) {
      assert.equal(release.tag, `v${major}.0.0`, 'support history omits the first final of a major');
      first.set(major, release);
    }
  }
  const majors = [...first.entries()];
  if (!majors.length) return { schema: 1, state: 'prerelease', lines: [], nextMajorNotBefore: null };
  assert.equal(majors[0][0], 3, 'support history must include the first stable unified major');
  for (let i = 1; i < majors.length; i++) {
    assert.equal(majors[i][0], majors[i - 1][0] + 1, 'support history has a missing or reordered major');
    assert(Date.parse(majors[i][1].publishedAt) >= Date.parse(addCalendarMonths(majors[i - 1][1].publishedAt, 6)), 'unified majors must be at least six calendar months apart');
  }
  const lines = [{ line: 'v1 maintenance: core 2.x; crates 0.2.x; build 0.3.x; compiler 0.3.x', security: 'Critical and High fixes', until: addCalendarMonths(majors[0][1].publishedAt, 6).slice(0, 10) }];
  for (let i = 0; i < majors.length; i++) {
    lines.push({ line: `${majors[i][0]}.x unified set`, security: 'Critical and High fixes', until: i + 1 < majors.length ? addCalendarMonths(majors[i + 1][1].publishedAt, 6).slice(0, 10) : null });
  }
  return { schema: 1, state: 'stable', lines, nextMajorNotBefore: addCalendarMonths(majors.at(-1)[1].publishedAt, 6) };
}

export const SUPPORT_START = '<!-- forma-supported-lines:start -->';
export const SUPPORT_END = '<!-- forma-supported-lines:end -->';
export function supportedLinesMarkdown(support) {
  if (support.state === 'prerelease') return `${SUPPORT_START}\nThe unified 3.x set is in pre-release. Its final release has not started the\nsix-month maintenance window for v1's lines; no end date is asserted yet.\n${SUPPORT_END}`;
  const rows = support.lines.map(line => `| ${line.line} | ${line.security} | ${line.until ?? 'Current major; six months after its successor ships'} |`);
  return `${SUPPORT_START}\nGenerated from the published release records and their original GitHub publication dates.\n\n| Line | Security support | End date (UTC) |\n|---|---|---|\n${rows.join('\n')}\n\nThe next unified major may ship no earlier than ${support.nextMajorNotBefore}.\nCritical and High fixes target seven calendar days on each supported line.\nEnd dates do not restart on a patch release or a release-record rerun.\n${SUPPORT_END}`;
}
export function renderSecurity(template, support) {
  assert.equal(template.split(SUPPORT_START).length, 2, 'SECURITY.md requires one support start marker');
  assert.equal(template.split(SUPPORT_END).length, 2, 'SECURITY.md requires one support end marker');
  const start = template.indexOf(SUPPORT_START), end = template.indexOf(SUPPORT_END);
  assert(start < end, 'support markers are reversed');
  return template.slice(0, start) + supportedLinesMarkdown(support) + template.slice(end + SUPPORT_END.length);
}

/** Compare with the complete paginated GitHub release inventory. A caller may
 * omit obsolete prereleases, but never an advertised stable unified release. */
export function assertPublishedHistory(releases, inventory) {
  assert(Array.isArray(inventory), 'missing GitHub release inventory');
  const all = inventory.flat();
  assert(all.every(r => r && typeof r === 'object' && typeof r.tag_name === 'string'), 'invalid release inventory');
  const byTag = new Map();
  for (const metadata of all) {
    assert(!byTag.has(metadata.tag_name), 'duplicate tag in release inventory');
    byTag.set(metadata.tag_name, metadata);
    if (/^v(?:[3-9]|[1-9]\d+)\./.test(metadata.tag_name)) {
      // Validate omitted entries before filtering: malformed metadata must not
      // disguise a stable release as a draft or obsolete prerelease.
      assert(unifiedTag.test(metadata.tag_name), 'invalid unified inventory tag');
      assert.equal(typeof metadata.draft, 'boolean', 'invalid inventory draft classification');
      assert.equal(typeof metadata.prerelease, 'boolean', 'invalid inventory prerelease classification');
      assert.equal(metadata.prerelease, metadata.tag_name.includes('-'), 'inventory prerelease classification disagrees with tag');
      if (!metadata.draft) {
        date(metadata.published_at, metadata.tag_name);
        if (!metadata.prerelease) assert(releases.some(r => r.tag === metadata.tag_name), `missing advertised stable record ${metadata.tag_name}`);
      }
    }
  }
  for (const release of releases) {
    const metadata = byTag.get(release.tag);
    assert(metadata, `${release.tag}: absent from published inventory`);
    assert.equal(metadata.draft, false);
    assert.equal(metadata.prerelease, release.prerelease);
    assert.equal(date(metadata.published_at, release.tag).getTime(), date(release.publishedAt, release.tag).getTime(), `${release.tag}: contradictory publication time`);
  }
}
