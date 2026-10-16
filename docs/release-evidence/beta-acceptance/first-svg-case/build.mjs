import {build} from '../../forma/packages/build/dist/index.js';
import {generateRealIr} from '../../forma/packages/compiler/dist/index.js';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const entry=join(import.meta.dirname,'cases/probe/app.tsx'),outputDir=join(import.meta.dirname,'out/build/probe');
const {manifest}=await build({app:'svg-case-probe',entryPoints:[{entry,outfile:'probe.js'},{entry,outfile:'probe-csr.js',ssr:false}],routes:{'/':{js:['probe'],css:[]},'/csr':{js:['probe-csr'],css:[]}},outputDir,ssr:true,codeSplitting:false});
const ir=generateRealIr(entry);assert(ir);assert.equal(ir.islands.length,3);assert(Buffer.from(ir.binary).equals(readFileSync(join(outputDir,manifest.routes['/'].ir))));
writeFileSync(join(import.meta.dirname,'compile.json'),JSON.stringify({islands:ir.islands.map(i=>i.name),manifest},null,2)+'\n');
