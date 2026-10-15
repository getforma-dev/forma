import {readSourceFile} from './source-snapshot';
/** Closed source data shared by island inputs and local signal defaults. */

import * as t from '@babel/types';
import {originalPosition} from './diagnostics';
import {PropsSchemaError} from './props-schema';
import {encodeClosedConstant} from './fmir-contracts';
import type {PropsSchema,SchemaType} from './fmir-payload';
import * as C from './fmir-constants';

export function closedExpression(node:t.Node, file:string, identifiers?:ReadonlyMap<string,unknown>): unknown {
  let count=0;
  let originalLines:string[]|null|undefined;
  function fail(at:t.Node,detail:string):never {
    const loc=originalPosition(file,at.loc?.start??{line:1,column:0});
    throw new PropsSchemaError(file,loc.line,loc.column,detail);
  }
  function visit(node:t.Node,depth:number):unknown {
    if(++count>C.MAX_CONSTANT_NODES || depth>C.MAX_CONSTANT_DEPTH) fail(node,'closed source data exceeds the constant bounds');
    if(t.isTSAsExpression(node)||t.isTSTypeAssertion(node)||t.isTSNonNullExpression(node)||t.isTSSatisfiesExpression(node)||t.isParenthesizedExpression(node))return visit(node.expression,depth);
    if(t.isNullLiteral(node))return null;
    if(t.isStringLiteral(node)||t.isBooleanLiteral(node))return node.value;
    if(t.isNumericLiteral(node)) {
      const raw=String(node.extra?.raw??node.value).replaceAll('_','');
      const integer=(token:string)=>/^(?:[0-9]+|0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)$/.test(token);
      if(integer(raw)&&BigInt(raw)>BigInt(Number.MAX_SAFE_INTEGER))fail(node,'source integer literal exceeds the safe integer range');
      // JSX lowering may already have rounded its numeric node. Check the
      // original token at the source-mapped position before accepting it.
      if(node.loc&&file) {
        if(originalLines===undefined)try{originalLines=readSourceFile(file).split(/\r?\n/);}catch{originalLines=null;}
        if(originalLines) {
          const at=originalPosition(file,node.loc.start),line=originalLines[at.line-1]??'';
          const token=/^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9_]+)?)/.exec(line.slice(at.column-1))?.[0]?.replaceAll('_','');
          if(token&&integer(token)&&BigInt(token)>BigInt(Number.MAX_SAFE_INTEGER))fail(node,'source integer literal exceeds the safe integer range before lowering');
        }
      }
      if(!Number.isFinite(node.value))fail(node,'closed source number must be finite');
      return Object.is(node.value,-0)?0:node.value;
    }
    if(t.isTemplateLiteral(node)&&node.expressions.length===0)return node.quasis.map(x=>x.value.cooked??x.value.raw).join('');
    if(t.isUnaryExpression(node)&&['-','+'].includes(node.operator)) {
      const value=visit(node.argument,depth+1);if(typeof value!=='number')fail(node,'numeric constant sign needs a number');
      return node.operator==='-'?(value===0?0:-value):value;
    }
    if(t.isIdentifier(node)&&identifiers?.has(node.name))return identifiers.get(node.name);
    if(t.isLogicalExpression(node)&&node.operator==='??') {const left=visit(node.left,depth+1);return left===null?visit(node.right,depth+1):left;}
    if(t.isArrayExpression(node)) {
      if(node.elements.length>C.MAX_CONSTANT_ARRAY_ELEMENTS)fail(node,'closed array exceeds the item bound');
      return node.elements.map(item=>{if(!item||t.isSpreadElement(item))fail(node,'closed arrays need explicit positional values');return visit(item,depth+1);});
    }
    if(t.isObjectExpression(node)) {
      const out=Object.create(null) as Record<string,unknown>;
      for(const property of node.properties) {
        if(!t.isObjectProperty(property)||property.computed||(!t.isIdentifier(property.key)&&!t.isStringLiteral(property.key)))fail(property,'closed objects need literal own data fields');
        const key=t.isIdentifier(property.key)?property.key.name:property.key.value;
        if(Object.hasOwn(out,key))fail(property,'duplicate closed object key');
        out[key]=visit(property.value,depth+1);
      }
      return out;
    }
    fail(node,'island input/default must be declared data or a closed constant');
  }
  const value=visit(node,0);
  try {encodeClosedConstant(value);}catch(error){fail(node,String(error));}
  return value;
}
export function schemaHint(type:SchemaType):number {
  while(type.kind==='optional')type=type.inner;
  return type.kind==='boolean'?C.SLOT_TYPE_BOOL:type.kind==='number'||type.kind==='date'?C.SLOT_TYPE_NUMBER:type.kind==='array'?C.SLOT_TYPE_ARRAY:type.kind==='object'?C.SLOT_TYPE_OBJECT:C.SLOT_TYPE_TEXT;
}
/** The native assign-literal rule, including Date's distinct provenance. */
export function constantAssignable(value:unknown,type:SchemaType,schema:PropsSchema):boolean {
  const todo:[unknown,SchemaType][]=[[value,type]];
  while(todo.length) {
    const [value,type]=todo.pop()!;
    if(type.kind==='optional') {if(value!==null)todo.push([value,type.inner]);continue;}
    if(type.kind==='boolean'&&typeof value==='boolean'||type.kind==='string'&&typeof value==='string'||type.kind==='number'&&typeof value==='number'&&Number.isFinite(value))continue;
    if(type.kind==='enum'&&typeof value==='string'&&type.variants.includes(value))continue;
    if(type.kind==='array'&&Array.isArray(value)){for(const item of value)todo.push([item,type.element]);continue;}
    if(type.kind==='object'&&value!==null&&typeof value==='object'&&!Array.isArray(value)) {
      for(const field of schema[type.object]!) {
        if(Object.hasOwn(value,field.name))todo.push([(value as Record<string,unknown>)[field.name],field.type]);
        else if(field.type.kind!=='optional')return false;
      }
      continue;
    }
    return false;
  }
  return true;
}
export function schemaAssignable(actual:SchemaType,expected:SchemaType,schema:PropsSchema):boolean {
  const todo:[SchemaType,SchemaType][]=[[actual,expected]],seen=new Set<string>();
  while(todo.length) {
    const [actual,expected]=todo.pop()!;
    if(expected.kind==='optional'){todo.push([actual.kind==='optional'?actual.inner:actual,expected.inner]);continue;}
    if(actual.kind==='optional')return false;
    if(actual.kind==='enum'&&expected.kind==='string')continue;
    if(actual.kind!==expected.kind)return false;
    if(actual.kind==='enum'&&expected.kind==='enum') {if(actual.variants.some(value=>!expected.variants.includes(value)))return false;}
    if(actual.kind==='array'&&expected.kind==='array')todo.push([actual.element,expected.element]);
    if(actual.kind==='object'&&expected.kind==='object') {
      const key=`${actual.object}:${expected.object}`;if(seen.has(key))continue;seen.add(key);
      for(const field of schema[expected.object]!) {
        const supplied=schema[actual.object]!.find(candidate=>candidate.name===field.name);
        if(supplied)todo.push([supplied.type,field.type]);else if(field.type.kind!=='optional')return false;
      }
    }
  }
  return true;
}
