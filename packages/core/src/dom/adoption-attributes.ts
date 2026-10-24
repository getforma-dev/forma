/** Private attribute policy shared by read-only validation and later writes.
 * Creating a binding only normalizes its initial value; write() is called by
 * the prepared owner after commit, never to repair the first render. */
import { isDangerousUrlAttr, isEventHandlerAttr, isRawHtmlAttr, isSafeAttrName } from '../security/url-safety.js';
import { AdoptionDomError } from './adoption-plan.js';
import { rawHtml } from './trusted-html.js';
import { normalizeDomText } from './normalize-text.js';
import { BOOLEAN_ATTRS } from './element.js';
import { attributeName } from './attribute-name.js';

const XLINK_NS='http://www.w3.org/1999/xlink';
export interface PreparedAttribute {
  readonly local:string;
  readonly namespace:string|null;
  readonly initial:string|null;
  write(value:unknown):void;
}

export function prepareAttribute(element:Element,key:string,value:unknown):PreparedAttribute {
  const qualified=attributeName(key);
  const safe=isSafeAttrName(qualified);
  const namespace=safe&&qualified.startsWith('xlink:')?XLINK_NS:null;
  const local=namespace?qualified.slice(6):element.namespaceURI==='http://www.w3.org/1999/xhtml'?qualified.toLowerCase():qualified;
  const normalize=(next:unknown):string|null=>{
    if(!safe||next==null||next===false||isEventHandlerAttr(qualified))return null;
    // srcdoc keeps the existing typed raw policy before comparison/cache.
    // Other object values never gain an arbitrary coercion path here.
    if(isRawHtmlAttr(qualified))return String(rawHtml(next,'srcdoc'));
    if(!['string','number','boolean'].includes(typeof next))throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');
    // Rule 1 before comparison and cache: the normalized string is the one
    // compared and written; the URL guard classifies the raw string, so a NUL
    // anywhere in a URL attribute refuses (the walker does the same).
    // Verified by: src/dom/__tests__/normalize-text.test.ts > "adoption attribute expectations normalize $id before comparison and later writes"
    // Rule 6's attribute table: `true` is bare only on an HTML boolean attribute.
    if(BOOLEAN_ATTRS.has(qualified))return next?'':null;
    const raw=String(next),result=normalizeDomText(raw);
    return isDangerousUrlAttr(element.localName,qualified,raw)?null:result;
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
