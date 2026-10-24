// Run from the repository root after `npm run build -w packages/compiler`.
import { writeFileSync } from 'node:fs';
import { generateRealIr, collectDiagnostics } from '../../../../../packages/compiler/dist/index.js';

const root = new URL('./', import.meta.url);
const emission = collectDiagnostics(() => generateRealIr(new URL('app.tsx', root).pathname));
if (!emission.result || emission.diagnostics.some(diagnostic => diagnostic.strict)) {
  throw new Error(`dashboard refused: ${JSON.stringify(emission.diagnostics)}`);
}
if (emission.result.islands.length !== 0) throw new Error('dashboard unexpectedly has islands');
writeFileSync(new URL('page.ir', root), emission.result.binary);
