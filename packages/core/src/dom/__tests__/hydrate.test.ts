/** Strict adoption replacements for the archived repairing-helper tests. */
import { emptyRegistry, installState, useFreshDocument } from './helpers/compiled-island.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { adoptInRoot } from './helpers/owned-adoption.js';
import { connect, fixture, prepareAndCommit, expectRefusal } from './helpers/prepared-fixture';
import { activateIslands } from '../activate';
import { hydrateIsland } from '../hydrate';
import { withAdoptionDescription, describingAdoption, type HydrationDescriptor, type ShowDescriptor } from '../adoption-description';
import { AdoptionDom } from '../adoption-plan';
import { h } from '../element';
import { createShow } from '../show';

describe('barrel exports', () => {
  it('exports hydrateIsland from dom/index', async () => { expect(typeof (await import('../index')).hydrateIsland).toBe('function'); });
  it.each(['hydrating','setHydrating','isDescriptor','isShowDescriptor','collectMarkers','applyDynamicProps','descriptorToElement','adoptNode'])('retires the private repairing helper %s', async key => { expect(await import('../hydrate')).not.toHaveProperty(key); });
});

describe('private description scope', () => {
  it('defaults to ordinary DOM and restores nested description state even after an exception', () => {
    expect(describingAdoption).toBe(false); expect(h('div')).toBeInstanceOf(Element);
    withAdoptionDescription(() => {
      expect(describingAdoption).toBe(true);
      expect(withAdoptionDescription(() => h('div'), false)).toBeInstanceOf(Element);
      expect(describingAdoption).toBe(true);
      expect(() => withAdoptionDescription(() => { throw Error('original'); })).toThrow('original');
      expect(describingAdoption).toBe(true);
    });
    expect(describingAdoption).toBe(false);
  });
  it('returns a descriptor with the exact original props and lazy children', () => {
    const getter=vi.fn(()=>'dynamic');
    const result=withAdoptionDescription(()=>h('div',{class:'card'},'text',getter)) as unknown as HydrationDescriptor;
    expect(result).toEqual({type:'element',tag:'div',props:{class:'card'},children:['text',getter]});
    expect(result).not.toBeInstanceOf(Element);expect(getter).not.toHaveBeenCalled();
  });
  it('builds nested descriptor tree during hydration', () => {
    const result=withAdoptionDescription(()=>h('div',null,h('span',{class:'inner'},'Nested'),h('p',null,'Para'))) as unknown as HydrationDescriptor;
    expect(result.children).toEqual([{type:'element',tag:'span',props:{class:'inner'},children:['Nested']},{type:'element',tag:'p',props:null,children:['Para']}]);
  });
  it('preserves function children in descriptor',()=>{
    const getter=()=> 'dynamic',desc=withAdoptionDescription(()=>h('div',null,getter)) as unknown as HydrationDescriptor;
    expect(desc.children).toEqual([getter]);expect(desc.children[0]).toBe(getter);
  });
  it.each([true,false])('describes Show thunks lazily for condition=%s',value=>{
    const condition=vi.fn(()=>value),yes=vi.fn(()=>h('span',null,'yes')),no=vi.fn(()=>h('div',null,'no'));
    const result=withAdoptionDescription(()=>createShow(condition,yes,no)) as unknown as ShowDescriptor;
    expect(result).toEqual({type:'show',condition,whenTrue:yes,whenFalse:no});expect(condition).not.toHaveBeenCalled();expect(yes).not.toHaveBeenCalled();expect(no).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('initialBranch');
  });
  it('does not invent an initial branch when no else factory exists',()=>{
    const desc=withAdoptionDescription(()=>createShow(()=>false,()=>h('span',null,'yes'))) as unknown as ShowDescriptor;
    expect(desc.type).toBe('show');expect(desc).not.toHaveProperty('initialBranch');
    const root=fixture('<div><!--f:s0--><!--/f:s0--></div>');prepareAndCommit(root,()=>h('div',null,desc));expect(root.childNodes).toHaveLength(2);
  });
  it('returns a DocumentFragment when not describing',()=>{createRoot(dispose=>{try{expect(createShow(()=>true,()=>h('span'))).toBeInstanceOf(DocumentFragment);}finally{dispose();}});});
});

