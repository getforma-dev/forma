// Explicit orchestration identity. Payload modules always come from the immutable RC.
import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, run } from './release-set.mjs';
import { sha256 } from './release-burn-in-inputs.mjs';
export const FINAL_COMMIT = '2006423b21fe0f8dd5a510bd09bfe3b8748327a5';
export const RC_COMMIT = '12320f4340d87cbb96575b5bb3b7eab42121d477';
export const RC_TAG = 'v3.0.0-rc.5';
export const WORKFLOW = '.github/workflows/post-final-soak-v2.yml';
export function sourceStatus(root) {
  return run('git', ['status', '--porcelain=v1', '--untracked-files=all'], root, { maxBuffer: 1024 * 1024 });
}
export function requirePayload(root, tag = RC_TAG, commit = RC_COMMIT) {
  assert.equal(tag, RC_TAG); assert.equal(commit, RC_COMMIT);
  assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), commit, 'payload checkout differs');
  assert.equal(run('git', ['rev-parse', `${tag}^{commit}`], root).trim(), commit, 'payload tag differs');
  assert.equal(sourceStatus(root), '', 'payload source must be clean including untracked files');
  return { tag, commit, tree: run('git', ['rev-parse', 'HEAD^{tree}'], root).trim() };
}
export function donorDiff(root, commit) {
  assert.match(commit ?? '', /^[a-f0-9]{40}$/);
  run('git', ['merge-base', '--is-ancestor', FINAL_COMMIT, commit], root);
  return sha256(run('git', ['diff', '--binary', '--full-index', FINAL_COMMIT, commit, '--'], root, { encoding: 'buffer' }));
}
export function workerContext({ payloadRoot, donorRoot = ROOT, env = process.env, tag = RC_TAG, commit = RC_COMMIT }) {
  assert.notEqual(realpathSync(payloadRoot), realpathSync(donorRoot), 'separate donor and payload checkouts required');
  assert.equal(env.PYTHONDONTWRITEBYTECODE, '1', 'bytecode suppression must precede Python ownership imports');
  assert(!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'no publishing authority');
  assert.equal(env.GITHUB_REPOSITORY, 'getforma-dev/forma'); assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.match(env.GITHUB_REF ?? '', /^refs\/heads\/[A-Za-z0-9._/-]+$/);
  const donorCommit = run('git', ['rev-parse', 'HEAD'], donorRoot).trim();
  assert.equal(env.GITHUB_SHA, donorCommit, 'actual donor SHA differs');
  assert.equal(env.GITHUB_WORKFLOW_SHA, donorCommit, 'workflow donor SHA differs');
  assert.equal(env.GITHUB_WORKFLOW_REF, `getforma-dev/forma/${WORKFLOW}@${env.GITHUB_REF}`, 'actual donor workflow differs');
  assert.equal(sourceStatus(donorRoot), '', 'donor source must be clean');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert(/^[1-9][0-9]*$/.test(env[key] ?? '') && Number.isSafeInteger(Number(env[key])));
  return { contract: 'post-final-soak-orchestration-v2',
    donor: { commit: donorCommit, ref: env.GITHUB_REF, workflow: WORKFLOW, runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT), baseCommit: FINAL_COMMIT, diffSha256: donorDiff(donorRoot, donorCommit) },
    payload: requirePayload(payloadRoot, tag, commit) };
}
// This pin is supplied after independent review, never self-generated acceptance.
export function validateDonorReview(pin, root = ROOT) {
  assert.equal(pin?.contract, 'post-final-soak-donor-review-v2'); assert.equal(pin.baseCommit, FINAL_COMMIT);
  assert.equal(run('git', ['rev-parse', 'HEAD'], root).trim(), pin.donorCommit, 'reviewed donor checkout differs');
  assert.equal(sourceStatus(root), '', 'reviewed donor must be clean');
  assert.equal(pin.diffSha256, donorDiff(root, pin.donorCommit), 'reviewed donor diff differs');
  assert.equal(typeof pin.reviewEvidence?.content, 'string'); assert(pin.reviewEvidence.content.trim(), 'independent review required');
  assert.equal(sha256(Buffer.from(pin.reviewEvidence.content)), pin.reviewEvidence.sha256, 'review receipt differs');
  return pin;
}
export function validateOrchestration(context, { pin, run: hosted, payloadRoot }) {
  assert.equal(context?.contract, 'post-final-soak-orchestration-v2');
  assert.deepEqual(context.payload, requirePayload(payloadRoot));
  assert.deepEqual(context.donor, { commit: pin.donorCommit, ref: `refs/heads/${hosted.head_branch}`, workflow: WORKFLOW,
    runId: hosted.id, runAttempt: hosted.run_attempt, baseCommit: FINAL_COMMIT, diffSha256: pin.diffSha256 });
  assert.equal(hosted.repository?.full_name, 'getforma-dev/forma'); assert.equal(hosted.head_sha, pin.donorCommit);
  assert.equal(hosted.path, WORKFLOW); assert.equal(hosted.event, 'workflow_dispatch');
  assert.equal(hosted.status, 'completed'); assert.equal(hosted.conclusion, 'success');
  return context;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, payloadRoot, output] = process.argv.slice(2);
  assert(output && ['check', 'status'].includes(mode));
  // Status capture is deliberately outside either checkout, even on failure.
  const destination = join(realpathSync(dirname(output)), output.split(sep).at(-1));
  for (const root of [ROOT, payloadRoot]) {
    const inside = relative(realpathSync(root), destination);
    assert(inside && (inside.startsWith(`..${sep}`) || isAbsolute(inside)), 'status output must be external');
  }
  const status = { donor: sourceStatus(ROOT), payload: sourceStatus(payloadRoot) };
  writeFileSync(destination, JSON.stringify(status, null, 2) + '\n', { flag: 'wx' });
  if (mode === 'check') workerContext({ payloadRoot });
}
