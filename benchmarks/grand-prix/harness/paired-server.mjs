import { createCampaign } from './campaign.mjs';
// Re-race the frozen published car and exact framework commits on one VM.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostProfile } from './resource-profile.mjs';

export function trialPlan(id, refs) {
  assert(/^[a-z0-9-]+$/.test(id ?? ''), 'invalid run ID');
  assert(refs.length > 0 && refs.length <= 4 && refs.every(ref => /^[a-f0-9]{40}$/.test(ref)) &&
    new Set(refs).size === refs.length, 'provide one to four unique exact source commits');
  return ['published', ...refs].map((ref, index) => ({ ref, id: `${id}-${index}` }));
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const id = process.env.GP_RUN_ID;
  assert(/^[a-z0-9-]+$/.test(id ?? ''), 'set GP_RUN_ID');
  const results = resolve(process.env.GP_RESULTS_DIR || join(root, 'results'));
  const out = join(results, `${id}-paired`);
  const reportPath = join(out, 'run.json');
  const run = (script, env) => new Promise((ok, fail) => {
    const child = spawn(process.execPath, [script], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
    child.once('error', fail);
    child.once('close', code => code === 0 ? ok() : fail(Error(`${script} exited ${code}`)));
  });
  if (process.argv.includes('--cleanup')) {
    if (!existsSync(reportPath)) return;
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.id, id);
    const errors = [];
    for (let index = 0; index < report.trials.length; index++) {
      const trial = report.trials[index];
      assert.equal(trial.id, `${id}-${index}`, 'cleanup ownership mismatch');
      try { await run('harness/cleanup.mjs', { GP_RUN_ID: trial.id }); }
      catch (error) { errors.push(`${trial.id}: ${error}`); }
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    return;
  }
  const trials = trialPlan(id, (process.env.GP_FORMA_REFS ?? '').split(',').filter(Boolean));
  assert(!existsSync(out) && !existsSync(join(results, 'raw')), 'fresh comparison evidence required');
  mkdirSync(out, { recursive: true });
  const diagnostic = process.env.GP_DIAGNOSTIC !== 'false';
  const campaign = createCampaign(join(out, 'campaign.json'));
  const report = { schema: 1, id, campaign, diagnostic, resourceProfile: hostProfile({ diagnostic }),
    before: new Date().toISOString(), events: '1-7', trials, passed: false };
  const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  save();
  try {
    for (const trial of trials) {
      const dir = join(out, trial.ref); mkdirSync(dir);
      trial.before = new Date().toISOString(); save();
      try {
        await run('harness/ci-run.mjs', { GP_RUN_ID: trial.id, GP_CARS: 'forma', GP_EVENTS: '1-7',
          GP_BASELINE: 'true', GP_CHECK_BUDGETS: 'true', GP_COMPRESSION: 'false',
          GP_FORMA_REF: trial.ref === 'published' ? '' : trial.ref });
        trial.passed = true;
      } catch (error) { trial.error = String(error); throw error; }
      finally {
        // Preserve even failed/partial observations before allowing another run.
        if (existsSync(join(results, 'raw'))) renameSync(join(results, 'raw'), join(dir, 'raw'));
        trial.raw = `${trial.ref}/raw`;
        trial.finished = new Date().toISOString(); save();
      }
    }
    report.passed = true;
  } catch (error) { report.error = String(error); process.exitCode = 1; }
  finally { report.finished = new Date().toISOString(); save(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
