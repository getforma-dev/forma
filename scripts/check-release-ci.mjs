#!/usr/bin/env node
// SR13: a missing/unreadable status is failure, never permission to publish.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function selectRun(response, sha, repository) {
  assert(Array.isArray(response?.workflow_runs), 'unreadable CI response');
  const runs = response.workflow_runs.filter(r => r.head_sha === sha && r.head_branch === 'main' && r.event === 'push' && r.repository?.full_name === repository && r.path === '.github/workflows/ci.yml');
  assert(runs.length, 'no CI push run for this exact commit on main');
  runs.sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt);
  const run = runs[0];
  assert.equal(run.status, 'completed', 'CI has not completed; retry after it finishes');
  assert.equal(run.conclusion, 'success', 'latest CI run did not succeed');
  return run;
}
export function checkJobs(response) {
  assert(Array.isArray(response?.jobs) && response.jobs.length, 'unreadable CI jobs');
  for (const required of ['check', 'release-workflow']) {
    const job = response.jobs.find(j => j.name === required);
    assert(job && job.status === 'completed' && job.conclusion === 'success', `CI job ${required} did not run successfully`);
  }
  const check = response.jobs.find(j => j.name === 'check');
  assert(check.steps?.some(s => s.conclusion === 'success' && /one command|R17/i.test(s.name)), 'R17/probes step did not execute');
  for (const job of response.jobs) assert(['success', 'skipped'].includes(job.conclusion), `CI job ${job.name}: ${job.conclusion}`);
}
async function get(path) {
  const response = await fetch(`https://api.github.com/${path}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'getforma-release-ci' }, signal: AbortSignal.timeout(20_000) });
  assert(response.ok, `GitHub status unreadable (${response.status})`);
  return response.json();
}
export async function main() {
  const repo = process.env.GITHUB_REPOSITORY, sha = process.env.GITHUB_SHA;
  assert(repo === 'getforma-dev/forma' && /^[a-f0-9]{40}$/.test(sha), 'unexpected repository or commit');
  assert(process.env.GITHUB_EVENT_NAME === 'push' && /^refs\/tags\/v/.test(process.env.GITHUB_REF), 'release gate only accepts a tag push');
  const response = await get(`repos/${repo}/actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=${sha}&per_page=100`);
  const run = selectRun(response, sha, repo);
  const jobs = await get(`repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  assert(jobs.total_count <= 100, 'CI job list is truncated');
  checkJobs(jobs);
  // workflow created_at is the server's tag-event run timestamp; commit author timestamps
  // are not a clock for the tag. A rerun retains this original timestamp.
  const current = await get(`repos/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`);
  assert(Number.isFinite(Date.parse(current.created_at)), 'missing release event timestamp');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `started-at=${current.created_at}\nci-run=${run.id}\n`);
  console.log(`CI ${run.id} attempt ${run.run_attempt} passed for ${sha}, including R17/probes.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(`SR13: ${e.message}`); process.exitCode = 1; });
