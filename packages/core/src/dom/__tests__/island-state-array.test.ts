import {describe,expect,it} from 'vitest';
import {__islandRegistration,preflightIslands,type IslandSchemaType} from '../island-state.js';

const hash='0123456789abcdef';
function fixture(element:IslandSchemaType,value:unknown,text?:string) {
  const doc=document.implementation.createHTMLDocument('array projection');
  const block=doc.createElement('script');block.type='application/json';block.setAttribute('data-island-state','');
  block.textContent=text??JSON.stringify({v:1,s:[],i:[{h:hash,p:{value}}]});doc.head.appendChild(block);
  doc.body.innerHTML=`<div data-forma-island="0" data-forma-state="0" data-forma-component="Array" data-forma-h="${hash}"></div>`;
  const Array=__islandRegistration(()=>{}, {h:hash,mode:0,schema:[[{name:'value',type:{kind:'array',element}}]]});
  return {doc,read:()=>preflightIslands({Array},doc)[0]!};
}
function value(result:ReturnType<ReturnType<typeof fixture>['read']>):unknown[] {
  if('error' in result)throw result.error;
  return result.value.props.value as unknown[];
}
function code(result:ReturnType<ReturnType<typeof fixture>['read']>):string {
  expect('error' in result).toBe(true);return 'error'in result?result.error.code:'';
}
describe('bounded primitive array projection',()=>{
  const vectors:{element:IslandSchemaType;input:unknown[];expected?:unknown[]}[]=[
    {element:{kind:'string'},input:['','é😀','\0','</script>']},
    {element:{kind:'boolean'},input:[false,true,false]},
    {element:{kind:'number'},input:[0,Number.MIN_VALUE,Number.MAX_VALUE,2**53-1,2**53]},
    {element:{kind:'enum',variants:['','é😀']},input:['é😀','']},
    {element:{kind:'date'},input:[0,-8.64e15,8.64e15],expected:[new Date(0),new Date(-8.64e15),new Date(8.64e15)]},
  ];
  for(const vector of vectors)it(`retains every ${vector.element.kind} value and fresh array ownership`,()=>{
    const f=fixture(vector.element,vector.input),first=value(f.read());
    expect(first).toEqual(vector.expected??vector.input);
    if(first[0] instanceof Date)first[0].setTime(1);
    first[0]='changed';first.push('extra');
    const second=value(f.read());expect(second).toEqual(vector.expected??vector.input);expect(second).not.toBe(first);
  });
  for(const vector of vectors)it(`retains empty ${vector.element.kind} arrays`,()=>{
    expect(value(fixture(vector.element,[]).read())).toEqual([]);
  });
  it('refuses wrong scalar element types at either end without exposing a partial array',()=>{
    for(const [element,good,bad] of [
      [{kind:'string'},'ok',1],[{kind:'boolean'},true,'true'],[{kind:'number'},7,'7'],
      [{kind:'enum',variants:['ok']},'ok','other'],[{kind:'date'},0,'1970-01-01'],
    ] as const)for(const input of [[bad,good],[good,bad]]) {
      const f=fixture(element,input);expect(code(f.read())).toBe('FORMA_E_ISLAND_SCHEMA');
      expect(f.doc.querySelector('[data-forma-island]')!.getAttribute('data-forma-status')).toBeNull();
    }
    const source=JSON.stringify({v:1,s:[],i:[{h:hash,p:{value:['nonfinite']}}]}).replace('"nonfinite"','1e400');
    expect(code(fixture({kind:'number'},[],source).read())).toBe('FORMA_E_ISLAND_SCHEMA');
  });
  it('keeps null/optional and nested array positions on the general projection path',()=>{
    for(const kind of ['string','boolean','number'] as const) {
      const scalar=kind==='string'?'é😀':kind==='boolean'?false:0;
      expect(value(fixture({kind:'optional',inner:{kind}},[null,scalar,null]).read())).toEqual([null,scalar,null]);
      expect(code(fixture({kind},[null]).read())).toBe('FORMA_E_ISLAND_SCHEMA');
    }
    const f=fixture({kind:'array',element:{kind:'string'}},[['one'],[],['é😀']]);
    const first=value(f.read()) as string[][];first[0]!.push('mutated');first[2]![0]='changed';
    expect(value(f.read())).toEqual([['one'],[],['é😀']]);
  });
  it('admits the largest dense string array in the byte budget, and refuses one additional encoded byte',()=>{
    const encode=(value:unknown)=>JSON.stringify({v:1,s:[],i:[{h:hash,p:{value}}]});
    const count=Math.floor((1_048_576-encode([]).length+1)/3);
    const input=Array.from({length:count},()=>''),json=encode(input),text=json+' '.repeat(1_048_576-json.length);
    const f=fixture({kind:'string'},input,text),actual=value(f.read());
    expect(actual).toHaveLength(count);expect(actual.every(item=>item==='')).toBe(true);
    expect(code(fixture({kind:'string'},input,text+' ').read())).toBe('FORMA_E_ISLAND_STATE');
  });
  it('keeps the UTF-8 bound distinct from JavaScript length for multibyte arrays',()=>{
    const text=JSON.stringify({v:1,s:[],i:[{h:hash,p:{value:['é😀'.repeat(175_000)]}}]});
    expect(text.length).toBeLessThan(1_048_576);expect(new TextEncoder().encode(text).length).toBeGreaterThan(1_048_576);
    expect(code(fixture({kind:'string'},[],text).read())).toBe('FORMA_E_ISLAND_STATE');
  });
});
