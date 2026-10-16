/**
 * The island-emitter family of the corpus (step 1): the declared island fixtures of
 * `crates/forma-ir/tests/fixtures/island-emitter/`, whose TypeScript sources are written inline in
 * `packages/compiler/tests/island-emission.test.ts` (its `emit(name, page, island, tsx?)` helper
 * writes `page.ts`, `island.ts` and `app.ts` to a temporary folder and compiles them).
 *
 * The harness rebuilds each case's three files exactly as that helper does, by reading the test's
 * syntax tree: the `core` import line, the helper's `app.ts` source, and each `emit` call's page and
 * island sources (string literals, local `const` strings and template literals over them). Nothing
 * is executed. A case counts only if its `.ir` is committed (the refusal cases have none). The
 * rebuilt files are then compiled like any corpus module, and the suite's pairing check (the
 * compiler's `.ir` for them must equal the committed one) proves the rebuild exact, byte for byte.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from '@babel/parser';

type Node = { type: string; [key: string]: unknown };
const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && typeof (value as Node).type === 'string';

export interface EmitterCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
}

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue;
    if (Array.isArray(value)) for (const item of value) { if (isNode(item)) out.push(item); }
    else if (isNode(value)) out.push(value);
  }
  return out;
}

/** The value of a string expression: literals, templates, `+`, and `const` names declared in `scope`. */
function evaluate(node: Node, scope: ReadonlyMap<string, Node>, depth = 0): string {
  if (depth > 20) throw new Error('island-emitter: constant chain too deep');
  switch (node.type) {
    case 'StringLiteral': return node.value as string;
    case 'TemplateLiteral': {
      const quasis = node.quasis as Node[], expressions = node.expressions as Node[];
      let out = '';
      quasis.forEach((quasi, i) => {
        const cooked = (quasi.value as { cooked: string | null }).cooked;
        if (cooked === null) throw new Error('island-emitter: a template with an invalid escape');
        out += cooked;
        if (i < expressions.length) out += evaluate(expressions[i]!, scope, depth + 1);
      });
      return out;
    }
    case 'BinaryExpression':
      if (node.operator !== '+') break;
      return evaluate(node.left as Node, scope, depth + 1) + evaluate(node.right as Node, scope, depth + 1);
    case 'Identifier': {
      const init = scope.get(node.name as string);
      if (!init) throw new Error(`island-emitter: ${String(node.name)} is not a string constant in scope`);
      return evaluate(init, scope, depth + 1);
    }
  }
  throw new Error(`island-emitter: cannot read a ${node.type} as a constant string`);
}

/** `const` string declarations visible in a block (only string-shaped initializers). */
function constants(nodes: readonly Node[], into: Map<string, Node>): void {
  for (const node of nodes) {
    if (node.type !== 'VariableDeclaration' || node.kind !== 'const') continue;
    for (const declarator of node.declarations as Node[]) {
      const id = declarator.id as Node, init = declarator.init as Node | null;
      if (id.type === 'Identifier' && init && ['StringLiteral', 'TemplateLiteral', 'BinaryExpression', 'Identifier'].includes(init.type)) into.set(id.name as string, init);
    }
  }
}

/** Every case the test compiles with a committed `.ir`, with its three files as the helper writes them. */
export function readEmitterCases(testFile: string, irDir: string): EmitterCase[] {
  const program = parse(readFileSync(testFile, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] }).program as unknown as Node;
  const top = new Map<string, Node>();
  constants(program.body as Node[], top);
  if (!top.has('core')) throw new Error(`${testFile}: no top-level const core`);
  const core = evaluate(top.get('core')!, top);
  // The helper itself: its `sources` object gives the app.ts source and the page file's name rule.
  const helper = (program.body as Node[]).find(node => node.type === 'FunctionDeclaration' && (node.id as Node | null)?.name === 'emit');
  if (!helper) throw new Error(`${testFile}: no emit helper`);
  let app: string | undefined;
  const visit = (node: Node, fn: (node: Node) => void): void => { fn(node); for (const child of children(node)) visit(child, fn); };
  visit(helper, node => {
    if (node.type !== 'ObjectProperty') return;
    const key = node.key as Node;
    if (key.type === 'StringLiteral' && key.value === 'app.ts') app = evaluate(node.value as Node, top);
  });
  if (app === undefined) throw new Error(`${testFile}: the emit helper writes no app.ts`);
  const cases = new Map<string, EmitterCase>();
  // Walk with the constants of each enclosing function body in scope.
  const walk = (node: Node, scope: Map<string, Node>): void => {
    let inner = scope;
    const body = node.body as Node | Node[] | undefined;
    if ((node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') && isNode(body) && body.type === 'BlockStatement') {
      inner = new Map(scope);
      constants(body.body as Node[], inner);
    }
    if (node.type === 'CallExpression' && (node.callee as Node).type === 'Identifier' && (node.callee as Node).name === 'emit') {
      const args = node.arguments as Node[];
      const name = args[0]?.type === 'StringLiteral' ? args[0].value as string : undefined;
      if (name && !cases.has(name) && existsSync(join(irDir, `${name}.ir`))) {
        const tsx = args[3]?.type === 'BooleanLiteral' ? args[3].value === true : false;
        cases.set(name, { name, files: { [tsx ? 'page.tsx' : 'page.ts']: core + evaluate(args[1]!, inner), 'island.ts': core + evaluate(args[2]!, inner), 'app.ts': app! } });
      }
    }
    for (const child of children(node)) walk(child, inner);
  };
  walk(program, top);
  return [...cases.values()];
}

let scratch: string | undefined;

/** Write a case's files to this process's scratch folder (removed at exit) and return the folder. */
export function materialize(item: EmitterCase): string {
  if (!scratch) {
    scratch = mkdtempSync(join(tmpdir(), 'forma-parity-emitter-'));
    const made = scratch;
    process.once('exit', () => rmSync(made, { recursive: true, force: true }));
  }
  const dir = resolve(scratch, item.name);
  mkdirSync(dir, { recursive: true });
  for (const [file, source] of Object.entries(item.files)) writeFileSync(join(dir, file), source);
  return dir;
}
