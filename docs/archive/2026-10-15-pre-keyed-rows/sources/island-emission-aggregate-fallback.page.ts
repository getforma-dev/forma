import {h,createSignal,createList,browserOnly} from "@getforma/core";import {Badge} from "./island";export function Page(p:{rows?:string[]}){return h("main",null,Badge({rows:p.rows}));}
