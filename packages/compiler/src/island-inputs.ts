import * as t from '@babel/types';
import type {ClosedBinding} from './closed-bindings';
import type {IrEmitContext} from './ir-emit';
import {propPath,propSlot,propType,type PropsScope} from './props-bindings';
import {closedExpression,constantAssignable,schemaAssignable,schemaHint} from './closed-expression';
import {PropsSchemaError} from './props-schema';
import {originalPosition} from './diagnostics';

/** Prepare all declared inputs before ISLAND_START. Repeated slots are intentional. */
export function islandInputs(ctx:IrEmitContext,schemaObject:number,arg:t.Node|undefined,scope:PropsScope|undefined,file:string,constants?:ReadonlyMap<string,unknown>,signal?:(name:string)=>unknown,closed?:(node:t.Node)=>ClosedBinding|undefined):number[] {
  const schema=ctx.getPropsSchema(), fields=schema[schemaObject]!, supplied=new Map<string,t.Node>();
  function fail(node:t.Node|undefined,detail:string):never {
    const at=originalPosition(file,node?.loc?.start??{line:1,column:0});
    throw new PropsSchemaError(file,at.line,at.column,detail);
  }
  if(arg&&!t.isNullLiteral(arg)) {
    if(t.isObjectExpression(arg)) for(const property of arg.properties) {
      if(!t.isObjectProperty(property)||property.computed||(!t.isIdentifier(property.key)&&!t.isStringLiteral(property.key)))fail(property,'island inputs require literal named fields');
      const name=t.isIdentifier(property.key)?property.key.name:property.key.value;
      if(supplied.has(name))fail(property,`duplicate island input ${name}`); supplied.set(name,property.value);
    }
    else if(t.isIdentifier(arg)||t.isMemberExpression(arg)) {
      for(const field of fields)supplied.set(field.name,t.memberExpression(arg,t.stringLiteral(field.name),true));
    } else fail(arg,'island inputs require a declared object or literal own fields');
  }
  return fields.map(field=>{
    const value=supplied.get(field.name);
    if(!value&&field.type.kind!=='optional')fail(arg,`missing declared island input ${field.name}`);
    if(value&&scope) {
      const path=propPath(value,scope,false);
      if(path) {
        if(!schemaAssignable(propType(path,scope,value),field.type,schema))fail(value,`declared island input ${field.name} has an incompatible type`);
        return propSlot(value,scope,ctx)!;
      }
    }
    const binding=value?closed?.(value):undefined;
    if(binding) {
      if(!binding.values.every(value=>constantAssignable(value,field.type,schema)))fail(value,`closed island input ${field.name} does not match its declared type`);
      return binding.slot();
    }
    let constant:unknown=null;
    if(value) {
      const getter=t.isCallExpression(value)&&t.isIdentifier(value.callee)&&value.arguments.length===0?value.callee.name:undefined;
      const initial=getter?signal?.(getter):undefined;
      constant=initial===undefined?closedExpression(value,file,constants):initial;
    }
    if(!constantAssignable(constant,field.type,schema))fail(value,`closed island input ${field.name} does not match its declared type`);
    return ctx.addConstantSlot(constant,schemaHint(field.type));
  });
}
