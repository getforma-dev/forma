import test from 'node:test';
import assert from 'node:assert/strict';
import { commandInvocation } from './portable-command.mjs';

test('Windows npm and npx use the current Node executable and preserve every argument', () => {
  const executable='C:\\Program Files\\nodejs\\node.exe';
  for(const command of ['npm','npx','npm.cmd','npx.cmd']) {
    const name=command.replace(/\.cmd$/,'');const script=`C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\${name}-cli.js`;
    const args=['ci','--prefix','C:\\owned directory\\space & literal','--value=$(literal)'];
    assert.deepEqual(commandInvocation(command,args,{platform:'win32',executable,env:{},exists:p=>p===script}),{command:executable,args:[script,...args]});
  }
});
test('npm_execpath is supported and a missing CLI refuses without a shell fallback',()=>{
  const options={platform:'win32',executable:'C:\\runtime\\node.exe',env:{npm_execpath:'D:\\tools\\npm\\bin\\npm-cli.js'},exists:p=>p==='D:\\tools\\npm\\bin\\npx-cli.js'};
  assert.deepEqual(commandInvocation('npx',['tsx','build.ts'],options).args,['D:\\tools\\npm\\bin\\npx-cli.js','tsx','build.ts']);
  assert.throws(()=>commandInvocation('npm',[],{...options,exists:()=>false}),/cannot locate/);
});
test('native commands and non-Windows npm preserve executable argument arrays',()=>{
  for(const platform of ['linux','darwin','win32'])assert.deepEqual(commandInvocation('cargo',['check','--locked'],{platform}),{command:'cargo',args:['check','--locked']});
  assert.deepEqual(commandInvocation('npm',['ci'],{platform:'linux'}),{command:'npm',args:['ci']});
});
