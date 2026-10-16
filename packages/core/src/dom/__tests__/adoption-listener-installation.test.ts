import {describe,it,expect,vi} from 'vitest';
import {prepareAdoption} from '../adoption.js';
import {h} from '../element.js';

describe('physical listener ownership during installation',()=>{
  it.each(['dispose-before','dispose-after','dispose-before-throw','dispose-after-throw','throw-after-second','dispose-live'] as const)('removes every installed native callback after %s',mode=>{
    const doc=document.implementation.createHTMLDocument();
    doc.body.innerHTML='<section><button>one</button><button>two</button></section>';
    const host=doc.body.firstElementChild!,buttons=Array.from(host.children),outside=vi.fn(),owned=vi.fn(),entered=vi.fn();
    let plan:ReturnType<typeof prepareAdoption>;
    const spies=buttons.map((button,index)=>{
      button.addEventListener('click',outside);
      const add=button.addEventListener.bind(button),remove=button.removeEventListener.bind(button);
      const wrappers=new Map<EventListenerOrEventListenerObject,EventListener>();
      // Observe entry into the physically installed callback, even when the
      // framework callback has become inert after its owner was revoked.
      const addSpy=vi.spyOn(button,'addEventListener').mockImplementation((type,listener,options)=>{
        if(!listener)return add(type,listener,options);
        const wrapper:EventListener=function(this:EventTarget,event){entered(index);if(typeof listener==='function')listener.call(this,event);else listener.handleEvent(event);};
        wrappers.set(listener,wrapper);
        if(index===0&&(mode==='dispose-before'||mode==='dispose-before-throw'))plan.dispose();
        add(type,wrapper,options);
        if(index===0&&(mode==='dispose-after'||mode==='dispose-after-throw'))plan.dispose();
        if(index===0&&(mode==='dispose-before-throw'||mode==='dispose-after-throw'))throw Error('install failed after attachment');
        if(index===1&&mode==='throw-after-second')throw Error('install failed after attachment');
      });
      const removeSpy=vi.spyOn(button,'removeEventListener').mockImplementation((type,listener,options)=>remove(type,listener?wrappers.get(listener)??listener:listener,options));
      return [addSpy,removeSpy];
    });
    try{
      plan=prepareAdoption(host,()=>h('section',null,h('button',{onClick:owned},'one'),h('button',{onClick:owned},'two')));
      if(mode==='dispose-live'){
        plan.commit();for(const button of buttons)button.dispatchEvent(new Event('click'));
        expect(entered).toHaveBeenCalledTimes(2);expect(owned).toHaveBeenCalledTimes(2);plan.dispose();
        entered.mockClear();owned.mockClear();outside.mockClear();
      }else expect(()=>plan.commit()).toThrow(mode==='throw-after-second'||mode.endsWith('-throw')?'install failed after attachment':'FORMA_E_HYDRATE_STRUCTURE');
      expect(plan.phase).toBe('aborted');
      for(const button of buttons)button.dispatchEvent(new Event('click'));
      expect(entered.mock.calls).toEqual([]);expect(owned).not.toHaveBeenCalled();expect(outside).toHaveBeenCalledTimes(2);
    }finally{for(const pair of spies)for(const spy of pair)spy.mockRestore();}
  });
});