describe('strict original marker ranges',()=>{
  it.each([
    ['single text','<!--f:t0-->Hello<!--/f:t0--><!--other-->',['t']],
    ['multiple text','<!--f:t0-->First<!--/f:t0--><!--f:t1-->Second<!--/f:t1-->',['t','t']],
    ['show','<!--f:s0--><span>content</span><!--/f:s0-->',['s']],
    ['interleaved','<!--f:t0-->Name<!--/f:t0--><!--f:s0--><b>visible</b><!--/f:s0--><!--f:t1-->Age<!--/f:t1-->',['t','s','t']],
    ['plain HTML','<p>Just plain HTML</p>',[]],
    ['multiple show','<!--f:s0-->A<!--/f:s0--><!--f:s1-->B<!--/f:s1-->',['s','s']],
  ] as const)('collects %s without global marker counters',(_name,html,kinds)=>{
    const root=fixture('<div>'+html+'</div>'),dom=new AdoptionDom(root);dom.children();
    const ranges=Array.from(root.childNodes).map(node=>dom.rangeAt(node)).filter(range=>range!==undefined);
    expect(ranges.map(range=>range.kind)).toEqual(kinds);
    for(const range of ranges){expect(range.start.parentNode).toBe(root);expect(range.end.parentNode).toBe(root);expect(range.end.data).toBe('/'+range.start.data);}
    dom.release();
  });
  it.each(['<!--f:t0--><span>not text</span><!--/f:t0-->','<!--f:s0--><span>orphan</span>','<!--f:t0--><!--/f:t0-->'])('refuses malformed original marker structure: %s',html=>{
    const root=fixture('<div>'+html+'</div>');expectRefusal(root,()=>h('div',null),'FORMA_E_HYDRATE_MARKER');
  });
  it('ignores an authored comment that only shares a marker prefix',()=>{
    const root=fixture('<div><!--f:side note--><!--f:t--><!--f:l--><!--f:i--><!--/f:s--><!--f:s0--><span>x</span><!--/f:s0--></div>');
    prepareAndCommit(root,()=>h('div',null,createShow(()=>true,()=>h('span',null,'x'))));expect(root.querySelector('span')!.textContent).toBe('x');
  });
  it('adopts a show region even when an authored comment precedes it',()=>{
    const root=fixture('<div><!--f:side note--><!--f:s0--><p class="content">Hi</p><!--/f:s0--></div>'),[show,setShow]=createSignal(true),comment=root.firstChild;
    prepareAndCommit(root,()=>h('div',null,createShow(show,()=>h('p',{class:'content'},'Hi'),()=>h('p',{class:'fallback'},'Bye'))));
    setShow(false);expect(root.querySelector('p.fallback')!.textContent).toBe('Bye');expect(root.firstChild).toBe(comment);expect(root.querySelector('p.content')).toBeNull();
  });
});

describe('strict prepared dynamic props',()=>{
  it('attaches event handlers via addEventListener only at commit',()=>{
    const el=fixture('<button>Click me</button>') as HTMLButtonElement,handler=vi.fn();
    prepareAndCommit(el,()=>h('button',{onClick:handler},'Click me'));el.click();expect(handler).toHaveBeenCalledOnce();
  });
  it('attaches multiple event handlers',()=>{
    const el=fixture('<input>') as HTMLInputElement,click=vi.fn(),focus=vi.fn();prepareAndCommit(el,()=>h('input',{onClick:click,onFocus:focus}));el.click();el.dispatchEvent(new Event('focus'));expect(click).toHaveBeenCalledOnce();expect(focus).toHaveBeenCalledOnce();
  });
  it('validates static props instead of silently ignoring a mismatch',()=>{
    const el=fixture('<div class="original"></div>');expectRefusal(el,()=>h('div',{class:'should-not-change',id:'myid','data-x':42}),'FORMA_E_HYDRATE_VALUE');
  });
  it('creates reactive attribute bindings without rewriting matching initial values',()=>{
    const el=fixture('<div data-state="initial"></div>'),[value,setValue]=createSignal('initial');prepareAndCommit(el,()=>h('div',{'data-state':value}));expect(el.getAttribute('data-state')).toBe('initial');setValue('updated');expect(el.getAttribute('data-state')).toBe('updated');
  });
  it('removes attribute when reactive value returns false',()=>{
    const el=fixture('<div hidden></div>'),[hidden,setHidden]=createSignal(true);prepareAndCommit(el,()=>h('div',{hidden}));setHidden(false);expect(el.hasAttribute('hidden')).toBe(false);
  });
  it('removes attribute when reactive value returns null',()=>{
    const el=fixture('<div title="hello"></div>'),[title,setTitle]=createSignal<string|null>('hello');prepareAndCommit(el,()=>h('div',{title}));setTitle(null);expect(el.hasAttribute('title')).toBe(false);
  });
  it('sets empty attribute when reactive value returns true',()=>{
    const el=fixture('<button></button>'),[disabled,setDisabled]=createSignal(false);prepareAndCommit(el,()=>h('button',{disabled}));setDisabled(true);expect(el.getAttribute('disabled')).toBe('');
  });
  it('handles null props gracefully',()=>{const el=fixture('<div></div>');prepareAndCommit(el,()=>h('div',null));expect(el.attributes.length).toBe(0);});
  it('maps className/htmlFor/tabIndex to their HTML attribute names',()=>{
    const el=fixture('<label class="a" for="field" tabindex="3"></label>'),[cls,setCls]=createSignal('a');prepareAndCommit(el,()=>h('label',{className:cls,htmlFor:()=> 'field',tabIndex:()=>3}));expect(el.getAttribute('class')).toBe('a');expect(el.hasAttribute('classname')).toBe(false);expect(el.getAttribute('for')).toBe('field');expect(el.getAttribute('tabindex')).toBe('3');setCls('b');expect(el.getAttribute('class')).toBe('b');
  });
  it('calls a function ref with the adopted element instead of writing a ref attribute',()=>{
    const el=fixture('<input>'),seen:Element[]=[];prepareAndCommit(el,()=>h('input',{ref:(node:Element)=>seen.push(node)}));expect(seen).toEqual([el]);expect(el.hasAttribute('ref')).toBe(false);
  });
  it('never writes an inline event-handler attribute for an odd-cased on* prop',()=>{
    const el=fixture('<img>');prepareAndCommit(el,()=>h('img',{ONERROR:()=> 'alert(1)',Onload:()=> 'alert(2)'}));expect(el.hasAttribute('onerror')).toBe(false);expect(el.hasAttribute('onload')).toBe(false);expect(el.attributes.length).toBe(0);
  });
  it('removes a URL attribute whose reactive value uses a dangerous scheme',()=>{
    const el=fixture('<a href="/ok"></a>'),[url,setUrl]=createSignal('/ok');prepareAndCommit(el,()=>h('a',{href:url}));setUrl('java\tscript:alert(1)');expect(el.hasAttribute('href')).toBe(false);setUrl('/back-to-safe');expect(el.getAttribute('href')).toBe('/back-to-safe');
  });
});

