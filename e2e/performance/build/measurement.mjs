import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertGraph, sources, expectedFor, NEXT_REVISION, REVISION } from './workload.mjs';

export const POLICY = Object.freeze({
  id: 'n7-build-loop-v1', samples: 20, components: 300,
  fullBuildP95Ms: 30_000, updatedPageP95Ms: 1_000,
  cache: 'compiled-dependencies-only; fresh-application',
  fullEndpoint: 'public-ssr-build-through-release-native-compile-link-embed',
  updateEndpoint: 'before-save-through-updated-http-browser-reload-dom-and-frame',
});

export function assertDependencyGraph(metadata) {
  const app = metadata.packages.find(p => p.name === 'forma-n7-a9');
  const helper = metadata.packages.find(p => p.name === 'forma-n7-dependencies');
  assert(app && helper, 'both fixture packages must exist');
  const direct = p => p.dependencies.map(d => ({ ...d, path: d.path ?? null })).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(direct(app), direct(helper), 'dependency specifications/features must be identical');
  const node = p => metadata.resolve.nodes.find(n => n.id === p.id);
  assert.deepEqual(node(app).deps, node(helper).deps, 'resolved dependency identities/target kinds differ');
  assert.deepEqual(node(app).features, node(helper).features, 'root feature conditions differ');
  assert(!app.targets.some(t => t.kind.includes('custom-build')), 'no application build script in dependency setup');
  return { appId: app.id, helperId: helper.id };
}

export function assertFreshApplication(target, dist, preparationMessages, appId) {
  assert(!existsSync(dist), 'application dist must be absent before timing');
  for (const line of preparationMessages.split('\n').filter(Boolean)) {
    const message = JSON.parse(line);
    assert.notEqual(message.package_id, appId, 'dependency preparation compiled the measured application');
  }
  const scan = path => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      assert(!/^forma[-_]n7[-_]a9(?:$|[-.])/.test(entry.name), `application artifact already exists: ${join(path, entry.name)}`);
      if (entry.isDirectory()) scan(join(path, entry.name));
    }
  };
  scan(target);
}

export function assertPage(html, routeIndex, revision) {
  for (const component of expectedFor(routeIndex)) {
    assert(html.includes(`data-n7-component="${component}"`), `route ${routeIndex} lacks rendered ${component}`);
  }
  if (expectedFor(routeIndex).includes('Shared00')) {
    const shared = /<aside\b[^>]*data-n7-component="Shared00"[^>]*>([\s\S]*?)<\/aside>/.exec(html);
    assert(shared && shared[1].includes(revision), 'the changed shared component is not visible in the selected route');
  }
}

// The same observation loop runs in the real worker and finite endpoint controls.
// The caller takes started immediately BEFORE the source save, not after it.
export async function observeUpdate({ started, now, read, reloadAndFrame, delay, record, deadlineMs = 10_000 }) {
  while (now() - started < deadlineMs) {
    const response = await read();
    assert.equal(response.status, 200, 'updated page request failed');
    const changed = response.html.includes(NEXT_REVISION);
    assertPage(response.html, 0, changed ? NEXT_REVISION : REVISION);
    record({ atMs: now() - started, changed, status: response.status });
    if (changed) {
      const servedMs = now() - started;
      await reloadAndFrame();
      const visibleMs = now() - started;
      assert(visibleMs < deadlineMs, 'updated visible page exceeded observation deadline');
      return { servedMs, visibleMs };
    }
    await delay();
  }
  throw new Error('updated page observation deadline');
}

export function aggregate(samples, source) {
  assert(/^[a-f0-9]{40}$/.test(source), 'exact source commit required');
  assert.equal(samples.length, POLICY.samples, 'all twenty original outcomes required');
  const seen = new Set();
  let commonProfile;
  let runId;
  for (const { result, supervisor } of samples) {
    assert(Number.isInteger(result.sample) && result.sample >= 1 && result.sample <= 20 && !seen.has(result.sample), 'duplicate/invalid sample');
    seen.add(result.sample);
    assert.equal(result.source, source);
    assert.equal(result.attempt, 1, 'replacement attempts cannot qualify');
    assert(/^\d+$/.test(result.runId), 'actual hosted run identity required');
    if (runId) assert.equal(result.runId, runId, 'samples cannot be pooled across campaigns');
    runId = result.runId;
    assert.deepEqual(result.policy, POLICY);
    assert.equal(result.pilot, false, 'a local pilot is not CI qualification');
    assert.equal(result.complete, true, 'failed or incomplete sample');
    assert.equal(result.freshApplicationVerified, true);
    assert.equal(result.semanticChecksPassed, true);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.inventory, assertGraph(sources()), 'complete fixed workload inventory required');
    assert.equal(result.releaseEmbeddingVerified, true, 'release must serve without disk output');
    assert.equal(supervisor.complete, true, 'owned cleanup did not complete');
    assert.equal(supervisor.exitCode, 0);
    assert.equal(supervisor.cleanup.complete, true);
    assert.deepEqual(supervisor.faults, []);
    const { profile } = result;
    assert.equal(profile.platform, 'linux');
    assert.equal(profile.arch, 'x64');
    assert.equal(profile.logicalCpus, 4);
    assert.equal(profile.cargoJobs, 4);
    assert.equal(profile.node, 'v24.22.0');
    assert.match(profile.rust, /^rustc 1\.99\.1 /);
    assert.equal(profile.imageOS, 'ubuntu24');
    assert(profile.imageVersion && profile.chromium && profile.cpu && profile.memoryBytes > 0);
    const fixed = { imageOS: profile.imageOS, imageVersion: profile.imageVersion, rust: profile.rust, node: profile.node, chromium: profile.chromium };
    if (commonProfile) assert.deepEqual(fixed, commonProfile, 'twenty runs used different declared toolchain/image profiles');
    else commonProfile = fixed;
    for (const duration of [result.fullBuildMs, result.update.visibleMs, result.update.servedMs]) assert(Number.isFinite(duration) && duration >= 0, 'invalid original duration');
    assert(result.update.visibleMs >= result.update.servedMs, 'visible endpoint predates served update');
  }
  const summarize = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return { values, min: sorted[0], median: (sorted[9] + sorted[10]) / 2, p95: sorted[18], max: sorted[19] };
  };
  const fullBuild = summarize(samples.map(s => s.result.fullBuildMs));
  const updatedPage = summarize(samples.map(s => s.result.update.visibleMs));
  return { policy: POLICY, source, runId, profile: commonProfile, fullBuild, updatedPage, passed: fullBuild.p95 < POLICY.fullBuildP95Ms && updatedPage.p95 < POLICY.updatedPageP95Ms };
}

export function readSample(directory) {
  return {
    result: JSON.parse(readFileSync(join(directory, 'measurement/result.json'), 'utf8')),
    supervisor: JSON.parse(readFileSync(join(directory, 'owned/supervisor.json'), 'utf8')),
  };
}
