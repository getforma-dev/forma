import {firefox} from 'file:///Users/victorvillacis/dev/Forma/work/FORMA-3-qualification/forma/node_modules/playwright/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {runSkewDrill} from './run-drill.instrumented.mjs';
const browser=await firefox.launch();
try{const result=await runSkewDrill({browser,binary:"/Users/victorvillacis/dev/Forma/work/FORMA-3-qualification/forma/e2e/target/debug/forma-e2e-skew",cwd:"/Users/victorvillacis/dev/Forma/work/FORMA-3-qualification/forma",deployments:JSON.parse(readFileSync("/Users/victorvillacis/dev/Forma/work/FORMA-3-qualification/forma/e2e/skew/out/deployments.json",'utf8'))});writeFileSync(new URL('./result.json',import.meta.url),JSON.stringify({passed:true,result},null,2));}
catch(error){writeFileSync(new URL('./error.json',import.meta.url),JSON.stringify({passed:false,name:error.name,message:error.message,stack:error.stack},null,2));console.error(error.stack);process.exitCode=1;}
finally{await browser.close();}
