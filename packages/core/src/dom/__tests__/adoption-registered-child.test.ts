import{describe,it,expect,vi}from'vitest';
import{prepareAdoption}from'../adoption.js';
import{h}from'../element.js';
import{__adoptionChild}from'../adoption-description.js';
import{__islandRegistration,preflightIslands,type ValidatedIsland,type IslandSchema}from'../island-state.js';
const H='0123456789abcdef',J='fedcba9876543210',schema:IslandSchema=[[{name:'count',type:{kind:'number'}}]];
function fixture(Child:(props:Record<string,unknown>)=>unknown,{second=false,bad=false}={}){
 const doc=document.implementation.createHTMLDocument();doc.body.innerHTML=`<main><!--f:i0--><button data-forma-island="0" data-forma-state="0" data-forma-component="A" data-forma-h="${H}">one</button><!--/f:i0-->${second?`<!--f:i1--><button data-forma-island="1" data-forma-state="1" data-forma-component="B" data-forma-h="${J}">two</button><!--/f:i1-->`:''}${bad?'<i>wrong</i>':''}</main>`;
 const state=doc.createElement('script');state.type='application/json';state.setAttribute('data-island-state','');state.textContent=JSON.stringify({v:1,s:[],i:[{h:H,p:{count:1}},...(second?[{h:J,p:{count:2}}]:[])]});doc.head.append(state);
 const registry={A:__islandRegistration(Child,{h:H,schema,mode:0}),...(second?{B:__islandRegistration(Child,{h:J,schema,mode:0})}:{})};
 const checked=preflightIslands(registry,doc);const children=new Map<Element,ValidatedIsland>();for(const result of checked){if('error'in result)throw result.error;children.set(result.host,result.value);}
 return{doc,host:doc.body.firstElementChild!,children,checked:[...children.values()]};
}
describe('prepared per-host registered children',()=>{
 it('matches each registration of the same component separately and never executes children in the parent',async()=>{
  const Child=vi.fn((p:Record<string,unknown>)=>h('button',null,p.count)),f=fixture(Child,{second:true}),before=f.host.outerHTML,records:MutationRecord[]=[];
  const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(f.host,{subtree:true,attributes:true,childList:true,characterData:true});
  const plan=prepareAdoption(f.host,()=>h('main',null,__adoptionChild(undefined,Child,[{count:1}]),h(Child,{count:2})),{children:f.children});plan.commit();await new Promise(resolve=>setTimeout(resolve,0));
  expect(Child).not.toHaveBeenCalled();expect(f.host.outerHTML).toBe(before);expect(records.concat(observer.takeRecords())).toEqual([]);plan.dispose();observer.disconnect();
 });
 it('executes a genuine unregistered wrapping helper once before matching its child',()=>{
  const Child=vi.fn((p:Record<string,unknown>)=>h('button',null,p.count)),f=fixture(Child),Helper=vi.fn(()=>h(Child,{count:1}));
  const plan=prepareAdoption(f.host,()=>h('main',null,h(Helper)),{children:f.children});plan.commit();expect(Helper).toHaveBeenCalledOnce();expect(Child).not.toHaveBeenCalled();plan.dispose();
 });
 it('refuses missing or mismatched checked hosts before registered code executes',()=>{
  const Child=vi.fn((p:Record<string,unknown>)=>h('button',null,p.count)),f=fixture(Child),other=fixture(Child),target=f.checked[0]!.host;
  for(const children of [undefined,new Map([[target,other.checked[0]!]])])expect(()=>prepareAdoption(f.host,()=>h('main',null,h(Child,{count:1})),{children})).toThrow('FORMA_E_HYDRATE_STRUCTURE');
  expect(Child).not.toHaveBeenCalled();expect(target.textContent).toBe('one');
 });
 it('checks retained original props and final shell identity rather than mutated projected values',()=>{
  const Child=vi.fn((p:Record<string,unknown>)=>h('button',null,p.count)),f=fixture(Child);f.checked[0]!.props.count=99;
  const plan=prepareAdoption(f.host,()=>h('main',null,h(Child,{count:1})),{children:f.children});f.checked[0]!.host.setAttribute('data-forma-island','changed');expect(()=>plan.commit()).toThrow('FORMA_E_HYDRATE_VALUE');expect(Child).not.toHaveBeenCalled();
  const g=fixture(Child);g.checked[0]!.props.count=99;expect(()=>prepareAdoption(g.host,()=>h('main',null,h(Child,{count:99})),{children:g.children})).toThrow('FORMA_E_HYDRATE_VALUE');
 });
 it('leaves child execution independently owned after parent disposal and never runs it during a parent refusal',()=>{
  const Child=vi.fn((_p:Record<string,unknown>)=>h('button',null,'one')),f=fixture(Child),parent=prepareAdoption(f.host,()=>h('main',null,h(Child,{count:1})),{children:f.children});parent.commit();parent.dispose();expect(Child).not.toHaveBeenCalled();
  const child=f.checked[0]!,childPlan=prepareAdoption(child.host,()=>child.registration.hydrate(child.host,child.props));childPlan.commit();expect(Child).toHaveBeenCalledOnce();childPlan.dispose();
  const bad=fixture(Child,{bad:true});expect(()=>prepareAdoption(bad.host,()=>h('main',null,h(Child,{count:1}),h('i',null,'expected')),{children:bad.children})).toThrow('FORMA_E_HYDRATE_VALUE');expect(Child).toHaveBeenCalledOnce();
 });
 it('does not borrow another host or execute an unmatched registered function',()=>{
  const Child=vi.fn((p:Record<string,unknown>)=>h('button',null,p.count)),Other=vi.fn((p:Record<string,unknown>)=>h('button',null,p.count)),f=fixture(Child);__islandRegistration(Other,{h:H,schema,mode:0});
  expect(()=>prepareAdoption(f.host,()=>h('main',null,h(Other,{count:1})),{children:f.children})).toThrow('FORMA_E_HYDRATE_STRUCTURE');expect(Other).not.toHaveBeenCalled();expect(Child).not.toHaveBeenCalled();
 });
});