describe('strict descriptor preparation',()=>{
  it.each([
    ['simple','<div class="card">Hello</div>',()=>h('div',{class:'card'},'Hello')],
    ['nested','<div><span class="inner">Nested</span></div>',()=>h('div',null,h('span',{class:'inner'},'Nested'))],
    ['null props','<br>',()=>h('br',null)],
    ['deep','<div><ul><li>Item 1</li><li>Item 2</li></ul></div>',()=>h('div',null,h('ul',null,h('li',null,'Item 1'),h('li',null,'Item 2')))],
  ] as const)('adopts %s descriptors without converting them to new DOM',(_name,html,build)=>{
    const el=fixture(html),before=el.outerHTML,first=el.firstChild;prepareAndCommit(el,build);expect(el.outerHTML).toBe(before);expect(el.firstChild).toBe(first);
  });
  it('recurses into nested children and attaches their event handlers',()=>{
    const el=fixture('<div><span>inner</span></div>'),span=el.firstElementChild as HTMLElement,handler=vi.fn();prepareAndCommit(el,()=>h('div',null,h('span',{onClick:handler},'inner')));span.click();expect(handler).toHaveBeenCalledOnce();expect(el.firstElementChild).toBe(span);
  });
  it('binds reactive text to SSR text marker nodes',()=>{
    const el=fixture('<div><!--f:t0-->hello<!--/f:t0--></div>'),node=el.childNodes[1] as Text,[value,setValue]=createSignal('hello');prepareAndCommit(el,()=>h('div',null,value));expect(node.data).toBe('hello');setValue('world');expect(node.data).toBe('world');
  });
  it('uses a scalar text range rather than treating a Show marker as a text binding',()=>{
    const el=fixture('<button><!--f:s5-->Show<!--/f:s5--></button>'),[value]=createSignal('Show');expectRefusal(el,()=>h('button',null,value),'FORMA_E_HYDRATE_MARKER');
    const positive=fixture('<button><!--f:t5-->Show<!--/f:t5--></button>'),[label,setLabel]=createSignal('Show');prepareAndCommit(positive,()=>h('button',null,label));setLabel('Hide');expect(positive.textContent).toBe('Hide');
  });
  it('handles interleaved elements and reactive text',()=>{
    const el=fixture('<div><span></span><!--f:t0-->dynamic<!--/f:t0--><p></p></div>'),children=Array.from(el.children),[value]=createSignal('dynamic');prepareAndCommit(el,()=>h('div',null,h('span'),value,h('p')));expect(Array.from(el.children)).toEqual(children);expect(el.textContent).toBe('dynamic');
  });
  it('refuses a tag mismatch without replacing the original element',()=>{const el=fixture('<span></span>');expectRefusal(el,()=>h('div',{class:'replacement'},'Replaced'),'FORMA_E_HYDRATE_NODE');});
  it('refuses a missing SSR child without inserting a replacement',()=>{const el=fixture('<section></section>');expectRefusal(el,()=>h('section',null,h('div')),'FORMA_E_HYDRATE_NODE');});
  it('adopts static string children without touching the server text node',()=>{
    const el=fixture('<div>static textanother string42</div>'),node=el.firstChild;prepareAndCommit(el,()=>h('div',null,'static text','another string',42));expect(el.childNodes).toHaveLength(1);expect(el.firstChild).toBe(node);expect(el.textContent).toBe('static textanother string42');
  });
  it('refuses differing static text rather than ignoring trailing client children',()=>{const el=fixture('<div>static text</div>');expectRefusal(el,()=>h('div',null,'static text','another string',42),'FORMA_E_HYDRATE_NODE');});
  it('adopts falsy children (false, null, undefined) without creating nodes',()=>{const el=fixture('<div></div>');prepareAndCommit(el,()=>h('div',null,false,null,undefined));expect(el.childNodes).toHaveLength(0);});
  it.each(['<!--f:i0--><!--/f:i0-->','<!--f:i0--><!--/f:i0--><!--f:i1--><!--/f:i1-->'])('refuses empty island regions without manufacturing client roots: %s',html=>{
    const el=fixture('<div>'+html+'</div>');expectRefusal(el,()=>h('div',null,h('div',{class:'alert'},'Error')),'FORMA_E_HYDRATE_NODE');
  });
  it('does not consume a nested island as the parent component\'s own element',()=>{
    const el=fixture('<div><!--f:i0--><section data-forma-island="1" class="child">from server</section><!--/f:i0--><form></form></div>'),shell=el.querySelector('section');
    expectRefusal(el,()=>h('div',null,h('section',{class:'child'},'from client'),h('form')),'FORMA_E_HYDRATE_NODE');expect(el.querySelector('section')).toBe(shell);
  });
  it.each(['<!--f:t0--><!--/f:t0-->','<!--f:s5--><!--/f:s5-->',''])('refuses missing dynamic text instead of inserting it: %s',html=>{
    const el=fixture('<div>'+html+'</div>');expectRefusal(el,()=>h('div',null,()=>''),'FORMA_E_HYDRATE_MARKER');
  });
  it('preserves the native zero-width empty-text placeholder and binds later text',()=>{
    const el=fixture('<div><!--f:t0-->\u200b<!--/f:t0--></div>'),node=el.childNodes[1] as Text,[value,setValue]=createSignal<string|null>(null);prepareAndCommit(el,()=>h('div',null,()=>value()||''));expect(el.childNodes[1]).toBe(node);expect(node.data).toBe('\u200b');setValue('Error occurred');expect(node.data).toBe('Error occurred');
  });
  it('refuses an element-valued uncompiled reader without invoking a repairing path',()=>{
    const el=fixture('<div><span class="inner">hello</span></div>'),handler=vi.fn();expectRefusal(el,()=>h('div',null,()=>h('span',{class:'inner',onClick:handler},'hello')),'FORMA_E_HYDRATE_STRUCTURE');(el.firstElementChild as HTMLElement).click();expect(handler).not.toHaveBeenCalled();
  });
  it('refuses scalar text at an element cursor without adding text alongside it',()=>{
    const el=fixture('<div><span>existing</span></div>'),[value,setValue]=createSignal('hello');expectRefusal(el,()=>h('div',null,value),'FORMA_E_HYDRATE_MARKER');setValue('world');expect(el.textContent).toBe('existing');
  });
});

