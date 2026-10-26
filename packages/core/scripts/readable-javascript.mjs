import ts from 'typescript';

/**
 * Remove descriptive comments without shifting any source-map position.
 * Verified by: src/__tests__/readable-javascript.test.ts > "removes only descriptive comments while preserving behavior and every token position"
 * @param {string} code
 * @returns {string}
 */
export function stripDeliveryComments(code) {
  const source = ts.createSourceFile('artifact.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const ranges = new Map();
  const retain = /@license|@preserve|copyright|^\/\*!|SPDX-|sourceMappingURL|sourceURL|[@#]__[A-Z_]+__/i;
  const visit = (node) => {
    for (const position of [node.pos, node.end]) {
      const comments = [
        ...ts.getLeadingCommentRanges(code, position) ?? [],
        ...ts.getTrailingCommentRanges(code, position) ?? [],
      ];
      for (const { pos, end } of comments) {
        if (!retain.test(code.slice(pos, end))) ranges.set(pos, end);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) {
    code = code.slice(0, start) + code.slice(start, end).replace(/[^\r\n]/g, ' ') + code.slice(end);
  }
  return code;
}
