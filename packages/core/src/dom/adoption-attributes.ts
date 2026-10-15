/** Private attribute policy shared by read-only validation and later writes.
 * Creating a binding only normalizes its initial value; write() is called by
 * the prepared owner after commit, never to repair the first render. */
import { isEventHandlerAttr, isRawHtmlAttr, isUnsafeAttrWrite } from '../security/url-safety.js';
import { AdoptionDomError } from './adoption-plan.js';
import { rawHtml } from './trusted-html.js';

const XLINK_NS='http://www.w3.org/1999/xlink';
const ALIASES:Record<string,string>={className:'class',htmlFor:'for',tabIndex:'tabindex'};
export interface PreparedAttribute {
  readonly local:string;
  readonly namespace:string|null;
  readonly initial:string|null;
  write(value:unknown):void;
}

export function prepareAttribute(element:Element,key:string,value:unknown):PreparedAttribute {
  const qualified=ALIASES[key]??key;
  const namespace=qualified.startsWith('xlink:')?XLINK_NS:null;
  const local=namespace?qualified.slice(6):element.namespaceURI==='http://www.w3.org/1999/xhtml'?qualified.toLowerCase():qualified;
  const normalize=(next:unknown):string|null=>{
    if(next==null||next===false||isEventHandlerAttr(qualified))return null;
    // srcdoc keeps the existing typed raw policy before comparison/cache.
    // Other object values never gain an arbitrary coercion path here.
    if(isRawHtmlAttr(qualified))return String(rawHtml(next,'srcdoc'));
    if(!['string','number','boolean'].includes(typeof next))throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');
    const result=next===true?'':String(next);
    return isUnsafeAttrWrite(element.localName,qualified,result)?null:result;
  };
  const initial=normalize(value);
  let previous=initial;
  return {
    local,namespace,initial,
    write(next){
      const normalized=normalize(next);if(normalized===previous)return;
      if(normalized===null){if(namespace)element.removeAttributeNS(namespace,local);else element.removeAttribute(qualified);}
      else if(namespace)element.setAttributeNS(namespace,qualified,normalized);else element.setAttribute(qualified,isRawHtmlAttr(qualified)?rawHtml(next,'srcdoc'):normalized);
      previous=normalized;
    },
  };
}
