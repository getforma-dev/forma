import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateComparison,validateMobile} from './release-performance-contract.mjs';
import {validateBaselineRecord} from './release-performance-baseline.mjs';
import {comparison,mobile,performanceRecord} from './release-performance-test-fixtures.mjs';
const context={tag:'v3.0.0-beta.1',currentTag:'v3.0.0-rc.1',publishedAt:'2026-10-16T00:00:00Z',before:'2026-10-17T00:00:00Z',digest:'a'.repeat(64)};
function baseline(){const commit='b'.repeat(40);return {schema:1,dryRun:false,tag:context.tag,commit,contracts:{performance:'measured-v1'},packages:[...['forma-ir','forma-ir-derive','forma-server'].map(name=>({registry:'crates',name})),...['core','compiler','build','create-app'].map(name=>({registry:'npm',name:`@getforma/${name}`}))].map(p=>({...p,version:context.tag.slice(1),sha256:'a'.repeat(64)})),measurements:{commit,passed:true,measurements:{performance:performanceRecord()}}};}
test('complete restored comparison samples pass; missing, nonfinite and forged values refuse',()=>{
 validateComparison(comparison());
 for(const edit of [r=>r.browsers.chromium.runtime.forma.mount_1={},r=>r.browsers.chromium.runtime.forma.mount_1.samples.pop(),r=>r.browsers.chromium.runtime.forma.mount_1.samples[0].script_ms=NaN,r=>r.browsers.chromium.runtime.forma.mount_1.script_ms.median=5,r=>r.browsers.chromium.server_state.forma_shared.samples[0].browser_requests=undefined,r=>r.browsers.chromium.runtime.forma.memory_500={},r=>r.browsers.firefox.runtime.forma.update_one_of_500.samples[0].repetitions=1]){const r=comparison();edit(r);assert.throws(()=>validateComparison(r));}
});
test('raw Lighthouse bytes and actual profile agree with every extracted figure',()=>{
 validateMobile(mobile());
 for(const edit of [r=>r[0].runs[0].lighthouse.rawLhr='{}',r=>r[0].runs[0].lighthouse.sha256='a'.repeat(64),r=>r[0].runs[0].lighthouse.lcpMs=0,r=>r[0].profile={throttlingMethod:'simulate'},r=>r[0].runs[0].lighthouse.longTasks=[{duration:0,startTime:0}],r=>r[0].runs[0].run=2,r=>r[0].pilot=true]){const r=mobile();edit(r);assert.throws(()=>validateMobile(r));}
});
test('a comparable DS12 must contain the same complete evidence required of the new release',()=>{
 assert.equal(validateBaselineRecord(baseline(),context).status,'comparable');
 for(const edit of [p=>delete p.n1[0].samplesNanoseconds,p=>p.n5.points[0]={rows:100},p=>p.mobile[0].runs[0].lighthouse.rawLhr='{}',p=>p.client.browsers.chromium.runtime.forma.mount_1={}]){const r=baseline();edit(r.measurements.measurements.performance);assert.throws(()=>validateBaselineRecord(r,context));}
});