describe('strict Show preparation and later ownership',()=>{
  it('adopts show descriptor initial branch from SSR markers',()=>{
    const el=fixture('<div><!--f:s0--><span>content</span><!--/f:s0--></div>'),old=el.querySelector('span') as HTMLElement,handler=vi.fn();prepareAndCommit(el,()=>h('div',null,createShow(()=>true,()=>h('span',{onClick:handler},'content'))));old.click();expect(handler).toHaveBeenCalledOnce();expect(el.querySelector('span')).toBe(old);
  });
  it('handles empty initial branch (condition false, no else)',()=>{
    const el=fixture('<div><!--f:s0--><!--/f:s0--></div>'),start=el.firstChild,end=el.lastChild,[show,setShow]=createSignal(false);prepareAndCommit(el,()=>h('div',null,createShow(show,()=>h('span',null,'yes'))));expect(el.firstChild).toBe(start);expect(el.lastChild).toBe(end);setShow(true);expect(el.querySelector('span')!.textContent).toBe('yes');setShow(false);expect(el.querySelector('span')).toBeNull();
  });
  it('keeps multiple Show regions independent without global counters',()=>{
    const el=fixture('<div><!--f:s0--><span>A</span><!--/f:s0--><!--f:s1--><span>B</span><!--/f:s1--></div>'),a=vi.fn(),b=vi.fn();prepareAndCommit(el,()=>h('div',null,createShow(()=>true,()=>h('span',{onClick:a},'A')),createShow(()=>true,()=>h('span',{onClick:b},'B'))));(el.children[0] as HTMLElement).click();expect(a).toHaveBeenCalledOnce();expect(b).not.toHaveBeenCalled();(el.children[1] as HTMLElement).click();expect(b).toHaveBeenCalledOnce();
  });
  it('adopts SSR show content in place — no DOM movement during initial hydration',async()=>{
    const el=fixture('<div><!--f:s0--><p class="content">Hello</p><!--/f:s0--></div>'),old=el.querySelector('p'),[show,setShow]=createSignal(true),records:MutationRecord[]=[];
    const observer=new MutationObserver(batch=>records.push(...batch));observer.observe(el,{attributes:true,childList:true,characterData:true,subtree:true});
    prepareAndCommit(el,()=>h('div',null,createShow(show,()=>h('p',{class:'content'},'Hello'),()=>h('p',{class:'fallback'},'Hidden'))));await new Promise(resolve=>setTimeout(resolve,0));expect(records.concat(observer.takeRecords())).toEqual([]);expect(el.querySelector('p')).toBe(old);
    setShow(false);expect(el.querySelector('p.fallback')).toBeTruthy();expect(el.contains(old)).toBe(false);setShow(true);expect(el.querySelector('p.content')).not.toBe(old);expect(el.textContent).toBe('Hello');await new Promise(resolve=>setTimeout(resolve,0));expect(records.concat(observer.takeRecords()).length).toBeGreaterThan(0);observer.disconnect();
  });
  it.each([
    ['wrong branch','<p class="truthy">Truthy</p>',false,true,'FORMA_E_HYDRATE_VALUE'],
    ['no false branch','<p class="truthy">Truthy</p>',false,false,'FORMA_E_HYDRATE_STRUCTURE'],
    ['missing true branch','',true,true,'FORMA_E_HYDRATE_NODE'],
  ] as const)('refuses initial %s with no repair or later resurrection',(_name,markup,initial,hasElse,code)=>{
    const el=fixture('<div><!--f:s0-->'+markup+'<!--/f:s0--></div>'),[show,setShow]=createSignal<boolean>(initial);
    expectRefusal(el,()=>h('div',null,createShow(show,()=>h('p',{class:'truthy'},'Truthy'),hasElse?()=>h('p',{class:'falsy'},'Falsy'):undefined)),code);
    const original=el.innerHTML;for(const value of [true,false,true,false])setShow(value);expect(el.innerHTML).toBe(original);
  });
  it('disposes the adopted branch bindings when the server content is dropped',()=>{
    const el=fixture('<div><!--f:s0--><p class="content"><!--f:t0-->one<!--/f:t0--></p><!--/f:s0--></div>'),[show,setShow]=createSignal(true),[label,setLabel]=createSignal('one'),runs=vi.fn();prepareAndCommit(el,()=>h('div',null,createShow(show,()=>h('p',{class:'content'},()=>{runs();return label();}),()=>h('p',{class:'fallback'},'Hidden'))));const old=el.querySelector('p')!;expect(runs).toHaveBeenCalledOnce();setLabel('two');expect(old.textContent).toBe('two');expect(runs).toHaveBeenCalledTimes(2);setShow(false);runs.mockClear();setLabel('three');expect(runs).not.toHaveBeenCalled();
  });
  it('a branch built by its factory keeps updating after a toggle round-trip',()=>{
    const el=fixture('<div><!--f:s0--><p class="content"><!--f:t0-->one<!--/f:t0--></p><!--/f:s0--></div>'),[show,setShow]=createSignal(true),[label,setLabel]=createSignal('one');prepareAndCommit(el,()=>h('div',null,createShow(show,()=>h('p',{class:'content'},label),()=>h('p',{class:'fallback'},'Hidden'))));setShow(false);setShow(true);setLabel('two');expect(el.querySelector('p.content')!.textContent).toBe('two');setShow(false);setLabel('three');setShow(true);expect(el.querySelector('p.content')!.textContent).toBe('three');
  });
});

