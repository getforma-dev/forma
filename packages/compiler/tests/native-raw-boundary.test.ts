import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
import {collectDiagnostics} from '../src/diagnostics';
import {renderDefaults} from './helpers/render';

const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const imports="import {h,mount,activateIslands,createSignal,createShow,createList,browserOnly,trustedHtml} from '@getforma/core';\n";
function emit(source:string,fileName='app.ts',files:Record<string,string>={}) {
 const root=mkdtempSync(join(tmpdir(),'forma-native-raw-'));roots.push(root);
 for(const[name,text]of Object.entries({[fileName]:source,...files})){const file=join(root,name);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,text);}
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 let failure:unknown;const {result,diagnostics}=collectDiagnostics(()=>{try{return generateRealIr(join(root,fileName));}catch(error){failure=error;return null;}});
 return{result,diagnostics,failure};
}
function page(tree:string,extra='',props='') {return `${imports}${extra}\nexport function Page(${props}){return h('main',null,${tree});}\nmount(()=>Page(),'#app');\n`;}
function refused(source:string,code:string,fileName='app.ts',files:Record<string,string>={}) {
 const got=emit(source,fileName,files);expect(got.result).toBeNull();expect(got.failure).toMatchObject({code});
 const d=got.diagnostics.find(d=>d.code===code);expect(d).toBeDefined();expect(d!.line).toBeGreaterThan(0);expect(d!.column).toBeGreaterThan(0);return d!;
}
const scriptTrees=[
 ['HTML',"h('script',null,'void 0;')"],['case variant',"h('ScRiPt',null,'void 0;')"],
 ['empty',"h('script')"],['external URL',"h('script',{src:'/owned.js'})"],
 ['inert JSON type',"h('script',{type:'application/json'},'{}')"],
 ['SVG',"h('svg',null,h('script',null,'void 0;'))"],
 ['MathML',"h('math',null,h('script',null,'void 0;'))"],
 ['integration point',"h('svg',null,h('foreignObject',null,h('script',null,'void 0;')))"],
] as const;
describe('native script elements preserve core bundle-only refusal',()=>{
 it.each(scriptTrees)('%s refuses before producing IR',(_,tree)=>{expect(refused(page(tree),'BUILD-623').message).toContain('bundle');});
 it('JSX preserves the original source position',()=>{const d=refused(page('<script>void 0;</script>'),'BUILD-623','app.tsx');expect(d.line).toBe(3);});
 it('refuses a script inside a registered island',()=>{refused(page('Panel()',"function Panel(){return h('section',null,h('script',null,'void 0;'));} activateIslands({Panel});"),'BUILD-623');});
 it('follows an imported helper',()=>{const d=refused(page('Code()',"import {Code} from './code';"),'BUILD-623','app.ts',{'code.ts':"import {h} from '@getforma/core'; export function Code(){return h('script',null,'void 0;');}"});expect(d.file).toMatch(/code\.ts$/);});
 it('checks a conditional callback even when its initial state is false',()=>{refused(page("createShow(()=>false,()=>h('script',null,'void 0;'))"),'BUILD-623');});
 it('checks a native list row',()=>{refused(page("createList(rows,r=>r.id,r=>h('script',null,'void 0;'))","const [rows]=createSignal([{id:'a'}]);"),'BUILD-623');});
});
const rawValues=["'<p>unreviewed</p>'","''","true","7","p.markup","()=>p.markup","trustedHtml('<p>reviewed browser markup</p>')","undefined"];
describe('native srcdoc has no trusted markup representation',()=>{
 it.each(rawValues)('refuses %s',value=>{const extra=value==='undefined'?"const undefined='<p>shadowed</p>';":'';expect(refused(page(`h('iframe',{srcdoc:${value}})`,extra,'p:{markup:string}'),'BUILD-624').message).toContain('trustedHtml');});
 it.each(['srcDoc','SRCDOC','SrCdOc'])('refuses case variant %s',name=>{refused(page(`h('iframe',{${name}:'<p>x</p>'})`),'BUILD-624');});
 it('does not exempt a non-iframe raw prop from the core boundary',()=>{refused(page("h('div',{srcdoc:'raw'})"),'BUILD-624');});
 it('refuses a registered reactive raw slot',()=>{refused(page("Panel({markup:'raw'})","function Panel(p:{markup:string}){return h('iframe',{srcdoc:()=>p.markup});} activateIslands({Panel});"),'BUILD-624');});
 it('JSX srcDoc is source-located',()=>{expect(refused(page('<iframe srcDoc="raw"/>'),'BUILD-624','app.tsx').line).toBe(3);});
});
describe('safe nearby native forms stay admitted',()=>{
 it.each(['null','false','undefined'])('omits proven %s in original TS',value=>{const got=emit(page(`h('iframe',{srcdoc:${value}})`));expect(got.failure).toBeUndefined();expect(got.diagnostics).toEqual([]);expect(renderDefaults(got.result!.binary,{stripMarkers:true})).toBe('<main><iframe></iframe></main>');});
 it('retains the existing strict void-expression refusal after JSX lowering',()=>{const got=emit(page('<iframe srcdoc={undefined}/>'),'app.tsx');expect(got.failure).toBeUndefined();expect(got.diagnostics.map(d=>d.code)).toEqual(['BUILD-207']);expect(got.diagnostics[0].strict).toBe(true);});
 it('preserves literal style and safe iframe bytes',()=>{const got=emit(page("h('section',null,h('style',null,'p{color:navy}'),h('iframe',{title:'safe',src:'/frame'}))"));expect(got.failure).toBeUndefined();expect(got.diagnostics).toEqual([]);expect(renderDefaults(got.result!.binary,{stripMarkers:true})).toBe('<main><section><style>p{color:navy}</style><iframe title="safe" src="/frame"></iframe></section></main>');});
 it('does not confuse user component props with an intrinsic raw sink',()=>{const got=emit(page("Child({srcdoc:'ordinary data'})","function Child(p:{srcdoc:string}){return h('p',null,p.srcdoc);}"));expect(got.failure).toBeUndefined();expect(got.diagnostics).toEqual([]);expect(renderDefaults(got.result!.binary,{stripMarkers:true})).toContain('ordinary data');});
 it('leaves a browserOnly trusted raw implementation outside native inspection',()=>{const got=emit(page('Client()',"const Client=browserOnly(()=>h('iframe',{srcdoc:trustedHtml('<p>reviewed</p>')}));activateIslands({Client});"));expect(got.failure).toBeUndefined();expect(got.diagnostics).toEqual([]);});
});
