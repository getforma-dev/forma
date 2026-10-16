import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {generateRealIr} from '../src/esbuild-ssr-plugin';
import {collectDiagnostics} from '../src/diagnostics';
import {parseOpcodeList} from './helpers/fmir';

const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const imports="import {h,mount,activateIslands,createSignal,createList,createShow,Fragment,browserOnly} from '@getforma/core';\n";
const page=(tree:string,extra='')=>imports+extra+`\nexport function Page(){return ${tree};}\nmount(()=>Page(),'#app');\n`;
const island=(tree:string,extra='',body='')=>imports+extra+`\nexport function Island(){${body}return ${tree};}\nexport function Page(){return h('main',null,Island());}\nactivateIslands({Island});mount(()=>Page(),'#app');\n`;
function emit(source:string,files:Record<string,string>={}) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'forma-html-context-')));roots.push(root);
 for(const [name,text] of Object.entries({'app.tsx':source,...files})){const path=join(root,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,text);}
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 let failure:unknown;const {result,diagnostics}=collectDiagnostics(()=>{try{return generateRealIr(join(root,'app.tsx'));}catch(error){failure=error;return null;}});
 return {result,diagnostics,failure};
}
const repaired:[string,string][]=[
 ['block in p',"h('p',null,h('div',null,'block'))"],
 ['nested anchor',"h('a',null,h('span',null,h('a',{href:'/x'},'link')))"],
 ['nested form',"h('form',null,h('section',null,h('form',null,'nested')))"],
 ['li closing ancestor',"h('ul',null,h('li',null,'one',h('li',null,'two')))"],
 ['dt closing dd',"h('dl',null,h('dd',null,'one',h('dt',null,'two')))"],
 ['dd closing dt',"h('dl',null,h('dt',null,'one',h('dd',null,'two')))"],
 ['option outside select',"h('div',null,h('option',{value:'a'},'A'))"],
 ['option closes option',"h('select',null,h('option',null,'A',h('option',null,'B')))"],
 ['optgroup closes option',"h('select',null,h('option',null,'A',h('optgroup',{label:'G'},h('option',null,'B'))))"],
 ['optgroup closes optgroup',"h('select',null,h('optgroup',{label:'A'},h('optgroup',{label:'B'},h('option',null,'B'))))"],
 ['button inside anchor',"h('a',{href:'/x'},h('span',null,h('button',null,'go')))"],
 ['input inside button',"h('button',null,h('input',{type:'text'}))"],
 ['nested button',"h('button',null,h('button',null,'go'))"],
 ['interactive label extra',"h('label',null,h('input',{id:'x'}),h('a',{href:'/x'},'other'))"],
 ['two label controls',"h('label',null,h('input',{id:'x'}),h('input',{id:'y'}))"],
 ['wrong explicit labelled control',"h('label',{htmlFor:'x'},h('input',{id:'y'}))"],
];
const near:[string,string][]=[
 ['phrasing p',"h('p',null,'text',h('span',null,'inline'))"],
 ['sibling anchors',"h('div',null,h('a',{href:'/a'},'A'),h('a',{href:'/b'},'B'))"],
 ['sibling forms',"h('div',null,h('form',null,'A'),h('form',null,'B'))"],
 ['nested list',"h('ul',null,h('li',null,'A',h('ul',null,h('li',null,'B'))))"],
 ['definition siblings',"h('dl',null,h('dt',null,'A'),h('dd',null,'B'))"],
 ['option siblings',"h('select',null,h('option',{value:'a'},'A'),h('optgroup',{label:'G'},h('option',{value:'b'},'B')))"],
 ['anchor phrasing',"h('a',{href:'/x'},h('span',null,'go'))"],
 ['button noninteractive link',"h('button',null,h('a',null,'anchor name'))"],
 ['button hidden input',"h('button',null,h('input',{type:'hidden',value:'x'}))"],
 ['label implicit control',"h('label',null,h('span',null,'Name'),h('input',{id:'x'}))"],
 ['label explicit control',"h('label',{htmlFor:'x'},h('input',{id:'x'}))"],
 ['label sibling control',"h('div',null,h('label',{htmlFor:'x'},'Name'),h('input',{id:'x'}))"],
 ['static style',"h('section',null,h('style',null,'.x{color:red}'))"],
 ['static script',"h('section',null,h('script',null,'void 0;'))"],
 ['SVG title',"h('svg',null,h('title',null,'Chart'),h('circle',{r:2}))"],
];
const rootsBad:[string,string,string?,string?][]=[
 ['multiple Fragment','<><b>one</b><i>two</i></>'], ['text',"'text'"], ['empty','null'], ['empty Fragment','<></>'],
 ['root Show',"createShow(()=>true,()=>h('b',null,'one'),()=>h('i',null,'two'))"],
 ['root List',"createList(rows,r=>r.id,r=>h('b',null,r.label))","const [rows]=createSignal([{id:'a',label:'A'},{id:'b',label:'B'}]);"],
 ['root conditional',"true?h('b',null,'one'):h('i',null,'two')"],
 ['helper control root','Helper()',"function Helper(){return createShow(()=>true,()=>h('b',null,'one'),()=>h('i',null,'two'));}"],
 ['helper multiple root','Helper()',"function Helper(){return <><b>one</b><i>two</i></>;}"],
];
const rootsGood:[string,string,string?,string?][]=[
 ['direct Element',"h('section',null,'one')"],
 ['one Fragment','<><section>one</section></>'],
 ['named JSX Fragment','<Fragment><section>one</section></Fragment>'],
 ['transparent h Fragment',"h(Fragment,null,h('section',null,'one'))"],
 ['resolved helper','Helper()',"function Helper(){return h('section',null,'one');}"],
 ['interior Show',"h('section',null,createShow(()=>true,()=>h('b',null,'one'),()=>h('i',null,'two')))"],
 ['interior List',"h('section',null,createList(rows,r=>r.id,r=>h('b',null,r.label)))","const [rows]=createSignal([{id:'a',label:'A'},{id:'b',label:'B'}]);"],
];
describe('finite HTML context admission',()=>{
 it.each(repaired)('%s refuses with618 and a source location',(name,tree)=>{const got=emit(page(tree));expect(got.result,name).toBeNull();expect(got.failure).toMatchObject({code:'BUILD-618'});const d=got.diagnostics.find(d=>d.code==='BUILD-618');expect(d?.line).toBeGreaterThan(0);expect(d?.column).toBeGreaterThan(0);});
 it.each(near)('%s remains admitted',(name,tree)=>{const got=emit(page(tree));expect(got.failure,name).toBeUndefined();expect(got.diagnostics).toEqual([]);expect(got.result!.binary.length).toBeGreaterThan(0);});
 it('carries ancestry through an imported helper',()=>{const got=emit(page("h('p',null,Block())","import {Block} from './block';"),{'block.ts':imports+"export function Block(){return h('div',null,'block');}"});expect(got.failure).toMatchObject({code:'BUILD-618'});expect(got.diagnostics.find(d=>d.code==='BUILD-618')?.file).toMatch(/block\.ts$/);});
 it.each(["h('main',null,h('title',null,'Page'))","h('svg',null,h('foreignObject',null,h('title',null,'Page')))"])('refuses component HTML title %s',tree=>{const got=emit(page(tree));expect(got.failure).toMatchObject({code:'BUILD-619'});expect(got.diagnostics.find(d=>d.code==='BUILD-619')?.fix).toContain('render');});
 it.each(['style','script'])('refuses reactive %s content',tag=>{const got=emit(island(`h('section',null,h('${tag}',null,text))`,'',"const [text]=createSignal('safe');"));expect(got.failure).toMatchObject({code:'BUILD-620'});});
});
describe('SSR registered island owned roots',()=>{
 it.each(rootsBad)('%s refuses with621',(name,tree,extra,body)=>{const got=emit(island(tree,extra,body));expect(got.result,name).toBeNull();expect(got.failure).toMatchObject({code:'BUILD-621'});expect(got.diagnostics.find(d=>d.code==='BUILD-621')?.line).toBeGreaterThan(0);});
 it.each(rootsGood)('%s has one native owned root',(name,tree,extra,body)=>{const got=emit(island(tree,extra,body));expect(got.failure,name).toBeUndefined();expect(got.diagnostics).toEqual([]);expect(parseOpcodeList(got.result!.binary).join('\n')).toContain('OPEN_TAG section');});
 it('refuses a root owned by another registered island',()=>{const got=emit(island('Child()',"function Child(){return h('section',null,'child');}").replace('activateIslands({Island})','activateIslands({Island,Child})'));expect(got.failure).toMatchObject({code:'BUILD-621'});});
 it('keeps browserOnly client roots outside the SSR proof',()=>{const got=emit(page("h('main',null,Client())","const Client=browserOnly(()=> <><b>one</b><i>two</i></>);activateIslands({Client});"));expect(got.failure).toBeUndefined();expect(got.diagnostics).toEqual([]);});
});

