import {launch} from '/Users/victorvillacis/dev/Forma/work/codex-release-lead/performance-continuation/run.mjs';
import {fileURLToPath} from 'node:url';
const options={source:'/Users/victorvillacis/dev/Forma/work/FORMA-191-lazy-prototype/forma',output:'/Users/victorvillacis/dev/Forma/work/FORMA-191-lazy-prototype/tmp/product-gate-first',purpose:'lazy prototype build and scoped real-browser correctness; no performance measurement'};
process.exitCode=await launch(options,{workerArgs:[fileURLToPath(new URL('worker.mjs',import.meta.url))],overallTimeoutMs:900000});
