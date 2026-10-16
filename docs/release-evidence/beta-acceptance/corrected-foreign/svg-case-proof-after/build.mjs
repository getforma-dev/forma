import {build} from '../../forma/packages/build/dist/index.js';
import {generateRealIr} from '../../forma/packages/compiler/dist/index.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const original=join(import.meta.dirname,'cases/probe/app.tsx');
assert(readFileSync(original).equals(readFileSync(new URL('../svg-case-probe/cases/probe/app.tsx',import.meta.url))));
let refusal;try{generateRealIr(original);}catch(error){refusal={code:error.code,message:error.message};}
assert.equal(refusal?.code,'BUILD-610');assert.match(refusal.message,/attribute TabIndex/);
writeFileSync(join(import.meta.dirname,'native-refusal.json'),JSON.stringify(refusal,null,2)+'\n');
let buildFailure;try{await build({app:'native-negative',entryPoints:[{entry:original,outfile:'negative.js'}],routes:{'/':{js:['negative'],css:[]}},outputDir:join(import.meta.dirname,'out/native-refusal'),ssr:true,codeSplitting:false});}catch(error){buildFailure=String(error);}
assert.match(buildFailure??'',/BUILD-610.*attribute TabIndex/s);
writeFileSync(join(import.meta.dirname,'build-refusal.txt'),buildFailure+'\n');
await build({app:'browser-control',entryPoints:[{entry:join(import.meta.dirname,'cases/probe/native.tsx'),outfile:'probe.js'},{entry:original,outfile:'probe-csr.js',ssr:false}],routes:{'/':{js:['probe'],css:[]},'/csr':{js:['probe-csr'],css:[]}},outputDir:join(import.meta.dirname,'out/build/probe'),ssr:true,codeSplitting:false});