it('preserves every archived source/product hash and canonical admitted near miss',()=>{
 const archive=join(__dirname,'../../..','docs/archive/FORMA-139-html-context');
 const manifest=JSON.parse(readFileSync(join(archive,'manifest.json'),'utf8'));
 for(const [file,hash] of Object.entries(manifest.files))expect(createHash('sha256').update(readFileSync(join(archive,file))).digest('hex'),file).toBe(hash);
 for(const [name,tree] of near){const original=manifest.cases.find((item:any)=>item.name===name);expect(original.sha256,name).not.toBeNull();const got=emit(page(tree));expect(got.failure).toBeUndefined();expect(createHash('sha256').update(got.result!.binary).digest('hex'),name).toBe(original.sha256);}
});

it.each(['address','article','aside','blockquote','details','div','dl','fieldset','footer','form','h1','h6','header','hr','main','menu','nav','ol','p','pre','section','table','ul'])('p closing tag %s is source-located',tag=>{expect(emit(page(`h('p',null,h('${tag}',null,'block'))`)).failure).toMatchObject({code:'BUILD-618'});});
it('valid conditional label controls are mutually exclusive',()=>{const got=emit(page("h('label',null,createShow(()=>true,()=>h('input',{id:'a'}),()=>h('input',{id:'b'})))"));expect(got.failure).toBeUndefined();expect(got.diagnostics).toEqual([]);});
it('a list cannot give one outer label repeated controls',()=>{const got=emit(page("h('label',null,createList(rows,r=>r.id,r=>h('input',{value:r.id})))","const [rows]=createSignal([{id:'a'},{id:'b'}]);"));expect(got.failure).toMatchObject({code:'BUILD-618'});});
it('labels inside list rows each own their one control',()=>{const got=emit(page("h('div',null,createList(rows,r=>r.id,r=>h('label',null,h('input',{value:r.id}))))","const [rows]=createSignal([{id:'a'},{id:'b'}]);"));expect(got.failure).toBeUndefined();expect(got.diagnostics).toEqual([]);});
it('a browserOnly server host still obeys its surrounding parser context',()=>{const got=emit(page("h('p',null,Client())","const Client=browserOnly(()=>h('div',null,'client'));activateIslands({Client});"));expect(got.failure).toMatchObject({code:'BUILD-618'});});
it('proves a single Fragment through a relative barrel helper',()=>{const got=emit(island('Helper()',"import {Helper} from './barrel';"),{'barrel.ts':"export {Helper} from './helper';",'helper.tsx':imports+"export function Helper(){return <><section>one</section></>;}"});expect(got.failure).toBeUndefined();expect(got.diagnostics).toEqual([]);});
it('refuses the multiple roots of an imported helper',()=>{const got=emit(island('Helper()',"import {Helper} from './barrel';"),{'barrel.ts':"export {Helper} from './helper';",'helper.tsx':imports+"export function Helper(){return <><b>one</b><i>two</i></>;}"});expect(got.failure).toMatchObject({code:'BUILD-621'});});
it.each(['style','script'])('does not admit a constant-returning reactive %s reader',tag=>{expect(emit(page(`h('${tag}',null,()=> 'authored')`)).failure).toMatchObject({code:'BUILD-620'});});
it('refuses reactive parser repair even when its initial branch is empty',()=>{expect(emit(page("h('p',null,createShow(()=>false,()=>h('div',null,'block'),()=>null))")).failure).toMatchObject({code:'BUILD-618'});});
it('allows ordinary fragment ranges inside an owned island host',()=>{const got=emit(island("h('section',null,h(Fragment,null,h('b',null,'one'),h('i',null,'two')))"));expect(got.failure).toBeUndefined();expect(got.diagnostics).toEqual([]);});