describe('opaque nested island marker ownership',()=>{
  it.each([
    ['text','<!--f:t0-->Parent text<!--/f:t0--><div data-forma-island="1"><!--f:t1-->Child text<!--/f:t1--></div><!--f:t2-->After child<!--/f:t2-->','t',2],
    ['show','<!--f:s0--><p>Show</p><!--/f:s0--><aside data-forma-island="1"><!--f:s1--><p>Child show</p><!--/f:s1--></aside>','s',1],
  ] as const)('keeps nested %s ranges outside parent authority',(_name,html,kind,count)=>{
    const el=fixture('<div>'+html+'</div>'),child=el.querySelector('[data-forma-island]')!,dom=new AdoptionDom(el);dom.children();
    expect(Array.from(el.childNodes).filter(node=>dom.rangeAt(node)?.kind===kind)).toHaveLength(count);expect(dom.rangeAt(child.firstChild!)).toBeUndefined();expect(()=>dom.children(child)).toThrow('FORMA_E_HYDRATE_STRUCTURE');dom.release();
  });
});

describe('hydrateIsland', () => {
  it('hydrates SSR HTML with event handlers', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // Build SSR container with data-forma-ssr
      const container = connect(document.createElement('div'));
      container.setAttribute('data-forma-ssr', '');
      const ssrButton = document.createElement('button');
      ssrButton.textContent = 'Click me';
      container.appendChild(ssrButton);

      const handler = vi.fn();

      hydrateIsland(
        () => h('button', { onClick: handler }, 'Click me'),
        container,
      );

      // Successful adoption also preserves the original SSR marker attribute
      expect(container.hasAttribute('data-forma-ssr')).toBe(true);

      // SAME button element preserved (not replaced)
      expect(container.children[0]).toBe(ssrButton);

      // Event handler is now attached
      ssrButton.click();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    dispose?.();
  });

  it('hydrates reactive text bindings', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // Build SSR container: <div data-forma-ssr><p><!--f:t0-->Hello</p></div>
      const container = connect(document.createElement('div'));
      container.setAttribute('data-forma-ssr', '');
      const p = document.createElement('p');
      p.appendChild(document.createComment('f:t0'));
      const textNode = document.createTextNode('Hello');
      p.appendChild(textNode);
      p.appendChild(document.createComment('/f:t0'));
      container.appendChild(p);

      const [text, setText] = createSignal('Hello');

      hydrateIsland(
        () => h('p', null, text),
        container,
      );

      expect(textNode.data).toBe('Hello');

      // Reactive update changes the SSR text node
      setText('World');
      expect(textNode.data).toBe('World');
    });

    dispose?.();
  });

  it('hydrates reactive attribute bindings', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // Build SSR container: <div data-forma-ssr><input type="password"></div>
      const container = connect(document.createElement('div'));
      container.setAttribute('data-forma-ssr', '');
      const input = document.createElement('input');
      input.setAttribute('type', 'password');
      container.appendChild(input);

      const [inputType, setInputType] = createSignal('password');

      hydrateIsland(
        () => h('input', { type: inputType }),
        container,
      );

      expect(input.getAttribute('type')).toBe('password');

      // Toggle type via signal
      setInputType('text');
      expect(input.getAttribute('type')).toBe('text');
    });

    dispose?.();
  });

  it('h() returns real elements after hydration completes', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const container = connect(document.createElement('div'));
      container.setAttribute('data-forma-ssr', '');
      const ssrSpan = document.createElement('span');
      ssrSpan.textContent = 'hi';
      container.appendChild(ssrSpan);

      hydrateIsland(
        () => h('span', null, 'hi'),
        container,
      );

      // After hydration, hydrating should be false
      expect(describingAdoption).toBe(false);

      // h() should now return a real element
      const el = h('div', { class: 'post-hydration' }, 'real');
      expect(el).toBeInstanceOf(HTMLElement);
      expect(el.tagName).toBe('DIV');
      expect(el.textContent).toBe('real');
    });

    dispose?.();
  });

  it('full integration: event → signal → reactive text update', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // Build SSR: <div data-forma-ssr><button><!--f:t0-->Create Account</button></div>
      const container = connect(document.createElement('div'));
      container.setAttribute('data-forma-ssr', '');
      const ssrButton = document.createElement('button');
      ssrButton.appendChild(document.createComment('f:t0'));
      ssrButton.appendChild(document.createTextNode('Create Account'));
      ssrButton.appendChild(document.createComment('/f:t0'));
      container.appendChild(ssrButton);

      const [submitting, setSubmitting] = createSignal(false);
      const label = () => submitting() ? 'Creating...' : 'Create Account';

      hydrateIsland(
        () => h('button', { onClick: () => setSubmitting(true) }, label),
        container,
      );

      // Initial state
      expect(ssrButton.textContent).toContain('Create Account');

      // Click the button — triggers signal change
      ssrButton.click();

      // Text should now be updated reactively
      const textNode = ssrButton.childNodes[1] as Text;
      expect(textNode.data).toBe('Creating...');
    });

    dispose?.();
  });
});

