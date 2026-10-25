// The race uses the product compiler, before Vite lowers JSX. No app workload changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function compilerPlugin(modulePath, evidencePath) {
  if (!modulePath) return undefined;
  assert(evidencePath, 'compiler evidence destination required');
  const compiler = await import(pathToFileURL(modulePath).href);
  assert.equal(typeof compiler.transformClientTemplates, 'function');
  const sha = source => createHash('sha256').update(source).digest('hex');
  const report = { compilerSha256: sha(readFileSync(modulePath)), transformations: [] };
  return {
    name: 'forma-product-compiler', enforce: 'pre',
    transform(source, filename) {
      if (!/\.[jt]sx$/.test(filename) || filename.split(/[\\/]/).includes('node_modules')) return;
      const output = compiler.transformClientTemplates(source, { filename, factory: 'h', runtime: 'transform' });
      assert.equal(typeof output, 'string');
      report.transformations.push({ filename, sourceSha256: sha(source), outputSha256: sha(output), changed: output !== source, output });
      return output === source ? undefined : { code: output, map: null };
    },
    closeBundle() {
      assert(report.transformations.some(row => row.changed), 'candidate compiler did not optimize the race app');
      writeFileSync(evidencePath, JSON.stringify(report, null, 2) + '\n');
    },
  };
}
