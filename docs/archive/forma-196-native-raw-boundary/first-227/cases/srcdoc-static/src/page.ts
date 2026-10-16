import {h} from '@getforma/core';
export function Page() {return h('main',null,h('iframe',{srcdoc:"<p data-probe=\"raw\">nested markup</p>"}));}