// ---------------------------------------------------------------------------
// Task 12: Complex hydration scenarios
// ---------------------------------------------------------------------------

describe('complex hydration scenarios', () => {
  it('form with submit handler, reactive button text, password toggle', () => {
    // Container simulates SSR HTML from Rust walker
    const container = connect(document.createElement('div'));
    container.setAttribute('data-forma-ssr', '');
    container.innerHTML = [
      '<div class="page">',
        '<form class="auth-form">',
          '<div class="field">',
            '<label>Email</label>',
            '<input type="email" placeholder="you@company.com">',
          '</div>',
          '<div class="field">',
            '<label>Password</label>',
            '<div class="password-wrap">',
              '<input type="password" placeholder="At least 8 chars">',
              '<button type="button"><!--f:t0-->Show<!--/f:t0--></button>',
            '</div>',
          '</div>',
          '<button type="submit" class="btn-primary"><!--f:t1-->Create Account<!--/f:t1--></button>',
        '</form>',
      '</div>',
    ].join('');

    const ssrForm = container.querySelector('form')!;
    const ssrPasswordInput = container.querySelectorAll('input')[1]!;
    const ssrToggleBtn = container.querySelector('.password-wrap button')!;
    const ssrSubmitBtn = container.querySelector('.btn-primary')!;

    const [submitting, setSubmitting] = createSignal(false);
    const [showPwd, setShowPwd] = createSignal(false);
    let formSubmitted = false;

    const dispose = adoptInRoot(
      () => h('div', { class: 'page' },
        h('form', {
          class: 'auth-form',
          onSubmit: (e: Event) => { e.preventDefault(); formSubmitted = true; setSubmitting(true); },
        },
          h('div', { class: 'field' },
            h('label', null, 'Email'),
            h('input', { type: 'email', placeholder: 'you@company.com' }),
          ),
          h('div', { class: 'field' },
            h('label', null, 'Password'),
            h('div', { class: 'password-wrap' },
              h('input', {
                type: () => showPwd() ? 'text' : 'password',
                placeholder: 'At least 8 chars',
              }),
              h('button', {
                type: 'button',
                onClick: () => setShowPwd(!showPwd()),
              }, () => showPwd() ? 'Hide' : 'Show'),
            ),
          ),
          h('button', {
            type: 'submit',
            class: 'btn-primary',
            disabled: submitting,
          }, () => submitting() ? 'Creating...' : 'Create Account'),
        ),
      ),
      container,
    );

    // 1. SSR elements preserved
    expect(container.querySelector('form')).toBe(ssrForm);
    expect(container.querySelectorAll('input')[1]).toBe(ssrPasswordInput);
    expect(container.hasAttribute('data-forma-ssr')).toBe(true);

    // 2. Password toggle
    expect(ssrPasswordInput.getAttribute('type')).toBe('password');
    ssrToggleBtn.dispatchEvent(new Event('click'));
    expect(ssrPasswordInput.getAttribute('type')).toBe('text');
    expect(ssrToggleBtn.textContent).toContain('Hide');
    ssrToggleBtn.dispatchEvent(new Event('click'));
    expect(ssrPasswordInput.getAttribute('type')).toBe('password');
    expect(ssrToggleBtn.textContent).toContain('Show');

    // 3. Submit → reactive text update
    ssrForm.dispatchEvent(new Event('submit'));
    expect(formSubmitted).toBe(true);
    expect(ssrSubmitBtn.textContent).toContain('Creating...');

    dispose();
  });

  it('hydration with createShow conditional content', () => {
    const container = connect(document.createElement('div'));
    container.setAttribute('data-forma-ssr', '');
    container.innerHTML = '<div><!--f:s0--><div class="oauth"><button>Google</button></div><!--/f:s0--><form><button>Submit</button></form></div>';

    const ssrOAuthDiv = container.querySelector('.oauth')!;
    let oauthClicked = false;
    let submitClicked = false;

    const dispose = adoptInRoot(
      () => h('div', null,
        createShow(
          () => true,
          () => h('div', { class: 'oauth' },
            h('button', { onClick: () => { oauthClicked = true; } }, 'Google'),
          ),
        ) as any,
        h('form', null,
          h('button', { onClick: () => { submitClicked = true; } }, 'Submit'),
        ),
      ),
      container,
    );

    const oauthBtn = container.querySelector('.oauth button')!;
    (oauthBtn as HTMLElement).click();
    expect(oauthClicked).toBe(true);

    const submitBtn = container.querySelector('form button')!;
    (submitBtn as HTMLElement).click();
    expect(submitClicked).toBe(true);

    dispose();
  });
});


