// The literal archive is the authenticated npm holding artifact, not executable
// fixture code. All workflow metadata below is explicitly synthetic offline data.
import { createHash } from 'node:crypto';
import { placeholderPlan, PLACEHOLDER_HOST } from '../release-provider-placeholder.mjs';
export const actualPlaceholderBytes = Buffer.from('H4sIAAAAAAAAA+1VTU/DMAztub/CKlfo3LJ20k5MYhIXLmji7q5eG2iTKkk3IcR/R/3YJgaCAxvTNN4livxiW895SUXzZ8rYOSQQcRRF8C0niMIRIl5HGDmIcRhE4EQH7apHbSxpB/G3ebAFbNYTQdXNf9Cv/pNRct81EDEeDj9L0kmFYTiEj/MPgihupNx3I1/hzOf/6gJ4kkr2xuDdZGwXSpc00Kq2rL3LJrpkbYSSDQF99PHKWMq4ixlbJ94YrK653ads5lpUtufPuKyUJv0C/f2CqqA556pIWcNCaWhzpVDVSSFMLmTmuW/H1uScsPb/w3Ryez/1y/QANX7y/yje9T/++/+PcAFbj96pIhUyg8fO8K47y4WB3v4gDBDYraF3jGwb7voXgYkEVbGm5iGgYpPDKtDcnuz4ORlImCWYOimFtZy2uTQvBa+AZNpWXZGwTV+0fi00F0yGfffY6p0+3gHL5RhMAAoAAA==', 'base64');
export function placeholderFixture(commit = 'a'.repeat(40), runId = 12345, runAttempt = 2) {
  const binding = placeholderPlan(), p = binding.plan;
  const metadata = { name: p.name, version: p.version, _id: p.metadata._id, stub: true, description: p.metadata.description,
    dist: { tarball: p.archive.url, shasum: p.archive.sha1, integrity: p.archive.integrity, fileCount: 2, unpackedSize: 338 } };
  const ctx = { tag: PLACEHOLDER_HOST, commit, runId, runAttempt, workflow: '.github/workflows/release.yml', event: 'push' };
  const receipt = { contract: 'forma-npm-provider-placeholder-v1', disposition: p.disposition,
    qualificationEligible: false, supportEligible: false, performanceBaselineEligible: false, soakEligible: false,
    planSha256: binding.sha256, preparedBy: { ...ctx, runAttempt: 1, job: 'check' }, recordedBy: { ...ctx, job: 'record' },
    preparedManifestSha256: 'b'.repeat(64), observation: { observedAt: '2026-10-27T06:00:00.000Z',
      metadataSource: 'https://registry.npmjs.org/%40getforma%2Frouter', metadata, publishedAt: p.metadata.publishedAt,
      archiveBase64: actualPlaceholderBytes.toString('base64') } };
  const content = JSON.stringify({ contract: 'forma-npm-provider-placeholder-prepared-v1', planSha256: binding.sha256, preparedBy: receipt.preparedBy, observation: receipt.observation }, null, 2) + '\n';
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const manifest = JSON.stringify({ schema: 1, entries: [{ path: 'prepared.json', type: 'file', bytes: Buffer.byteLength(content), sha256: sha(content) }] }, null, 2) + '\n';
  receipt.prepared = { content, manifest }; receipt.preparedManifestSha256 = sha(manifest);
  const run = { id: runId, run_attempt: runAttempt, repository: { full_name: 'getforma-dev/forma' }, head_sha: commit,
    head_branch: PLACEHOLDER_HOST, path: ctx.workflow, event: 'push', status: 'completed', conclusion: 'success', run_started_at: '2026-10-27T07:00:00Z' };
  const jobs = { total_count: 1, jobs: [{ id: 54321, name: 'record', run_id: runId, run_attempt: runAttempt, head_sha: commit,
    head_branch: PLACEHOLDER_HOST, status: 'completed', conclusion: 'success', started_at: '2026-10-27T07:01:00Z', completed_at: '2026-10-27T07:02:00Z',
    steps: [{ name: 'Write DS12, the compatibility record and elapsed time', conclusion: 'success', started_at: '2026-10-27T07:01:00Z', completed_at: '2026-10-27T07:02:00Z' }] }] };
  const checkRun = { ...run, run_attempt: 1, conclusion: 'failure', run_started_at: '2026-10-27T05:59:00Z' };
  const checkJobs = { total_count: 1, jobs: [{ id: 54320, name: 'check', run_id: runId, run_attempt: 1, head_sha: commit, head_branch: PLACEHOLDER_HOST, status: 'completed', conclusion: 'success', started_at: '2026-10-27T05:59:30Z', completed_at: '2026-10-27T06:00:04Z', steps: [
    { name: 'Authenticate the finite provider placeholder before publishing', conclusion: 'success', started_at: '2026-10-27T05:59:59Z', completed_at: '2026-10-27T06:00:01Z' },
    { name: 'Retain authenticated provider placeholder', conclusion: 'success', started_at: '2026-10-27T06:00:02Z', completed_at: '2026-10-27T06:00:03Z' },
  ] }] };
  const tagSha = 'c'.repeat(40), api = 'https://api.github.com/repos/getforma-dev/forma';
  const provider = new Map([
    [`${api}/actions/runs/${runId}`, structuredClone(run)], [`${api}/actions/runs/${runId}/attempts/${runAttempt}`, run],
    [`${api}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`, jobs],
    [`${api}/git/ref/tags/${PLACEHOLDER_HOST}`, { ref: `refs/tags/${PLACEHOLDER_HOST}`, object: { type: 'tag', sha: tagSha } }],
    [`${api}/git/tags/${tagSha}`, { tag: PLACEHOLDER_HOST, sha: tagSha, object: { type: 'commit', sha: commit } }],
    [`${api}/contents/docs/release/npm-provider-placeholder-router.json?ref=${commit}`, { type: 'file', path: 'docs/release/npm-provider-placeholder-router.json', encoding: 'base64', size: binding.bytes.length, content: binding.bytes.toString('base64') }],
  ]);
  provider.set(`${api}/actions/runs/${runId}/attempts/1`, checkRun);
  provider.set(`${api}/actions/runs/${runId}/attempts/1/jobs?per_page=100`, checkJobs);
  return { binding, metadata, receipt, provider, run, jobs, checkRun, checkJobs };
}
