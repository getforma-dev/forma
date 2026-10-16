/** Native spelling must agree with core's creation/adoption policy. Both
 * packages pin these exact aliases against parity/attribute-aliases.json. */
export function attributeName(name:string):string {
  return name==='className'?'class':name==='htmlFor'?'for':name==='tabIndex'?'tabindex':name;
}

/** HTML tokenization folds ASCII attribute names before SVG/MathML namespace
 * adjustments. This is only a duplicate key; never rewrite emitted spelling.
 * https://html.spec.whatwg.org/multipage/parsing.html#attribute-name-state */
export function attributeCollisionKey(name:string):string {
  return attributeName(name).replace(/[A-Z]/g,char=>char.toLowerCase());
}

export type AttributeNamespace='html'|'svg'|'math';
// HTML parser adjustments, not a new runtime alias table. The lowercase
// token must reconstruct the exact browser-created foreign attribute name.
// https://html.spec.whatwg.org/multipage/parsing.html#adjust-svg-attributes
const svgAdjusted=new Map('attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits diffuseConstant edgeMode filterUnits glyphRef gradientTransform gradientUnits kernelMatrix kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant specularExponent spreadMethod startOffset stdDeviation stitchTiles surfaceScale systemLanguage tableValues targetX targetY textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan'.split(' ').map(name=>[name.toLowerCase(),name]));
const xlinkAdjusted=new Set('actuate arcrole href role show title type'.split(' ').map(name=>`xlink:${name}`));
const xmlAdjusted=new Set(['xml:lang','xml:space','xmlns','xmlns:xlink']);

/** Return a refusal explanation if parser and current core disagree. This
 * lexical check does not replace the downstream ASCII safe-name policy. */
export function foreignAttributeMismatch(raw:string,namespace:AttributeNamespace):string|undefined {
  const name=attributeName(raw),token=attributeCollisionKey(raw);
  if(namespace==='html')return name.startsWith('xlink:')
    ?`attribute ${raw} has an XLink namespace in Browser creation but no namespace in native HTML; use an ordinary attribute or Browser mode`:undefined;
  const parsed=namespace==='svg'?(svgAdjusted.get(token)??token):token==='definitionurl'?'definitionURL':token;
  if(parsed!==name)return `attribute ${raw} parses as ${parsed} in ${namespace}; use the canonical spelling ${parsed} or Browser mode`;
  // Current core assigns the XLink namespace for every exact xlink: prefix,
  // while HTML parsing recognizes only this finite list. Core does not assign
  // XML/XMLNS namespaces, so those parser-adjusted forms are unsupported.
  if(name.startsWith('xlink:')&&!xlinkAdjusted.has(name)||xmlAdjusted.has(token))return `attribute ${raw} has different parser and Browser namespaces in ${namespace}; use a supported attribute or Browser mode`;
  return undefined;
}
