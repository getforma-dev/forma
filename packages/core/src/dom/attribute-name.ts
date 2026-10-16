/** Exact public prop aliases; other names retain their namespace semantics. */
export function attributeName(name:string):string {
  return name==='className'?'class':name==='htmlFor'?'for':name==='tabIndex'?'tabindex':name;
}
