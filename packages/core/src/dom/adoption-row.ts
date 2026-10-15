/** Private logical rows; initial text boundaries are observations, never writes. */
import { AdoptionDomError, type AdoptionPiece } from './adoption-plan.js';
const refuse=():never=>{throw new AdoptionDomError('FORMA_E_HYDRATE_STRUCTURE');};

export class AdoptionRow {
  first:Node|null;
  last:Node|null;
  constructor(public initial:readonly AdoptionPiece[]|undefined,first?:Node|null,last?:Node|null){
    this.first=first===undefined?initial?.[0]?.node??null:first;
    this.last=last===undefined?initial?.[initial.length-1]?.node??null:last;
  }
  static fresh(value:Node|null):AdoptionRow {
    return value?.nodeType===11?new AdoptionRow(undefined,value.firstChild,value.lastChild):new AdoptionRow(undefined,value,value);
  }
  nodes():Node[] {
    if(!this.first){if(this.last)refuse();return [];}
    if(!this.last||this.first.parentNode!==this.last.parentNode)refuse();
    const nodes:Node[]=[];
    for(let node:Node|null=this.first;node;node=node.nextSibling){nodes.push(node);if(node===this.last)return nodes;}
    return refuse();
  }
}

/** Only an ordinary postcommit list change calls this. Adjacent literal rows
 * may share one parsed Text; split at observed offsets before moving a part.
 * Whole nodes and empty rows require no mutation or synthetic marker. */
export function materializeRows(rows:readonly AdoptionRow[],check:()=>void):void {
  const cuts=new Map<Text,{text:string;offsets:Set<number>}>();
  for(const row of rows)for(const piece of row.initial??[]){
    if(piece.text===null||piece.from===0&&piece.to===piece.text.length)continue;
    const node=piece.node as Text;
    let item=cuts.get(node);if(!item){item={text:piece.text,offsets:new Set([0,piece.text.length])};cuts.set(node,item);}
    if(item.text!==piece.text)refuse();item.offsets.add(piece.from);item.offsets.add(piece.to);
  }
  // Validate all shared literals before the first split.
  for(const [node,item]of cuts)if(node.data!==item.text)throw new AdoptionDomError('FORMA_E_HYDRATE_VALUE');
  const parts=new Map<Text,{offsets:number[];nodes:Text[]}>();
  for(const [original,item]of cuts){
    const offsets=[...item.offsets].sort((a,b)=>a-b),nodes=[original];let node=original;
    for(let i=1;i<offsets.length-1;i++){check();node=node.splitText(offsets[i]!-offsets[i-1]!);nodes.push(node);check();}
    parts.set(original,{offsets,nodes});
  }
  for(const row of rows){
    const first=row.initial?.[0],last=row.initial?.[row.initial.length-1];
    if(first){const split=parts.get(first.node as Text);if(split)row.first=split.nodes[split.offsets.indexOf(first.from)]??refuse();}
    if(last){const split=parts.get(last.node as Text);if(split)row.last=split.nodes[split.offsets.indexOf(last.to)-1]??refuse();}
    row.initial=undefined;
  }
}
