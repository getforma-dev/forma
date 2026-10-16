/** Private build-time utility bundled into each consuming package. */
export interface JsxNamespaceEdit {readonly start:number;readonly end:number;readonly text:string}
export interface JsxNamespaceOptions {readonly factory?:string;readonly runtime?:string}
export function collectJsxNamespaceEdits(source:string, options?:JsxNamespaceOptions):JsxNamespaceEdit[];
export function transformJsxNamespaces(source:string, options?:JsxNamespaceOptions):string;
