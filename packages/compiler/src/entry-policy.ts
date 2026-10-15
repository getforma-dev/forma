import { parse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;

/** A finite entry rewrite must never guess about a used return or side effect. */
export class EntryPolicyError extends Error {
  readonly code = 'BUILD-611';
  constructor(readonly file: string, readonly line: number, readonly column: number, detail: string) {
    super(`BUILD-611 ${file}:${line}:${column}: ${detail}`);
    this.name = 'EntryPolicyError';
  }
}
export function refuseEntry(file: string, node: t.Node, detail: string): never {
  throw new EntryPolicyError(file, node.loc?.start.line ?? 1, (node.loc?.start.column ?? 0) + 1, detail);
}

/** Authenticate the actual lexical named import, including aliases and shadowing. */
export function isCoreCall(path: NodePath<t.CallExpression>, exported: string): boolean {
  if (!t.isIdentifier(path.node.callee)) return false;
  const binding = path.scope.getBinding(path.node.callee.name), declaration = binding?.path.node;
  if (!binding?.constant || !t.isImportSpecifier(declaration) || declaration.importKind === 'type') return false;
  const name = t.isIdentifier(declaration.imported) ? declaration.imported.name : declaration.imported.value;
  const owner = binding.path.parentPath?.node;
  return name === exported && t.isImportDeclaration(owner) && owner.importKind !== 'type'
    && ['@getforma/core', 'formajs'].includes(owner.source.value);
}

export interface EntryMount {
  readonly start: number;
  readonly end: number;
}

/** Only standalone, unconsumed core mount expressions may be compile-time roots. */
export function inspectEntryMounts(source: string, file: string): EntryMount | undefined {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const mounts: EntryMount[] = [];
  const erased = (reference: NodePath): boolean => !!reference.findParent(parent =>
    t.isTSType(parent.node) || (t.isExportNamedDeclaration(parent.node) && parent.node.exportKind === 'type')
    || (t.isExportSpecifier(parent.node) && parent.node.exportKind === 'type'));
  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.importKind === 'type' || !['@getforma/core', 'formajs'].includes(path.node.source.value)) return;
      for (const specifier of path.node.specifiers) {
        if (t.isImportNamespaceSpecifier(specifier)) {
          const binding = path.scope.getBinding(specifier.local.name);
          for (const reference of binding?.referencePaths ?? []) {
            if (erased(reference)) continue;
            const member = reference.parentPath?.node;
            if (!binding?.constant || !(t.isMemberExpression(member) || t.isOptionalMemberExpression(member))
              || member.object !== reference.node) refuseEntry(file, reference.node,
              'a core namespace may only use known non-mount members in a native entry; do not alias, destructure, export or pass the namespace');
            const name = member.computed ? (t.isStringLiteral(member.property) ? member.property.value : undefined)
              : (t.isIdentifier(member.property) ? member.property.name : undefined);
            if (name === undefined) refuseEntry(file, member,
              'dynamic core namespace access may reach mount; use a statically named non-mount member or a named core import');
            if (name === 'mount') refuseEntry(file, member,
              'the compile-time mount needs a named core import (an import alias is supported), not a namespace member');
          }
          continue;
        }
        if (!t.isImportSpecifier(specifier) || specifier.importKind === 'type') continue;
        const name = t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value;
        if (name !== 'mount') continue;
        const binding = path.scope.getBinding(specifier.local.name);
        for (const reference of binding?.referencePaths ?? []) {
          if (erased(reference)) continue;
          if (!binding?.constant || !reference.parentPath?.isCallExpression()
            || reference.parentPath.node.callee !== reference.node) refuseEntry(file, reference.node,
            'the core mount import must be called directly as the compile-time root; do not alias, pass, export or optionally call it');
        }
      }
    },
    CallExpression(path) {
      if (isCoreCall(path, 'activateIslands') && path.findParent(parent => parent.isCallExpression() && isCoreCall(parent, 'mount'))) {
        refuseEntry(file, path.node, 'island activation must be outside the removed compile-time page mount');
      }
      if (!isCoreCall(path, 'mount')) return;
      if (!path.parentPath.isExpressionStatement() || !path.parentPath.parentPath?.isProgram()) {
        refuseEntry(file, path.node, 'the selected core mount must be a standalone top-level expression; do not assign, export, nest or use its return');
      }
      if (mounts.length) refuseEntry(file, path.node, 'multiple core mounts make the native page ambiguous; use one explicit SSR entry per page');
      if (path.node.arguments.length < 1 || path.node.arguments.length > 2
        || path.node.arguments.some(argument => t.isSpreadElement(argument))) {
        refuseEntry(file, path.node, 'the compile-time mount needs a component and an optional pure target, without extra or spread arguments');
      }
      const target = path.get('arguments.1') as NodePath | undefined;
      if (path.node.arguments.length === 2 && !target?.isPure()) {
        refuseEntry(file, path.node.arguments[1]!, 'the removed mount target must be a pure expression; move required effects outside the compile-time invocation');
      }
      mounts.push({ start: path.parentPath.node.start!, end: path.parentPath.node.end! });
    },
  });
  return mounts[0];
}