describe('h() function child returning Node', () => {
  it('appends DOM element when function returns a Node', () => {
    createRoot(() => {
      const el = h('div', null, () => h('span', null, 'child'));
      expect(el.innerHTML).toBe('<span>child</span>');
    });
  });

  it('replaces element when function return type changes from Node to text', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [mode, setMode] = createSignal<'element' | 'text'>('element');

      const el = h('div', null, () => {
        return mode() === 'element'
          ? h('span', null, 'child')
          : 'plain text';
      });

      expect(el.innerHTML).toBe('<span>child</span>');

      setMode('text');
      expect(el.textContent).toBe('plain text');
      expect(el.querySelector('span')).toBeNull();
    });

    dispose?.();
  });

  it('replaces text with element when function return type changes from text to Node', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [mode, setMode] = createSignal<'element' | 'text'>('text');

      const el = h('div', null, () => {
        return mode() === 'element'
          ? h('span', null, 'child')
          : 'plain text';
      });

      expect(el.textContent).toBe('plain text');

      setMode('element');
      expect(el.innerHTML).toBe('<span>child</span>');
    });

    dispose?.();
  });

  it('replaces element with different element', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [tag, setTag] = createSignal('span');

      const el = h('div', null, () => h(tag(), null, 'content'));

      expect(el.innerHTML).toBe('<span>content</span>');

      setTag('em');
      expect(el.innerHTML).toBe('<em>content</em>');
    });

    dispose?.();
  });

  it('still handles text function children (regression)', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [count, setCount] = createSignal(0);

      const el = h('div', null, () => count());

      expect(el.textContent).toBe('0');

      setCount(42);
      expect(el.textContent).toBe('42');
    });

    dispose?.();
  });
});


