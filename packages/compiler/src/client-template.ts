/** Closed JSX lowering for the compiler-only core entry. Native IR reads original source. */
import { parse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { readFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import type { BuildOptions, Plugin } from 'esbuild';
import { transformJsxNamespaces } from '../../shared/jsx-namespace.mjs';
import { applySourceEdits, type SourceEdit } from './source-edits';
const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;
const setups = new WeakSet<Plugin['setup']>();
export const clientTemplatesEnabled = (options: BuildOptions): boolean => (options.plugins ?? []).some(plugin => setups.has(plugin.setup));
export interface ClientTemplateOptions { filename?: string; factory?: string; runtime?: string }
type Binding = [path: number[], kind: 0 | 1 | 2, key?: string];
const tags = new Set('div span section article main header footer nav aside p h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tfoot tr td th a button strong em b i small br hr'.split(' '));
const voidTags = new Set(['br', 'hr']);
const blockTags = new Set('div section article main header footer nav aside p h1 h2 h3 h4 h5 h6 ul ol li table hr'.split(' '));
const safeAttribute = (name: string): boolean => ['class', 'className', 'id', 'title', 'role'].includes(name) || /^(?:data|aria)-[a-z][a-z0-9-]*$/.test(name);
// These literals need the ordinary writer's normalization; do not invent a second policy.
const safeLiteral = (text: string): boolean => !/[\r\0\uD800-\uDFFF]/.test(text);
const escape = (text: string): string => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
function scalar(node: t.Node): string | null | undefined {
  if (t.isStringLiteral(node)) return safeLiteral(node.value) ? node.value : undefined;
  if (t.isNumericLiteral(node)) return String(node.value);
  if (t.isBooleanLiteral(node) || t.isNullLiteral(node)) return null;
  return undefined;
}
function coreImport(path: NodePath, name: string, imported: string): boolean {
  const binding = path.scope.getBinding(name), spec = binding?.path;
  return !!spec?.isImportSpecifier() && t.isIdentifier(spec.node.imported, { name: imported })
    && spec.parentPath.isImportDeclaration() && spec.parentPath.node.source.value === '@getforma/core';
}


// Only the direct render callback of a core createList overload is repeated by
// contract. Named helpers, nested functions and unrelated calls stay ordinary.
function listRenderer(path: NodePath<t.JSXElement>): boolean {
  const callback = path.getFunctionParent();
  if (!callback || !callback.isArrowFunctionExpression() && !callback.isFunctionExpression()
    || callback.node.async || callback.node.generator) return false;
  const call = callback.parentPath;
  if (!call?.isCallExpression() || !t.isIdentifier(call.node.callee)
    || call.node.arguments.some(argument => t.isSpreadElement(argument))) return false;
  const count = call.node.arguments.length;
  const at = count === 2 ? 1 : count === 3 || count === 4 ? 2 : -1;
  return at >= 0 && call.node.arguments[at] === callback.node
    && coreImport(call, call.node.callee.name, 'createList');
}

// Moving a direct await/yield into the synchronous initializer would change its
// execution context. Bodies of nested functions remain deferred and unchanged.
function requiresOuterExecution(node: t.Node): boolean {
  if (t.isFunction(node)) return false;
  if (t.isAwaitExpression(node) || t.isYieldExpression(node)) return true;
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const value = (node as any)[key];
    if (Array.isArray(value) ? value.some(child => child && requiresOuterExecution(child))
      : value && requiresOuterExecution(value)) return true;
  }
  return false;
}

/** Unsupported trees retain ordinary h() semantics; no native admission rule is relaxed. */
export function transformClientTemplates(source: string, options: ClientTemplateOptions = {}): string {
  if ((options.runtime ?? 'transform') !== 'transform' || !source.includes('<')) return source;
  const factory = options.factory ?? 'h';
  if (!/^[A-Za-z_$][\w$]*$/.test(factory)) return source;
  let ast: t.File;
  try { ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }); }
  catch { return source; } // The owning esbuild parser retains its source diagnostic.
  if ((ast.comments ?? []).some(c => /@jsx(?:Runtime|ImportSource)\b/.test(c.value)
    || [...c.value.matchAll(/@jsx\s+([^\s*]+)/g)].some(m => m[1] !== factory))) return source;
  const names = new Set<string>();
  traverse(ast, { Identifier(path) { names.add(path.node.name); }, JSXIdentifier(path) { names.add(path.node.name); } });
  const unique = (base: string): string => { let name = base; while (names.has(name)) name += '_'; names.add(name); return name; };
  const helper = unique('__formaCreateTemplate'), trusted = unique('__formaTrustedHtml');
  const declarations: string[] = [], edits: SourceEdit[] = [];
  traverse(ast, { JSXElement(path) {
    if (!coreImport(path, factory, 'h') || !listRenderer(path)) return;
    const root = path.node, bindings: Binding[] = [], stages: string[] = [];
    const binder = unique('__formaBind');
    let elements = 0;
    const capture = (node: t.Node, address: number[], kind: 0 | 1 | 2, key: string | undefined, local: string[]): boolean => {
      if (requiresOuterExecution(node)) return false;
      const index = bindings.length, value = unique('__formaValue');
      stages.push(`const ${value} = (${source.slice(node.start!, node.end!)});`);
      bindings.push(key === undefined ? [address, kind] : [address, kind, key]);
      local.push(`${binder}(${index}, ${value});`);
      return true;
    };
    const emit = (node: t.JSXElement, address: number[], ancestors: string[]): string | undefined => {
      const opening = node.openingElement;
      if (!t.isJSXIdentifier(opening.name) || !tags.has(opening.name.name)) return;
      const tag = opening.name.name, parent = ancestors.at(-1);
      if (/^h[1-6]$/.test(tag) && ancestors.some(name => /^h[1-6]$/.test(name))
        || ancestors.includes('p') && blockTags.has(tag) || tag === 'a' && ancestors.includes('a')
        || tag === 'button' && ancestors.some(name => name === 'a' || name === 'button')
        || tag === 'a' && ancestors.includes('button') || tag === 'li' && ancestors.includes('li')) return;
      const tableChildren: Record<string, string[]> = { table: ['thead', 'tbody', 'tfoot'], thead: ['tr'], tbody: ['tr'], tfoot: ['tr'], tr: ['td', 'th'] };
      if (parent && tableChildren[parent] && !tableChildren[parent]!.includes(tag)) return;
      if (['thead', 'tbody', 'tfoot'].includes(tag) && parent && parent !== 'table'
        || tag === 'tr' && parent && !['thead', 'tbody', 'tfoot'].includes(parent)
        || ['td', 'th'].includes(tag) && parent && parent !== 'tr') return;
      elements++;
      let html = `<${tag}`;
      const local: string[] = [];
      const seen = new Set<string>();
      for (const attr of opening.attributes) {
        if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name) || !attr.value) return;
        const key = attr.name.name, canonical = key === 'className' ? 'class' : key;
        if (seen.has(canonical)) return; seen.add(canonical);
        const expression = t.isJSXExpressionContainer(attr.value) ? attr.value.expression : attr.value;
        if (t.isJSXEmptyExpression(expression)) return;
        if (key === 'onClick') {
          if (!t.isArrowFunctionExpression(expression) && !t.isFunctionExpression(expression)) return;
          if (!capture(expression, address, 2, key, local)) return; continue;
        }
        if (!safeAttribute(key)) return;
        if (t.isStringLiteral(expression)) {
          if (!safeLiteral(expression.value)) return;
          html += ` ${canonical}="${escape(expression.value)}"`;
        } else if (t.isNumericLiteral(expression)) html += ` ${canonical}="${expression.value}"`;
        else if (!capture(expression, address, 0, key, local)) return;
      }
      const children = t.react.buildChildren(node);
      if (voidTags.has(tag)) { if (children.length) return; stages.push(...local); return html + '>'; }
      html += '>';
      if (children.length === 1 && !t.isJSXElement(children[0]!) && !t.isJSXFragment(children[0]!) && scalar(children[0]!) === undefined) {
        // A sole dynamic child owns the complete target element, so core can
        // preserve scalar/Node/array transitions through its existing writer.
        if (tableChildren[tag] || t.isStringLiteral(children[0]) || children[0]!.start == null || children[0]!.end == null) return;
        if (!capture(children[0]!, address, 1, undefined, local)) return;
      } else {
        let index = 0, previousText = false;
        for (const child of children) {
          if (t.isJSXElement(child)) {
            const nested = emit(child, [...address, index], [...ancestors, tag]);
            if (nested === undefined) return;
            html += nested; index++; previousText = false;
          } else {
            const text = scalar(child);
            if (text === undefined || tableChildren[tag] && text !== null && text.trim() !== '') return;
            if (text === null || text === '') continue;
            html += escape(text); if (!previousText) index++; previousText = true;
          }
        }
      }
      // h evaluates a node's props, then its children (including their initial
      // effects), and only then applies this node's props and child bindings.
      stages.push(...local);
      return html + `</${tag}>`;
    };
    const html = emit(root, [], []);
    if (html === undefined || elements < 2) return;
    const name = unique('__formaTemplate');
    declarations.push(`const ${name} = /* @__PURE__ */ ${helper}(() => ${trusted}(${JSON.stringify(html)}), ${JSON.stringify(bindings)});`);
    const original = source.slice(root.start!, root.end!);
    const call = `${name}((${binder}) => { if (!${binder}) return (${original}); ${stages.join(' ')} })`;
    // A child of an unsupported JSX parent is still in JSX syntax. Preserve
    // its expression boundary rather than turning the call into literal text.
    const jsxSlot = path.parentPath.isJSXElement() || path.parentPath.isJSXFragment() || path.parentPath.isJSXAttribute();
    edits.push({ start: root.start!, end: root.end!, text: jsxSlot ? `{${call}}` : call });
    path.skip();
  } });
  if (!edits.length) return source;
  const at = ast.program.directives.at(-1)?.end ?? ast.program.interpreter?.end ?? 0;
  edits.push({ start: at, end: at, text: `\nimport { __createCompiledTemplate as ${helper} } from '@getforma/core/compiled';\nimport { trustedHtml as ${trusted} } from '@getforma/core';\n${declarations.join('\n')}\n` });
  return applySourceEdits(source, edits);
}

