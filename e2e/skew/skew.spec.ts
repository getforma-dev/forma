import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSkewDrill, SKEW_DRILL_CHECKS } from './run-drill.mjs';

test('real native rolling deployment, rollback, retention and skew guard', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const cwd = resolve(__dirname, '../..');
  const binary = resolve(cwd, 'e2e/target/debug', process.platform === 'win32' ? 'forma-e2e-skew.exe' : 'forma-e2e-skew');
  const deployments = JSON.parse(readFileSync(resolve(__dirname, 'out/deployments.json'), 'utf8'));
  const report = await runSkewDrill({ browser, binary, cwd, deployments });
  expect(report.checks).toEqual(SKEW_DRILL_CHECKS);
  await info.attach('skew-drill', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});
