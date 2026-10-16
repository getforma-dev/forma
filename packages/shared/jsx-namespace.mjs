// Private build-time source edits, bundled into compiler and build. No core API.
import {parse} from '@babel/parser';

const dual = new Set(['a', 'title', 'script', 'style', 'font']);
const svgHtml = new Set(['foreignObject', 'desc', 'title']);
const mathHtml = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);
const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);
function children(node) {
  return Object.entries(node).filter(([key]) => !['loc', 'start', 'end', 'comments', 'tokens', 'extra'].includes(key))
    .flatMap(([,value]) => Array.isArray(value) ? value : [value]).filter(value => value && typeof value === 'object' && typeof value.type === 'string');
}
function bindingHasH(node) {
  if (!node) return false;
  if (node.type === 'Identifier') return node.name === 'h';
  if (node.type === 'ObjectProperty') return bindingHasH(node.value);
  if (node.type === 'AssignmentPattern') return bindingHasH(node.left);
  return children(node).some(bindingHasH);
}

/** Only lexical SVG dual-use creation changes; original spans compose with adoption hooks. */
export function collectJsxNamespaceEdits(source, options = {}) {
  if ((options.runtime ?? 'transform') !== 'transform') return [];
  if (!source.includes('<')) return [];
  let ast;
  try { ast = parse(source, {sourceType:'module', plugins:['typescript','jsx']}); }
  catch { return []; } // The owning parser still reports invalid source normally.
  const comments = ast.comments ?? [];
  const pragmas = comments.flatMap(comment => [...comment.value.matchAll(/@jsx\s+([^\s*]+)/g)].map(match => ({comment, match})));
  if (pragmas.some(({match}) => match[1] !== 'h') || comments.some(comment => /@jsx(?:Runtime|ImportSource)\b/.test(comment.value))) return [];
  if (!pragmas.length && (options.factory ?? 'h') !== 'h') return [];
  const imported = ast.program.body.find(node => node.type === 'ImportDeclaration' && ['@getforma/core','formajs'].includes(node.source.value)
    && node.specifiers.some(specifier => specifier.type === 'ImportSpecifier' && specifier.local.name === 'h' && (specifier.imported.name ?? specifier.imported.value) === 'h'));
  if (!imported) return []; // Preserve an authored or external custom h factory.

  const identifiers = new Set(), selected = [], seen = new Set();
  const scan = node => {if (node.type === 'Identifier' || node.type === 'JSXIdentifier') identifiers.add(node.name);for (const child of children(node)) scan(child);};
  scan(ast.program);
  // A custom inner h binding has its own JSX semantics. Keep the complete file
  // unchanged rather than capture the module h from that scope in our factory.
  let shadowed = false;
  const bindings = node => {
    if (node.type === 'VariableDeclarator' && bindingHasH(node.id)) shadowed = true;
    if (functionTypes.has(node.type) && (bindingHasH(node.id) || node.params.some(bindingHasH))) shadowed = true;
    if (['ClassDeclaration','ClassExpression'].includes(node.type) && bindingHasH(node.id)) shadowed = true;
    if (node.type === 'CatchClause' && bindingHasH(node.param)) shadowed = true;
    for (const child of children(node)) bindings(child);
  };
  bindings(ast.program);if (shadowed) return [];
  function visit(node, namespace = 'html') {
    if (node.type === 'JSXElement') {
      const opening = node.openingElement, name = opening.name.type === 'JSXIdentifier' ? opening.name.name : null;
      const intrinsic = name && /^[a-z]/.test(name);
      const own = name === 'svg' ? 'svg' : name === 'math' ? 'math' : intrinsic ? namespace : 'html';
      if (own === 'svg' && dual.has(name)) {
        selected.push({name, node:opening.name});
        if (node.closingElement) selected.push({name,node:node.closingElement.name});
        seen.add(name);
      }
      // Attribute expressions are values, not descendants of this element.
      for (const attribute of opening.attributes) visit(attribute, 'html');
      let content = own;
      if (own === 'svg' && svgHtml.has(name)) content = 'html';
      if (own === 'math' && mathHtml.has(name)) content = 'html';
      if (own === 'math' && name === 'annotation-xml') {
        const encoding = opening.attributes.find(attribute => attribute.type === 'JSXAttribute' && attribute.name.name === 'encoding');
        const value = encoding?.value?.type === 'StringLiteral' ? encoding.value.value
          : encoding?.value?.type === 'JSXExpressionContainer' && encoding.value.expression.type === 'StringLiteral' ? encoding.value.expression.value : undefined;
        if (/^(text\/html|application\/xhtml\+xml)$/i.test(value ?? '')) content = 'html';
      }
      for (const child of node.children) visit(child, content);
      return;
    }
    // Separately declared component bodies retain their existing runtime context.
    for (const child of children(node)) visit(child, functionTypes.has(node.type) ? 'html' : namespace);
  }
  visit(ast.program);
  if (!selected.length) return [];
  const unique = stem => {let name=stem;for(let i=1;identifiers.has(name);i++)name=stem+i;identifiers.add(name);return name;};
  const factory=unique('__formaJsx'), svg=unique('__formaSvg'), tags=unique('__formaSvgTags');
  const edits=selected.map(({name,node})=>({start:node.start,end:node.end,text:`${tags}.${name}`}));
  for (const {comment,match} of pragmas) {
    const start=comment.start+2+match.index+match[0].lastIndexOf('h');
    edits.push({start,end:start+1,text:factory});
  }
  const names=[...seen].sort();
  const prefix=pragmas.length?'':`/** @jsx ${factory} */\n`;
  const helper=`\n${prefix}import {svg as ${svg}} from ${JSON.stringify(imported.source.value)};\nconst ${tags}={${names.map(name=>`${name}:Symbol()`).join(',')}};\nfunction ${factory}(tag,props,...children){\n${names.map(name=>`if(tag===${tags}.${name})return ${svg}(()=>h(${JSON.stringify(name)},props,...children));`).join('\n')}\nreturn h(tag,props,...children);\n}\n`;
  const at=ast.program.directives.at(-1)?.end ?? (ast.program.interpreter ? ast.program.interpreter.end : 0);
  edits.push({start:at,end:at,text:helper});
  return edits;
}

/** Browser-only sources use the same collector without a second parse or loader. */
export function transformJsxNamespaces(source, options = {}) {
  const edits=collectJsxNamespaceEdits(source, options).sort((a,b)=>a.start-b.start||a.end-b.end);
  let contents=source;
  for(let i=edits.length-1;i>=0;i--){const edit=edits[i];contents=contents.slice(0,edit.start)+edit.text+contents.slice(edit.end);}
  return contents;
}