/** Explicit optimizer; SSR participants compose it after their original-coordinate edits. */
export function formaClientPlugin(): Plugin {
  const plugin: Plugin = { name: 'forma-client-templates', setup(build) {
    const captured = new Map<string, string>();
    const options = { factory: build.initialOptions.jsxFactory ?? 'React.createElement', runtime: build.initialOptions.jsx };
    build.onStart(() => { captured.clear(); });
    build.onLoad({ filter: /\.[jt]sx$/, namespace: 'file' }, args => {
      if (args.path.split(/[\\/]/).includes('node_modules')) return;
      const original = readFileSync(args.path, 'utf8');
      const contents = transformClientTemplates(transformJsxNamespaces(original, options), { ...options, filename: args.path });
      if (contents === original) return;
      captured.set(args.path, original);
      return { contents, loader: extname(args.path) === '.tsx' ? 'tsx' : 'jsx', resolveDir: dirname(args.path), watchFiles: [args.path] };
    });
    build.onEnd(result => {
      if (result.errors.length) return;
      for (const [file, source] of captured) {
        try { if (readFileSync(file, 'utf8') === source) continue; } catch { /* removed input also invalidates publication */ }
        return { errors: [{ text: `BUILD-610 JSX source changed while compiling ${file}; retry to publish one source generation` }] };
      }
    });
  } };
  setups.add(plugin.setup); return plugin;
}
