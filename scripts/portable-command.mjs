// Invoke npm's JavaScript entry directly. Windows .cmd shims need a shell,
// which would turn arguments (including temporary paths) into shell source.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

export function commandInvocation(command, args, { platform = process.platform, executable = process.execPath, env = process.env, exists = existsSync } = {}) {
  if (platform !== 'win32' || !['npm', 'npx', 'npm.cmd', 'npx.cmd'].includes(command)) return { command, args };
  const name = command.replace(/\.cmd$/, '');
  const bin = `${name}-cli.js`, paths = [];
  if (env.npm_execpath && /(?:npm|npx)-cli\.js$/.test(env.npm_execpath)) paths.push(win32.join(win32.dirname(env.npm_execpath), bin));
  paths.push(win32.join(win32.dirname(executable), 'node_modules', 'npm', 'bin', bin));
  const script = paths.find(exists);
  assert(script, `cannot locate ${bin} beside this Node runtime`);
  return { command: executable, args: [script, ...args] };
}