describe('reactive style object reconciliation', () => {
  it('removes stale style keys when reactive style object changes', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [styles, setStyles] = createSignal<Record<string, string>>({
        color: 'red',
        fontSize: '16px',
      });

      const el = h('div', { style: styles });

      expect((el as HTMLElement).style.color).toBe('red');
      expect((el as HTMLElement).style.fontSize).toBe('16px');

      // Remove fontSize, change color
      setStyles({ color: 'blue' });

      expect((el as HTMLElement).style.color).toBe('blue');
      expect((el as HTMLElement).style.fontSize).toBe('');
    });

    dispose?.();
  });

  it('handles transition from object style to string style', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [styles, setStyles] = createSignal<string | Record<string, string>>({
        color: 'red',
        fontWeight: 'bold',
      });

      const el = h('div', { style: styles });

      expect((el as HTMLElement).style.color).toBe('red');
      expect((el as HTMLElement).style.fontWeight).toBe('bold');

      // Switch to string — the shared per-property writer removes stale declarations
      (setStyles as any)('color: green');

      expect((el as HTMLElement).style.color).toBe('green');
      expect((el as HTMLElement).style.fontWeight).toBe('');
    });

    dispose?.();
  });

  it('adds new keys when reactive style object gains properties', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      const [styles, setStyles] = createSignal<Record<string, string>>({
        color: 'red',
      });

      const el = h('div', { style: styles });

      expect((el as HTMLElement).style.color).toBe('red');
      expect((el as HTMLElement).style.fontSize).toBe('');

      // Add fontSize
      setStyles({ color: 'red', fontSize: '20px' });

      expect((el as HTMLElement).style.color).toBe('red');
      expect((el as HTMLElement).style.fontSize).toBe('20px');
    });

    dispose?.();
  });
});


// Activation isolation remains on the real registry path; runtime activation switch is separately owned.
describe('island isolation for throwing bindings', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('a binding that throws while being built fails only its own island', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Broken" data-forma-status="pending">
        <p title="x">SSR content stays</p>
      </div>
      <div data-forma-island="1" data-forma-component="Working" data-forma-status="pending">
        <p><!--f:t0-->OK<!--/f:t0--></p>
      </div>
    `;
    installState();

    let setMsg!: (v: string) => void;

    activateIslands(emptyRegistry({
      // The component builds fine; its reactive attribute binding throws on the
      // first (synchronous) run, which must surface to island activation.
      Broken: () => h('div', null, h('p', { title: () => { throw new Error('binding blew up'); } }, 'SSR content stays')),
      Working: () => {
        const [msg, _setMsg] = createSignal('OK');
        setMsg = _setMsg;
        return h('div', null, h('p', null, () => msg()));
      },
    }));

    expect(document.querySelector('[data-forma-island="0"]')!.getAttribute('data-forma-status')).toBe('error');
    expect(document.querySelector('[data-forma-island="0"] p')!.textContent).toBe('SSR content stays');

    expect(document.querySelector('[data-forma-island="1"]')!.getAttribute('data-forma-status')).toBe('active');
    setMsg('Updated');
    expect(document.querySelector('[data-forma-island="1"] p')!.textContent).toBe('Updated');

    errorSpy.mockRestore();
  });

  it('a binding that throws on a shared-signal update does not freeze the other island', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Fragile" data-forma-status="pending">
        <p><!--f:t0-->0<!--/f:t0--></p>
      </div>
      <div data-forma-island="1" data-forma-component="Display" data-forma-status="pending">
        <p><!--f:t0-->0<!--/f:t0--></p>
      </div>
    `;
    installState();

    const [count, setCount] = createSignal(0);

    activateIslands(emptyRegistry({
      // Island 0 is fine at hydration time and breaks on the first update.
      Fragile: () => h('div', null, h('p', null, () => {
        if (count() > 0) throw new Error('island 0 binding is broken');
        return '0';
      })),
      Display: () => h('div', null, h('p', null, () => String(count()))),
    }));

    expect(document.querySelector('[data-forma-island="1"] p')!.textContent).toBe('0');

    // The write comes from unrelated code and must not throw there…
    expect(() => setCount(7)).not.toThrow();
    // …and island 1 must still have been flushed.
    expect(document.querySelector('[data-forma-island="1"] p')!.textContent).toBe('7');

    errorSpy.mockRestore();
  });
});

useFreshDocument();
