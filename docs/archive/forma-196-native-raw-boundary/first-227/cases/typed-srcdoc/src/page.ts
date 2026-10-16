import {h,trustedHtml} from '@getforma/core';
export function Page() {return h('main',null,h('iframe',{srcdoc:trustedHtml("<p data-probe=\"raw\">nested markup</p>")}));}
