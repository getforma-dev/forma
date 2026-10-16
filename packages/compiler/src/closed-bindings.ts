/** Exact closed-value provenance for local aggregate signals and LIST rows.
 * This is compiler-only data, never a fabricated handler schema. Native flow
 * independently checks every emitted constant, LIST item and PROP destination.
 */
import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import {IrEmitContext} from './ir-emit';
import * as C from './fmir-constants';
import {PropsSchemaError} from './props-schema';
import {originalPosition} from './diagnostics';
import {refuseBooleanText} from './value-rules';
import type {SignalBinding} from './signal-scope';
const traverse=(typeof _traverse==='function'?_traverse:(_traverse as any).default) as typeof _traverse;
export interface ClosedBinding { values:readonly unknown[]; slot:()=>number;getter?:boolean }
export type ClosedRows=WeakMap<t.Identifier,ClosedBinding>;
export interface ClosedEnvironment {
  file:string;
  signal:(identifier:t.Identifier)=>SignalBinding|undefined;
  rows?:ClosedRows;
}
function fail(env:ClosedEnvironment,node:t.Node,message:string):never {
  const at=originalPosition(env.file,node.loc?.start??{line:1,column:0});
  throw new PropsSchemaError(env.file,at.line,at.column,message);
}
export function closedHint(values:readonly unknown[],env:ClosedEnvironment,node:t.Node):number {
  let hint:number|undefined;
  for(const value of values) {
    if(value===null)continue;
    const next=typeof value==='boolean'?C.SLOT_TYPE_BOOL:typeof value==='number'?C.SLOT_TYPE_NUMBER:typeof value==='string'?C.SLOT_TYPE_TEXT:Array.isArray(value)?C.SLOT_TYPE_ARRAY:C.SLOT_TYPE_OBJECT;
    if(hint!==undefined&&hint!==next)fail(env,node,'a closed LIST binding has incompatible non-null value kinds');
    hint=next;
  }
  return hint??C.SLOT_TYPE_TEXT;
}
export function closedBinding(node:t.Node|null|undefined,ctx:IrEmitContext,env:ClosedEnvironment,readGetter=true):ClosedBinding|undefined {
  if(!node)return undefined;
  if(t.isTSAsExpression(node)||t.isTSNonNullExpression(node)||t.isTSSatisfiesExpression(node)||t.isParenthesizedExpression(node))return closedBinding(node.expression,ctx,env,readGetter);
  if((t.isArrowFunctionExpression(node)||t.isFunctionExpression(node))&&node.params.length===0) {
    if(!readGetter)fail(env,node,'a function object is not its returned closed value');
    const body=t.isBlockStatement(node.body)?node.body.body.length===1&&t.isReturnStatement(node.body.body[0])?node.body.body[0].argument:undefined:node.body;
    return closedBinding(body,ctx,env);
  }
  const identifier=t.isIdentifier(node)?node:t.isCallExpression(node)&&node.arguments.length===0&&t.isIdentifier(node.callee)?node.callee:undefined;
  if(identifier) {
    const row=env.rows?.get(identifier);if(row){
      if(t.isCallExpression(node)&&!row.getter)fail(env,node,'a LIST row value is not a callable signal getter');
      if(t.isIdentifier(node)&&row.getter&&!readGetter)fail(env,node,'an indexed row getter must be called before reading its item');
      return row;
    }
    const signal=env.signal(identifier);
    if(signal&&!readGetter&&t.isIdentifier(node))fail(env,node,'a signal getter must be called before reading its returned object');
    if(signal?.default.type==='aggregate')return {values:[signal.default.default],slot:()=>signal.slotId};
    return undefined;
  }
  if(t.isMemberExpression(node)) {
    const source=closedBinding(node.object,ctx,env,false);if(!source)return undefined;
    const key=!node.computed&&t.isIdentifier(node.property)?node.property.name:t.isStringLiteral(node.property)?node.property.value:undefined;
    if(key===undefined)fail(env,node,'closed aggregate reads require a literal property name');
    const values=source.values.map(value=>{
      if(value===null)fail(env,node,'plain property access through a known null or absent value would throw');
      if(typeof value!=='object'||Array.isArray(value))fail(env,node,'closed aggregate property read needs an object');
      if(Object.hasOwn(value,key))return (value as Record<string,unknown>)[key];
      if(key in Object.prototype)fail(env,node,'inherited object properties are not closed own data');
      return null;
    });
    return {values,slot:()=>{
      const hint=closedHint(values,env,node),sourceSlot=source.slot();
      const target=ctx.addTemporarySlot(hint);ctx.emit(C.OP_PROP);ctx.emitU16(sourceSlot);ctx.emitU32(ctx.addString(key));ctx.emitU16(target);
      return target;
    }};
  }
  return undefined;
}
export function closedSlot(node:t.Node|null|undefined,ctx:IrEmitContext,env:ClosedEnvironment,use:'value'|'text'|'attribute'='value'):number|undefined {
  const binding=closedBinding(node,ctx,env);if(!binding||!node)return undefined;
  const hint=closedHint(binding.values,env,node);
  if(use!=='value'&&(hint===C.SLOT_TYPE_ARRAY||hint===C.SLOT_TYPE_OBJECT))fail(env,node,`a closed aggregate cannot be used directly as ${use}; read a scalar field`);
  const slot=binding.slot();ctx.recordSlotRef(slot);return slot;
}
/** A closed read in a text position: absent writes nothing (rule 5); a boolean is BUILD-614 (rule 6, docs/parity-rules.md). */
export function emitClosedText(node:t.Node,ctx:IrEmitContext,env:ClosedEnvironment):boolean {
  const binding=closedBinding(node,ctx,env);if(!binding)return false;
  if(binding.values.some(value=>typeof value==='boolean'))refuseBooleanText(env.file,node,'a closed boolean value','ternary');
  if(binding.values.every(value=>value===null))return true;
  const slot=closedSlot(node,ctx,env,'text')!;ctx.emit(C.OP_DYN_TEXT);ctx.emitU16(slot);ctx.emitU16(ctx.nextMarker());return true;
}
/** Bind only references to this exact callback parameter, never same-spelled shadows. */
export function closedListRows(fn:t.ArrowFunctionExpression|t.FunctionExpression,values:readonly unknown[],slot:number,parent:ClosedRows|undefined,getter=false):ClosedRows {
  const rows=new WeakMap<t.Identifier,ClosedBinding>();
  traverse(t.file(t.program([t.expressionStatement(fn)])),{ReferencedIdentifier(path){
    if(!t.isIdentifier(path.node))return;
    const binding=path.scope.getBinding(path.node.name);
    if(binding?.identifier===fn.params[0])rows.set(path.node,{values,slot:()=>slot,getter});
    else {const outer=parent?.get(path.node);if(outer)rows.set(path.node,outer);}
  }});
  return rows;
}
