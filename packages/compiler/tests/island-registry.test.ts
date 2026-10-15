/** Declared island table/content controls. Original fallback/capture assertions
 * are preserved verbatim in docs/archive/2026-10-15-declared-island-test-migration. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IrEmitContext } from '../src/ir-emit';
import { generateRealIr } from '../src/esbuild-ssr-plugin';
import { readFmirContainer } from '../src/fmir';
import * as C from '../src/fmir-constants';
import { assertBinaryInvariants, getIslands, getSlots, getStrings, parseOpcodeList, readSections } from './helpers/fmir';

const CORE = "import {h,createSignal,createShow,createList,mount,activateIslands} from '@getforma/core';\n";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}); });
function sourceProject(page: string, components: string, names: string[] = ['Widget']) {
  const root = mkdtempSync(join(tmpdir(), 'forma-declared-registry-')); roots.push(root);
  writeFileSync(join(root, 'components.ts'), CORE + components);
  writeFileSync(join(root, 'page.ts'), CORE + (names.length ? `import {${names.join(',')}} from './components';` : '') + page);
  writeFileSync(join(root, 'app.ts'), CORE + `import {Page} from './page';` +
    (names.length ? `import {${names.join(',')}} from './components';activateIslands({${names.join(',')}});` : '') + `mount(()=>Page(),'#app');`);
  return join(root, 'app.ts');
}
function compile(page: string, components: string, names?: string[]) {
  const result = generateRealIr(sourceProject(page, components, names));
  expect(result).not.toBeNull(); assertBinaryInvariants(result!.binary);
  expect(getStrings(result!.binary)).not.toContain('data-forma-props');
  for (const island of result!.islands) {
    expect(island.contract?.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(island.contract?.schema).toBeDefined();
  }
  return result!;
}
function manual() {
  const ctx = new IrEmitContext();
  const schema = ctx.appendPropsSchema([[{name:'email',file:'form.ts',line:1,column:1,type:{kind:'string'}},{name:'password',file:'form.ts',line:2,column:1,type:{kind:'string'}}]]);
  const slots = [ctx.addConstantSlot('a@example.test', C.SLOT_TYPE_TEXT), ctx.addConstantSlot('secret', C.SLOT_TYPE_TEXT)];
  const id = ctx.addIsland('FormIsland', C.TRIGGER_LOAD, slots, ctx.opcodeLen(), schema);
  ctx.setIslandContract(id, 'ssr', []);
  ctx.emit(C.OP_ISLAND_START); ctx.emitU16(id);
  const div = ctx.addString('div'); ctx.emit(C.OP_OPEN_TAG); ctx.emitU32(div); ctx.emitU16(0);
  ctx.emit(C.OP_CLOSE_TAG); ctx.emitU32(div); ctx.emit(C.OP_ISLAND_END); ctx.emitU16(id);
  return {ctx, slots, id, schema};
}

describe('declared island registry', () => {
  it.each([
    ['unknown expression', "h('div',null,someFunction())"],
    ['multiple unknown calls', "h('div',null,funcA(),funcB())"],
    ['computed tag', "h(tagName,null,'text')"],
    ['unsupported spread', "h('div',null,...children)"],
    ['unresolved component', "h('div',null,UnknownComponent())"],
  ])('refuses %s instead of inventing an unregistered island', (_label, expression) => {
    expect(() => generateRealIr(sourceProject(`export function Page(){return ${expression};}`, '', []))).toThrow(/BUILD-610/);
  });
  it('static content and boolean children produce no island table entries', () => {
    const result = compile("export function Page(){return h('div',{class:'hero'},'Hello',true,false);}", '', []);
    expect(result.islands).toEqual([]); expect(getIslands(result.binary)).toEqual([]);
    expect(parseOpcodeList(result.binary)).toEqual(['OPEN_TAG div class="hero"','TEXT "Hello"','CLOSE_TAG div']);
  });
  it('declared repeated occurrences keep their name and get distinct table ids', () => {
    const result = compile("export function Page(){return h('main',null,Widget({text:'one'}),Widget({text:'two'}));}",
      "export function Widget(p:{text:string}){return h('b',null,p.text);}");
    expect(getIslands(result.binary).map(i => [i.name,i.id,i.trigger,i.slotIds.length])).toEqual([['Widget',0,1,1],['Widget',1,1,1]]);
    expect(result.islands[0]!.contract).toEqual(result.islands[1]!.contract);
    expect(getIslands(result.binary)[0]!.slotIds).not.toEqual(getIslands(result.binary)[1]!.slotIds);
  });
  it('manual getIslands metadata and binary table preserve declared ordered inputs', () => {
    const {ctx,slots,id,schema} = manual();
    expect(id).toBe(0); expect(ctx.peekNextIslandId()).toBe(1); expect(ctx.peekNextIslandId()).toBe(1);
    expect(ctx.getIslands()[0]).toMatchObject({id:0,name:'FormIsland',trigger:1,slotIds:slots,contract:{mode:'ssr',schema:[[{name:'email',type:{kind:'string'}},{name:'password',type:{kind:'string'}}]]}});
    const binary = ctx.toBinary(); assertBinaryInvariants(binary);
    expect(getIslands(binary)[0]).toMatchObject({id:0,name:'FormIsland',trigger:1,schemaObject:schema,slotIds:slots});
    expect(getStrings(binary)).toContain('FormIsland');
    expect(readFmirContainer(binary).sections.find(section => section.id === C.SECTION_ISLAND_CONTRACTS)?.flags).toBe(C.SECTION_REQUIRED);
  });
  it('schema enums and source positions count as real string references, while orphans still fail', () => {
    const ctx = new IrEmitContext();
    ctx.setPropsSchema([[{name:'choices',file:'schema-only.ts',line:2,column:3,type:{kind:'optional',inner:{kind:'array',element:{kind:'enum',variants:['first','second']}}}}]]);
    const div = ctx.addString('div'); ctx.emit(C.OP_OPEN_TAG); ctx.emitU32(div); ctx.emitU16(0);
    ctx.emit(C.OP_CLOSE_TAG); ctx.emitU32(div);
    ctx.setSourcePositions([{opcodeOffset:0,file:'render-only.ts',line:4,column:5,component:'RootOnly'}]);
    expect(() => assertBinaryInvariants(ctx.toBinary())).not.toThrow();
    ctx.addString('genuine-orphan');
    expect(() => assertBinaryInvariants(ctx.toBinary())).toThrow(/string table has entries nothing references/);
  });
  it('list key path segments count as references without claiming unrelated strings', () => {
    const ctx = new IrEmitContext();
    const array = ctx.addConstantSlot([{key:'one'}],C.SLOT_TYPE_ARRAY), item = ctx.addTemporarySlot(C.SLOT_TYPE_OBJECT);
    ctx.emit(C.OP_LIST);ctx.emitU16(array);ctx.emitU16(item);ctx.emitU32(0);
    ctx.addKeyPath(0,['key']);
    expect(() => assertBinaryInvariants(ctx.toBinary())).not.toThrow();
    ctx.addString('not-a-key');
    expect(() => assertBinaryInvariants(ctx.toBinary())).toThrow(/string table has entries nothing references/);
  });
  it('manual islands require a declared schema and contract before metadata or bytes', () => {
    const ctx = new IrEmitContext(); ctx.addIsland('Undeclared', 1, [], 0);
    expect(() => ctx.getIslands()).toThrow(/no declared contract/);
    expect(() => ctx.toBinary()).toThrow(/no declared contract/);
  });
  it('empty context has no islands and peeking does not consume an id', () => {
    const ctx = new IrEmitContext(); expect(ctx.getIslands()).toEqual([]);
    expect(ctx.peekNextIslandId()).toBe(0); expect(ctx.peekNextIslandId()).toBe(0);
  });
  it('every section stays within the container and table offsets point to own starts', () => {
    const {ctx} = manual(), binary = ctx.toBinary(), sections = readSections(binary);
    assertBinaryInvariants(binary);
    for (const [offset,size] of [[sections.opcodeOffset,sections.opcodeSize],[sections.stringTableOffset,sections.stringTableSize],[sections.slotTableOffset,sections.slotTableSize],[sections.islandTableOffset,sections.islandTableSize]]) {
      expect(offset).toBeGreaterThanOrEqual(C.HEADER_SIZE); expect(offset + size).toBeLessThanOrEqual(binary.length);
    }
    expect(sections.islandTableSize).toBeGreaterThan(2);
  });
  it('registered native islands retain their complete root tag and subtree', () => {
    const result = compile("export function Page(){return h('main',null,Widget());}",
      "export function Widget(){return h('section',{class:'filter-bar'},h('label',null,'Filter:'),h('input',{type:'text',placeholder:'Search...'}));}");
    expect(parseOpcodeList(result.binary)).toEqual(['OPEN_TAG main','ISLAND_START Widget#0','OPEN_TAG section class="filter-bar"','OPEN_TAG label','TEXT "Filter:"','CLOSE_TAG label','VOID_TAG input type="text" placeholder="Search..."','CLOSE_TAG section','ISLAND_END Widget#0','CLOSE_TAG main']);
    expect(getStrings(result.binary)).not.toContain('div');
  });
  it('declared dynamic attributes and text read inputs without collecting unrelated page slots', () => {
    const result = compile("export function Page(p:{outer:string;label:string}){return h('main',{id:p.outer},Widget({label:p.label}));}",
      "export function Widget(p:{label:string}){return h('div',{class:()=>p.label},h('span',null,p.label));}");
    const slots = getSlots(result.binary), input = slots.find(s => s.name === 'label')!;
    expect(result.islands[0]!.slotIds).toEqual([input.id]);
    expect(result.islands[0]!.slotIds).not.toContain(slots.find(s => s.name === 'outer')!.id);
    const ops = parseOpcodeList(result.binary);
    expect(ops).toContain('DYN_ATTR class -> label'); expect(ops).toContain('DYN_TEXT label marker=0');
  });
  it('registered conditional content emits its real branch between island markers', () => {
    const result = compile("export function Page(p:{visible:boolean}){return Widget({visible:p.visible});}",
      "export function Widget(p:{visible:boolean}){return h('div',{class:'cond'},createShow(()=>p.visible,()=>h('span',null,'shown')));}");
    const ops = parseOpcodeList(result.binary);
    expect(ops[0]).toBe('ISLAND_START Widget#0'); expect(ops.at(-1)).toBe('ISLAND_END Widget#0');
    expect(ops).toContain('SHOW_IF visible then=17 else=0'); expect(ops).toContain('TEXT "shown"');
  });
  it('two registered components keep their own full content and identity', () => {
    const result = compile("export function Page(){return h('div',null,Header(),Footer());}",
      "export function Header(){return h('header',null,h('h1',null,'Welcome'));}export function Footer(){return h('footer',null,h('p',null,'Copyright'));}", ['Header','Footer']);
    expect(result.islands.map(i => [i.name,i.slotIds])).toEqual([['Header',[]],['Footer',[]]]);
    expect(parseOpcodeList(result.binary)).toEqual(['OPEN_TAG div','ISLAND_START Header#0','OPEN_TAG header','OPEN_TAG h1','TEXT "Welcome"','CLOSE_TAG h1','CLOSE_TAG header','ISLAND_END Header#0','ISLAND_START Footer#1','OPEN_TAG footer','OPEN_TAG p','TEXT "Copyright"','CLOSE_TAG p','CLOSE_TAG footer','ISLAND_END Footer#1','CLOSE_TAG div']);
  });
  it('ordered repeated declared fields stay repeated, not sorted unique captured slots', () => {
    const result = compile("export function Page(p:{label:string}){return Widget({right:p.label,left:p.label});}",
      "export function Widget(p:{left:string;right:string}){return h('p',null,p.left,p.right);}");
    const id = getSlots(result.binary).find(s => s.name === 'label')!.id;
    expect(result.islands[0]!.slotIds).toEqual([id,id]);
    expect(result.islands[0]!.contract?.schema[0]?.map(field => field.name)).toEqual(['left','right']);
  });
  it('local signal defaults and list scratch values stay outside declared inputs', () => {
    const result = compile("export function Page(){return Widget();}",
      "export function Widget(){const [count]=createSignal(0);const [unread]=createSignal('unused');const [rows]=createSignal([{id:1,name:'row'}]);return h('section',null,()=>count(),createList(()=>rows(),r=>r.id,r=>h('b',null,r.name)));}");
    expect(result.islands[0]!.slotIds).toEqual([]);
    const slots = getSlots(result.binary); expect(slots.every(s => s.source === C.SLOT_SOURCE_CLIENT)).toBe(true);
    expect(slots).toEqual(expect.arrayContaining([expect.objectContaining({name:'count',default:'0'}),expect.objectContaining({name:'unread',default:'unused'})]));
    expect(parseOpcodeList(result.binary).some(op => op.startsWith('LIST '))).toBe(true);
  });
  it.each(['return Widget();', "return h('div',null,Widget());"])('registered recursion refuses instead of emitting an empty shell: %s', body => {
    expect(() => generateRealIr(sourceProject('export function Page(){return Widget();}', `export function Widget(){${body}}`))).toThrow(/BUILD-610.*recursive registered island/);
  });
  it.each(['{}','{label:123}'])('missing or incompatible declared input %s refuses', input => {
    expect(() => generateRealIr(sourceProject(`export function Page(){return Widget(${input});}`, "export function Widget(p:{label:string}){return h('p',null,p.label);}"))).toThrow(/BUILD-610/);
  });
  it('an unresolved nested component refuses the entire candidate, with a fresh valid compile unaffected', () => {
    expect(() => generateRealIr(sourceProject('export function Page(){return Widget();}', "export function Widget(){return h('div',null,Broken());}"))).toThrow(/BUILD-610/);
    const valid = compile("export function Page(){return Widget();}", "export function Widget(){return h('p',null,'tail');}");
    expect(parseOpcodeList(valid.binary)).toContain('TEXT "tail"'); expect(valid.islands[0]!.id).toBe(0);
  });
});

describe('generateRealIr island signal defaults', () => {
  const TYPE_TEXT = 0x01;
  const TYPE_BOOL = 0x02;

  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'forma-island-signals-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write project files into tmpDir and return the entry point path. */
  function writeProject(files: Record<string, string>): string {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(tmpDir, name), content);
    }
    return join(tmpDir, 'app.ts');
  }

  const entrySource = `
    import { activateIslands } from 'formajs';
    import { DashboardPage } from './DashboardPage';
    import { CounterIsland } from './CounterIsland';
    activateIslands({ CounterIsland });
  `;

  it('module-level island signals become named slots with correct defaults', () => {
    const entryPath = writeProject({
      'app.ts': entrySource,
      'DashboardPage.ts': `
        import { h } from 'formajs';
        import { CounterIsland } from './CounterIsland';
        export function DashboardPage() {
          return h('div', { class: 'page' }, CounterIsland());
        }
      `,
      'CounterIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [pillRunning, setPillRunning] = createSignal(false);
        const [statusText, setStatusText] = createSignal('idle');
        export function CounterIsland() {
          return h('section', null, () => statusText());
        }
      `,
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();

    const slots = getSlots(result!.binary);
    const byName = new Map(slots.map(s => [s.name, s]));

    // Slots are NAMED after the island's module-level signals, with defaults
    expect(byName.get('pillRunning')).toMatchObject({ typeHint: TYPE_BOOL, default: 'false' });
    expect(byName.get('statusText')).toMatchObject({ typeHint: TYPE_TEXT, default: 'idle' });

    // The island's dynamic text reuses the named slot — no anonymous text:N slot
    expect(slots.some(s => /^text:\d+$/.test(s.name))).toBe(false);

    // Captured module signals remain CLIENT defaults, outside declared inputs
    expect(result!.islands).toHaveLength(1);
    expect(result!.islands[0]!.name).toBe('CounterIsland');
    expect(result!.islands[0]!.slotIds).toEqual([]);
    expect(slots.every(slot => slot.source === C.SLOT_SOURCE_CLIENT)).toBe(true);
  });

  it('a page "twin" declaration is a SEPARATE signal, and the island renders its own', () => {
    // The twin pattern — re-declaring an island's signal in the Page component
    // so the old pre-pass could see the default — is no longer needed, and is
    // now actively wrong: the two declarations are different lexical bindings,
    // which is what they are at RUNTIME too. The page's copy gets `statusText`,
    // the island's gets `statusText#2`, and the island's binding reads its own.
    const entryPath = writeProject({
      'app.ts': entrySource,
      'DashboardPage.ts': `
        import { createSignal, h } from 'formajs';
        import { CounterIsland } from './CounterIsland';
        export function DashboardPage() {
          const [statusText, setStatusText] = createSignal('busy');
          return h('div', null, CounterIsland());
        }
      `,
      'CounterIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [statusText, setStatusText] = createSignal('idle');
        export function CounterIsland() {
          return h('section', null, () => statusText());
        }
      `,
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();

    const slots = getSlots(result!.binary);
    expect(slots.map(s => [s.name, s.default])).toEqual([
      ['statusText', 'busy'],     // the page's own, which nothing on the page reads
      ['statusText#2', 'idle'],   // the island's, which its DYN_TEXT binds
    ]);
    expect(result!.islands[0]!.slotIds).toEqual([]);
    expect(slots.every(slot => slot.source === C.SLOT_SOURCE_CLIENT)).toBe(true);
    expect(parseOpcodeList(result!.binary)).toContain('DYN_TEXT statusText#2 marker=0');

    // …and the rename is reported, because injecting `statusText` would now
    // fill a slot nothing renders.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("signal 'statusText' is also declared in another scope"),
    );
  });

  it('deleting the twin leaves exactly the island\'s signal, unsuffixed and silent', () => {
    // The migration this makes possible: one declaration, in the file that
    // owns it. Nothing about the page's slot table needs the twin.
    const entryPath = writeProject({
      'app.ts': entrySource,
      'DashboardPage.ts': `
        import { h } from 'formajs';
        import { CounterIsland } from './CounterIsland';
        export function DashboardPage() {
          return h('div', null, CounterIsland());
        }
      `,
      'CounterIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [statusText, setStatusText] = createSignal('idle');
        export function CounterIsland() {
          return h('section', null, () => statusText());
        }
      `,
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();

    const slots = getSlots(result!.binary);
    expect(slots.map(s => [s.name, s.default])).toEqual([['statusText', 'idle']]);
  });

  it('two islands declaring the same name get one slot each, and the rename is reported', () => {
    const entryPath = writeProject({
      'app.ts': `
        import { activateIslands } from 'formajs';
        import { DashboardPage } from './DashboardPage';
        import { AlphaIsland } from './AlphaIsland';
        import { BetaIsland } from './BetaIsland';
        activateIslands({ AlphaIsland, BetaIsland });
      `,
      'DashboardPage.ts': `
        import { h } from 'formajs';
        import { AlphaIsland } from './AlphaIsland';
        import { BetaIsland } from './BetaIsland';
        export function DashboardPage() {
          return h('div', null, AlphaIsland(), BetaIsland());
        }
      `,
      'AlphaIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [shared, setShared] = createSignal('from-alpha');
        export function AlphaIsland() {
          return h('span', null, () => shared());
        }
      `,
      'BetaIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [shared, setShared] = createSignal('from-beta');
        export function BetaIsland() {
          return h('em', null, () => shared());
        }
      `,
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();

    // Two files, two module-scope declarations, two runtime signals — so two
    // slots, each carrying its OWN default. The old flat map merged them
    // first-wins and BetaIsland server-rendered Alpha's text.
    const slots = getSlots(result!.binary);
    expect(slots.map(s => [s.name, s.default])).toEqual([
      ['shared', 'from-alpha'],
      ['shared#2', 'from-beta'],
    ]);

    // Each island renders its own CLIENT slot; neither is a declared input.
    expect(result!.islands.map(i => i.slotIds)).toEqual([[], []]);
    expect(slots.every(slot => slot.source === C.SLOT_SOURCE_CLIENT)).toBe(true);
    const ops = parseOpcodeList(result!.binary);
    expect(ops).toContain('DYN_TEXT shared marker=0');
    expect(ops).toContain('DYN_TEXT shared#2 marker=1');

    // The second declaration's slot name is not the one in the source, so it
    // is named in a warning rather than left for a failed injection to reveal.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("signal 'shared' is also declared in another scope"),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'shared#2'"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('BetaIsland.ts'));
  });

  it('inline block-body mount path merges island signal defaults', () => {
    const entryPath = writeProject({
      'app.ts': `
        import { h, mount, activateIslands } from 'formajs';
        import { CounterIsland } from './CounterIsland';
        mount(() => {
          return h('div', { class: 'shell' }, CounterIsland());
        }, '#app');
        activateIslands({ CounterIsland });
      `,
      'CounterIsland.ts': `
        import { createSignal, h } from 'formajs';
        const [statusText, setStatusText] = createSignal('idle');
        export function CounterIsland() {
          return h('section', null, () => statusText());
        }
      `,
    });

    const result = generateRealIr(entryPath);
    expect(result).not.toBeNull();

    const slots = getSlots(result!.binary);
    const byName = new Map(slots.map(s => [s.name, s]));

    // The island's module-level signal becomes a named slot with its default
    expect(byName.get('statusText')).toMatchObject({ typeHint: TYPE_TEXT, default: 'idle' });

    // The inline path preserves the CLIENT default without serializing a capture
    expect(result!.islands).toHaveLength(1);
    expect(result!.islands[0]!.name).toBe('CounterIsland');
    expect(result!.islands[0]!.slotIds).toEqual([]);
    expect(slots.every(slot => slot.source === C.SLOT_SOURCE_CLIENT)).toBe(true);
  });

  it('unresolvable registered source refuses instead of publishing a shell', () => {
    const entryPath = writeProject({
      'app.ts': `
        import { activateIslands } from 'formajs';
        import { DashboardPage } from './DashboardPage';
        import { GhostIsland } from './GhostIsland';
        activateIslands({ GhostIsland });
      `,
      'DashboardPage.ts': `
        import { h } from 'formajs';
        import { GhostIsland } from './GhostIsland';
        export function DashboardPage() {
          return h('div', null, GhostIsland());
        }
      `,
      // GhostIsland.ts intentionally missing
    });

    expect(() => generateRealIr(entryPath)).toThrow(/BUILD-610.*cannot resolve registered island GhostIsland/);
  });
});
