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
