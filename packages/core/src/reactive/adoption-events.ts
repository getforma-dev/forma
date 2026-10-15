/** Private callback ownership context for ordinary elements created by a live
 * adopted region. It carries no signal capture, codec or seed authority. */
type Listener = EventListenerOrEventListenerObject;
type Wrap = (listener:Listener)=>EventListener;
let active:Wrap|undefined;
export function withAdoptionEvents<T>(wrap:Wrap|undefined,build:()=>T):T {
  const previous=active;active=wrap;
  try{return build();}finally{active=previous;}
}
export const getAdoptionEvents=():Wrap|undefined=>active;
export function adoptionListener(listener:Listener):Listener {
  return active?.(listener)??listener;
}
