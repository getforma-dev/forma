import ts from 'typescript';

/** Every deployment identifier must be free and read only behind its typeof guard. */
export function checkBuildIdentity(code, required = false) {
  const source = ts.createSourceFile('artifact.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const allowed = new Set();
  const reads = [];
  const flag = node => ts.isIdentifier(node) && node.text === '__FORMA_BUILD__';
  const string = node => ts.isStringLiteral(node) && node.text === 'string';
  function visit(node) {
    if (flag(node)) reads.push(node);
    if (ts.isConditionalExpression(node) && ts.isBinaryExpression(node.condition)
      && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken].includes(node.condition.operatorToken.kind)
      && flag(node.whenTrue) && ts.isStringLiteral(node.whenFalse) && node.whenFalse.text === '') {
      const { left, right } = node.condition;
      const tested = ts.isTypeOfExpression(left) && string(right) ? left.expression
        : ts.isTypeOfExpression(right) && string(left) ? right.expression : null;
      if (tested && flag(tested)) { allowed.add(tested); allowed.add(node.whenTrue); }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (required && reads.length === 0) return 'deployment identity guard was folded away';
  if (reads.some(node => !allowed.has(node))) return 'deployment identity is bound or read outside its typeof guard';
  return null;
}
