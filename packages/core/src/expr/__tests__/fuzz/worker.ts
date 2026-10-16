import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { CampaignFailure, runCampaign, replayRegressions } from './campaign';
import { runPreflight } from './preflight';

const [seedText, countText, output, metadataFile, engineUrl] = process.argv.slice(2);
if (!seedText || !countText || !output || !metadataFile || !engineUrl) throw new Error('missing campaign arguments');
const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
const write = (value: unknown): void => {
  // Undefined is an expected Array.from element, so do not silently record it
  // as JSON null. The source/state/operation also remain in the failure record.
  const body = JSON.stringify(value, (_key, item) => item === undefined ? { $formaFuzzValue: 'undefined' } : item, 2);
  writeFileSync(output + '.tmp', body + '\n');
  renameSync(output + '.tmp', output);
};

try {
  const report = runCampaign(Number(seedText), Number(countText), progress => write({ ...metadata, passed: false, status: 'running', report: progress }));
  const regressions = replayRegressions();
  const preflight = await runPreflight(() => import(engineUrl));
  write({ ...metadata, passed: true, status: 'complete', report, regressions, preflight });
  process.stdout.write(JSON.stringify({ passed: true, completed: report.completed, admitted: report.admitted, refused: report.refused, elapsedMs: report.elapsedMs }) + '\n');
} catch (error) {
  write({
    ...metadata, passed: false, status: 'failed',
    ...(error instanceof CampaignFailure ? { report: error.report, failure: { index: error.index, input: error.input } } : {}),
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.slice(0, 4096) : undefined,
  });
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
