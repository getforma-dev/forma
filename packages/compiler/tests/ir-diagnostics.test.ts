/**
 * Build diagnostics: every construct the walker cannot translate must SAY SO.
 *
 * This is the file that pins the lesson behind most of the ksx dogfood ledger:
 * the compiler understood a page only partly, emitted a placeholder or an empty
 * island for the rest, and reported nothing — so a pad silhouette shipped with
 * no `d` attribute for four versions (#10) and a whole class of signals landed
 * in anonymous slots (#9). The defect was never "the compiler cannot do X"; it
 * was "the compiler cannot do X and does not tell you".
 *
 * The rules asserted here:
 *   1. Every degradation warns, and the warning names WHERE (file), WHAT
 *      (construct) and SO WHAT (consequence for the rendered page).
 *   2. Unsupported native subtrees refuse with BUILD-610 and produce no IR;
 *      admitted advisory diagnostics still verify their actual output.
 *   3. A page the compiler fully understands emits NOTHING on the console.
 *      Without this, a warn-on-everything implementation would pass rule 1.
 *   4. The retired fallback writer stays absent and native refusal throws.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@babel/parser';
import type * as T from '@babel/types';
import * as t from '@babel/types';

import { PropsSchemaError } from '../src/props-schema';
import { IrEmitContext } from '../src/ir-emit';
import { walkHTree, walkCallExpression, type WalkContext } from '../src/ir-walk';
import {
  collectSignalDeclarations,
  enterSignalScope,
  newSignalRegistry,
} from '../src/signal-scope';
import { assertBinaryInvariants, getIslands, getSlots, parseOpcodeList } from './helpers/fmir';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseExpr(code: string): T.Expression {
  const ast = parse(`const __x = ${code}`, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  return (ast.program.body[0] as T.VariableDeclaration).declarations[0]!.init!;
}

/**
 * Walk an expression, capturing every console.warn the walk produces.
 *
 * `signals` is source for the declarations that must be IN SCOPE — a binding
 * to a signal the compiler cannot resolve is itself a degradation (the value
 * cannot form a closed native value), so a fixture that is supposed to be CLEAN has to
 * declare the signals it reads, exactly as a real page does. The scope's slots
 * are minted into the same context the walk emits into, or the ids the walk
 * writes would name slots that do not exist.
 */