it.each(["CSS",'`literal template`'])('rejects raw-text %s that would enter the dynamic opcode path',child=>{expect(emit(page(`h('style',null,${child})`,"const CSS='.x{color:red}';")).failure).toMatchObject({code:'BUILD-620'});});

it('HTML hidden input type comparison ignores case',()=>{const got=emit(page("h('button',null,h('INPUT',{type:'HIDDEN'}))"));expect(got.failure).toBeUndefined();expect(got.diagnostics).toEqual([]);});
it.each(['','div x','café'])('an invalid native tag %s cannot prove an owned island root',tag=>{expect(emit(island(`h(${JSON.stringify(tag)},null,'content')`)).failure).toMatchObject({code:'BUILD-621'});});

it('unknown annotation encoding cannot hide a possible HTML title',()=>{const got=emit(page("h('math',null,h('annotation-xml',{encoding:()=> 'text/html'},h('title',null,'Page')))"));expect(got.failure).toMatchObject({code:'BUILD-619'});});

it.each(["Fragment()","h(Fragment,null)"])('a local Fragment namesake %s cannot prove native ownership',tree=>{const source=island(tree,"function Fragment(){return h('section',null,'helper');}").replace(',Fragment,browserOnly',',browserOnly');expect(emit(source).failure).toMatchObject({code:'BUILD-621'});});
