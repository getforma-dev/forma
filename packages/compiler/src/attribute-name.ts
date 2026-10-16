/** Native spelling must agree with core's creation/adoption policy. Both
 * packages pin these exact aliases against parity/attribute-aliases.json. */
export function attributeName(name:string):string {
  return name==='className'?'class':name==='htmlFor'?'for':name==='tabIndex'?'tabindex':name;
}
