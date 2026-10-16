import {describe,expect,it} from 'vitest';
import {h} from '../element.js';
import {prepareAdoption} from '../adoption.js';
import {createSignal} from '../../reactive/signal.js';
import {createRoot} from '../../reactive/root.js';
import {readVectors} from './value-rule-vectors.js';
const table=readVectors<{aliases:{prop:string;attribute:string}[];unchanged:string[]}>('attribute-aliases.json');
const HTML='http://www.w3.org/1999/xhtml',SVG='http://www.w3.org/2000/svg';
describe('attribute aliases share one policy across creation and adoption',()=>{
  for(const tag of ['label','svg'])for(const {prop,attribute} of [...table.aliases,...table.unchanged.map(prop=>({prop,attribute:prop}))]) {
    it(`${tag} ${prop}: static, reactive and adopted writes agree`,async()=>{
      const qualified=tag==='label'?attribute.toLowerCase():attribute;
      const assert=(element:Element,value:string|null)=>{
        expect(element.getAttribute(qualified)).toBe(value);
        expect([...element.attributes].map(attr=>attr.name)).toEqual(value===null?[]:[qualified]);
      };
      assert(h(tag,{[prop]:'initial'}),'initial');
      assert(h(tag,{[prop]:false}),null);assert(h(tag,{[prop]:null}),null);
      createRoot(()=>{
        const [value,set]=createSignal<string|null>('initial'),element=h(tag,{[prop]:value});
        assert(element,'initial');set('later');assert(element,'later');set(null);assert(element,null);
      });
      const doc=document.implementation.createHTMLDocument(),target=doc.createElementNS(tag==='label'?HTML:SVG,tag);
      doc.body.appendChild(target);target.setAttribute(qualified,'initial');
      const records:MutationRecord[]=[],observer=new MutationObserver(batch=>records.push(...batch));
      observer.observe(target,{attributes:true});
      const [value,set]=createSignal<string|null>('initial');
      const plan=prepareAdoption(target,()=>h(tag,{[prop]:value}));plan.commit();
      await new Promise(resolve=>setTimeout(resolve,0));records.push(...observer.takeRecords());
      expect(records).toEqual([]);assert(target,'initial');
      set('later');assert(target,'later');set(null);assert(target,null);
      expect(observer.takeRecords().length).toBeGreaterThan(0);observer.disconnect();plan.dispose();
    });
  }
  it('ordinary browser h retains object property order for competing aliases',()=>{
    for(const {prop,attribute} of table.aliases) {
      expect(h('label',{[prop]:'first',[attribute]:'last'}).getAttribute(attribute)).toBe('last');
      expect(h('label',{[attribute]:'first',[prop]:'last'}).getAttribute(attribute)).toBe('last');
    }
  });
});
