/** Private traversal context. It is diagnostic metadata, never island authority. */
export interface AdoptionDiagnostic { readonly binding:number; readonly path:string }
let current:AdoptionDiagnostic|undefined;
export function currentAdoptionDiagnostic():AdoptionDiagnostic|undefined{return current;}
export function withAdoptionDiagnostic<T>(detail:AdoptionDiagnostic|undefined,fn:()=>T):T{
  const previous=current;current=detail;
  try{return fn();}finally{current=previous;}
}