function emitWithWarnings(code: string, walkCtx: WalkContext = {}, signals?: string) {
  const warnings: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(' '));
  });
  try {
    const expr = parseExpr(code);
    const ctx = new IrEmitContext();
    if (signals) {
      const registry = newSignalRegistry();
      walkCtx = {
        ...walkCtx,
        signalRegistry: registry,
        signalScope: enterSignalScope(
          null,
          'fixture.ts#module',
          collectSignalDeclarations(
            parse(signals, { sourceType: 'module', plugins: ['typescript'] })
              .program.body as T.Statement[],
            { filePath: 'fixture.ts' },
          ),
          ctx,
          registry,
        ),
      };
    }
    try {
    if (t.isCallExpression(expr)) {
      if (t.isIdentifier(expr.callee) && expr.callee.name === 'h') {
        walkHTree(expr, 'h', ctx, walkCtx);
      } else {
        walkCallExpression(expr, 'h', ctx, walkCtx);
      }
    }
    } catch(error) {
      if(!(error instanceof PropsSchemaError))throw error;
      return {warnings,refusal:error,ops:[],islands:[],slots:[]};
    }
    const binary = ctx.toBinary();
    assertBinaryInvariants(binary);
    return {
      warnings,
      refusal:undefined,
      ops: parseOpcodeList(binary),
      islands: getIslands(binary),
      slots: getSlots(binary),
    };
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1 + 2: every degradation warns, and the IR really degraded
// ---------------------------------------------------------------------------

/** [label, source, walk context, fragments the warning must contain, in-scope signals] */
const DEGRADATIONS: Array<[string, string, WalkContext, string[], string?]> = [
  [
    'dynamic tag',
    `h(tagName, null, 'x')`,
    {},
    ['dynamic tag h(tagName, ...)', 'refused with BUILD-610'],
  ],
  [
    'bare identifier child',
    `h('div', null, caption)`,
    {},
    ['child caption', 'wrap it in a function'],
  ],
  [
    'template literal child',
    `h('div', null, \`hi \${name}\`)`,
    {},
    ['child a template literal', 'refused with BUILD-610'],
  ],
  [
    'bare ternary child',
    `h('div', null, ok ? h('a', null, 'y') : h('b', null, 'n'))`,
    {},
    ['a bare ternary (not wrapped in a function)'],
  ],
  [
    'bare && child',
    `h('div', null, ok && h('a', null, 'y'))`,
    {},
    ["a bare '&&' expression (not wrapped in a function)"],
  ],
  [
    'un-unrollable spread',
    `h('ul', null, ...rows.map((r) => h('li', null, r.name)))`,
    {},
    ['spread child ...rows.map(...)', 'use createList for runtime data'],
  ],
  [
    'createList with too few arguments',
    `h('div', null, createList(todos, (r) => r.id))`,
    {},
    ['createList(...) was called with 2 argument(s)', 'the whole list is'],
  ],
  [
    'createList with a non-inline map function',
    `h('div', null, createList(todos, keyFn, renderRow))`,
    {},
    ['third argument that is renderRow rather than a function'],
  ],
  [
    'createList with a destructured row parameter',
    `h('div', null, createList(todos, (r) => r.id, ({ name }) => h('li', null, name)))`,
    {},
    ['destructured map parameter', 'name the row parameter'],
  ],
  [
    'createShow branch that is not an h() call',
    `createShow(() => open(), () => renderPanel(), () => h('p', null, 'closed'))`,
    {},
    ['renderPanel'],
    // `open` is in scope, so the condition resolves and the ONLY thing left to
    // report is the branch — which is what "exactly one diagnostic" asserts.
    `const [open] = createSignal(true);`,
  ],
  [
    'unresolvable component',
    `h('div', null, Sidebar())`,
    {},
    ['component Sidebar(...) could not be resolved to a source file', 'resolvable relative component import'],
  ],
  [
    'component past the inlining depth limit',
    `h('div', null, Deep())`,
    {
      resolveComponent: () => ({
        source: `export function Deep() { return h('span', null, 'deep'); }`,
        functionName: 'Deep',
      }),
      depth: 3,
    },
    ['nests deeper than the 3-level inlining limit'],
  ],
  [
    'recursive component',
    `h('div', null, Loop())`,
    {
      resolveComponent: () => ({
        source: `export function Loop() { return h('span', null, 'x'); }`,
        functionName: 'Loop',
      }),
      visited: new Set(['Loop']),
    },
    ['is recursive'],
  ],
  [
    'component passed a non-static prop',
    `h('div', null, Card({ title: computeTitle() }))`,
    {
      resolveComponent: () => ({
        source: `export function Card() { return h('article', null, 'x'); }`,
        functionName: 'Card',
      }),
    },
    ["prop the compiler cannot evaluate ('title')", 'pass literal values'],
  ],
  [
    'component with no followable return',
    `h('div', null, Empty())`,
    {
      resolveComponent: () => ({
        source: `export function Empty() { const x = 1; }`,
        functionName: 'Empty',
      }),
    },
    ['no return statement the compiler can follow'],
  ],
  [
    'island component that will not resolve',
    `h('div', null, LiveChart())`,
    { islandNames: new Set(['LiveChart']) },
    ['component LiveChart(...)', 'refused with BUILD-610'],
  ],
];

/**
 * Degradations in ATTRIBUTE position, which do NOT emit an island.
 *
 * A degraded attribute mints a slot with no default: the element still
 * renders, just without the attribute. That is why this whole class was
 * silent — there is no island shell to notice, and an empty slot is a
 * perfectly well-formed slot. It is also why it is the more dangerous half:
 * a page missing an island is obvious on sight, and a page missing every
 * tooltip is not.
 *
 * [label, source, walk context, fragments the warning must contain, signals]
 */
const ATTR_DEGRADATIONS: Array<[string, string, WalkContext, string[], string?]> = [
  [
    'concatenated attribute with an unresolvable operand',
    `h('button', { title: 'Enable ' + lookupName() })`,
    {},
    [
      "attribute 'title' on <button>",
      "a bare '+' expression",
      'OMITTED from the server-rendered HTML',
      'hydration does not re-apply a non-function prop',
    ],
  ],
  [
    'template-literal attribute with an unresolvable operand',
    'h(\'div\', { class: `card ${tone()}` })',
    {},
    ["attribute 'class' on <div>", 'a template literal'],
  ],
  [
    'attribute bound to an unresolvable call',
    `h('div', { title: computeTitle() })`,
    {},
    ["attribute 'title' on <div>", 'computeTitle(...)'],
  ],
  [
    'style object attribute',
    `h('div', { style: { color: 'red' } })`,
    {},
    ["attribute 'style' on <div>", 'an object literal'],
  ],
  [
    'spread props',
    `h('div', { ...rest }, 'x')`,
    {},
    ['spread props {...rest} on <div>', 'NOT rendered server-side'],
  ],
  [
    'computed prop key',
    `h('div', { [attrName]: 'v' }, 'x')`,
    {},
    ['computed prop key on <div>', 'NOT rendered server-side'],
  ],
  [
    'method-valued prop',
    `h('div', { title() { return 'x'; } }, 'y')`,
    {},
    ["method-valued prop 'title' on <div>"],
  ],
  [
    'props argument that is not an object literal',
    `h('div', props, 'x')`,
    {},
    ['props on <div> passed as props', 'NONE of the attributes'],
  ],
  [
    'dangerouslySetInnerHTML',
    `h('div', { dangerouslySetInnerHTML: { __html: '<b>x</b>' } })`,
    {},
    ['dangerouslySetInnerHTML on <div>', 'the element ships empty'],
  ],
];

describe('build diagnostics', () => {
  describe.each(DEGRADATIONS)('%s', (_label, code, walkCtx, fragments, signals) => {
    it('warns, naming the construct and the consequence', () => {
      const { warnings } = emitWithWarnings(code, walkCtx, signals);

      expect(warnings, 'the degradation must produce exactly one diagnostic')
        .toHaveLength(1);
      for (const fragment of fragments) {
        expect(warnings[0]).toContain(fragment);
      }
    });

    it('refuses with BUILD-610 instead of returning an empty island', () => {
      // The other half of the contract: a diagnostic must correspond to real
      // lost server-side content, or it is noise that trains people to ignore
      // the channel.
      const { refusal, islands, ops } = emitWithWarnings(code, walkCtx, signals);
      expect(refusal).toBeInstanceOf(PropsSchemaError);
      expect(refusal!.code).toBe('BUILD-610');
      expect(islands).toEqual([]);expect(ops).toEqual([]);
    });
  });

  describe.each(ATTR_DEGRADATIONS)('%s', (_label, code, walkCtx, fragments, signals) => {
    it('warns, naming the attribute and the consequence', () => {
      const { warnings } = emitWithWarnings(code, walkCtx, signals);

      expect(warnings, 'the degradation must produce exactly one diagnostic')
        .toHaveLength(1);
      for (const fragment of fragments) {
        expect(warnings[0]).toContain(fragment);
      }
    });

    it('names the file it happened in', () => {
      const { warnings } = emitWithWarnings(
        code,
        { ...walkCtx, sourceFile: 'src/pages/StatusPage.ts' },
        signals,
      );
      expect(warnings[0]).toContain('in src/pages/StatusPage.ts');
    });
  });

  it('names the file, the construct and the consequence', () => {
    const { warnings } = emitWithWarnings(`h('div', null, caption)`, {
      sourceFile: 'src/pages/StatusPage.ts',
    });

    // WHERE / WHAT / SO WHAT — the three things a build warning has to carry
    // to be actionable without opening the compiler.
    expect(warnings[0]).toContain('in src/pages/StatusPage.ts');
    expect(warnings[0]).toContain('caption');
    expect(warnings[0]).toContain('refused with BUILD-610');
  });

  it('reports the resolved component file, not the page that included it', () => {
    const { warnings } = emitWithWarnings(`h('div', null, Panel())`, {
      sourceFile: 'src/pages/HomePage.ts',
      resolveComponent: () => ({
        source: `export function Panel() { return h('section', null, caption); }`,
        functionName: 'Panel',
        path: 'src/components/Panel.ts',
      }),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('in src/components/Panel.ts');
    expect(warnings[0]).not.toContain('HomePage');
  });

  // -------------------------------------------------------------------------
  // 3: negative space — a page the compiler understands says nothing
  // -------------------------------------------------------------------------

  const CLEAN_PAGES: Array<[string, string, WalkContext, string?]> = [
    ['static markup', `h('main', { id: 'app' }, h('h1', null, 'Title'))`, {}],
    [
      'dynamic text and attributes',
      `h('p', { class: () => cls() }, () => body())`,
      {},
      `const [cls] = createSignal('row'); const [body] = createSignal('hi');`,
    ],
    [
      'a void element',
      `h('input', { type: 'search', value: () => q() })`,
      {},
      `const [q] = createSignal('');`,
    ],
    ['an event handler (deliberately skipped)', `h('button', { onClick: () => go() }, 'Go')`, {}],
    ['null / undefined / false children', `h('div', null, null, undefined, false, 'kept')`, {}],
    [
      'a createShow',
      `createShow(() => visible(), () => h('p', null, 'yes'), () => h('p', null, 'no'))`,
      {},
      `const [visible] = createSignal(true);`,
    ],
    [
      'a createList',
      `h('ul', null, createList(todos, (r) => r.id, (r) => h('li', null, r.title)))`,
      {},
    ],
    [
      'an inlined sub-component with literal props',
      `h('div', null, Badge({ label: 'New' }))`,
      {
        resolveComponent: () => ({
          source: `export function Badge(props) { return h('span', null, props.label); }`,
          functionName: 'Badge',
        }),
      },
    ],
    [
      'a resolvable island component',
      `h('div', null, Live())`,
      {
        islandNames: new Set(['Live']),
        resolveComponent: () => ({
          source: `export function Live() { return h('section', null, 'live'); }`,
          functionName: 'Live',
        }),
      },
    ],
    [
      'a concatenated child and attribute the compiler can fold',
      `h('button', { title: 'Enable ' + name() }, 'Player ' + name(), ' #' + count())`,
      {},
      `const [name] = createSignal('Xbox'); const [count] = createSignal(3);`,
    ],
    [
      'an eager expression that folds to nothing the client renders either',
      `h('div', null, ready() && 'Go')`,
      {},
      `const [ready] = createSignal(false);`,
    ],
    [
      'a statically unrolled spread',
      `h('nav', null, ...NAV.map((i) => h('a', { href: i.href }, i.label)))`,
      {
        fileConstants: new Map([
          ['NAV', [{ href: '/', label: 'Home' }, { href: '/about', label: 'About' }]],
        ]),
      },
    ],
  ];

  it.each(CLEAN_PAGES)('stays silent for %s', (_label, code, walkCtx, signals) => {
    const { warnings, islands, refusal } = emitWithWarnings(code, walkCtx, signals);
    expect(refusal).toBeUndefined();
    expect(warnings).toEqual([]);
    // …and stayed silent because it compiled, not because it emitted nothing.
    if (_label !== 'a resolvable island component') {
      expect(islands).toEqual([]);
    }
  });

  // -------------------------------------------------------------------------
  // 4: completeness — no fallback path may skip the diagnostic
  // -------------------------------------------------------------------------

  /**
   * The island half of this contract is checked statically below, because an
   * island shell is a call site you can grep for. The ATTRIBUTE half cannot
   * be: a degraded attribute is just a slot whose default bytes are empty,
   * produced by the same `addSlot` line as a healthy one. So it is checked
   * behaviourally instead — over every expression form that can appear in an
   * attribute value, evaluable and not.
   *
   * The property: an attribute that will be MISSING from the server-rendered
   * HTML must have been reported. This is the rule the walker broke for the
   * entire `+`/template/call/member/object family, and the reason ksx shipped
   * controls with no tooltips and a clean build log.
   */
  it('never leaves an attribute empty without saying so', () => {
    const SIGNALS = `const [name] = createSignal('Xbox'); const [count] = createSignal(3);`;
    const VALUES = [
      // evaluable — must produce a default and stay silent
      `'Enable ' + name()`,
      `'Slot ' + count() + ' ready'`,
      `count() + 1`,
      '`Enable ${name()}`',
      `name()`,
      `String(count())`,
      `count() > 1 ? 'many' : 'one'`,
      `('x' + name()) as string`,
      // not evaluable — must warn
      `'Enable ' + missing()`,
      '`x ${missing()}`',
      `missing()`,
      `missing`,
      `obj.field`,
      `{ color: 'red' }`,
      `['a', 'b']`,
      `new Date()`,
      `missing ? 'a' : 'b'`,
      `count() == 3`,
    ];

    const silentlyEmpty: string[] = [];
    for (const value of VALUES) {
      const { warnings, slots } = emitWithWarnings(
        `h('div', { title: ${value} })`,
        {},
        SIGNALS,
      );
      const attr = slots.find((s) => s.name === 'attr:title');
      // No attr slot at all means the value folded to null/false, which is an
      // absent attribute on the client too — not a degradation.
      if (attr && attr.default === '' && warnings.length === 0) {
        silentlyEmpty.push(value);
      }
    }

    expect(
      silentlyEmpty,
      'these attribute values ship with no value and no diagnostic',
    ).toEqual([]);
  });

  it('has no legacy empty-island writer and explicitly throws on unsupported native content',()=>{
    const source=readFileSync(resolve(__dirname,'../src/ir-walk.ts'),'utf8');
    expect(source).not.toMatch(/function emit(?:BrowserOnly)?Island\(/);
    expect(source).toMatch(/function refuseIsland[\s\S]*?throw new PropsSchemaError/);
  });

  // -------------------------------------------------------------------------
  // Signal defaults — the ledger #9 class
  // -------------------------------------------------------------------------

  describe('signal defaults', () => {
    function extract(source: string) {
      const warnings: string[] = [];
      const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args.join(' '));
      });
      try {
        const defaults = collectSignalDeclarations(
          parse(source, { sourceType: 'module', plugins: ['typescript'] })
            .program.body as T.Statement[],
          { filePath: 'src/StatusIsland.ts' },
        );
        return { warnings, defaults };
      } finally {
        spy.mockRestore();
      }
    }

    it('retains an empty aggregate signal default without a retired note', () => {
      const { warnings, defaults } = extract(
        `import { createSignal } from 'formajs';
         export const [rows, setRows] = createSignal([]);
         export function StatusPanel() { return null; }`,
      );

      expect(defaults.get('rows')).toMatchObject({type:'aggregate',default:[]});
      expect(warnings).toEqual([]);
    });

    it('stays silent for every default it can evaluate', () => {
      const { warnings, defaults } = extract(
        `import { createSignal } from 'formajs';
         export const [label, setLabel] = createSignal('idle');
         export const [count, setCount] = createSignal(0);
         export const [busy, setBusy] = createSignal(false);
         export const [sel, setSel] = createSignal(null);`,
      );

      expect(warnings).toEqual([]);
      expect([...defaults.keys()].sort()).toEqual(['busy', 'count', 'label', 'sel']);
    });
  });
});
