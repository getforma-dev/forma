import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { stopOwnedWatcher } from './helpers/watch';

it('stops its owned descendant and closes inherited pipes without stopping another fixture', async () => {
  const group = process.platform !== 'win32';
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const sentinelClosed = once(sentinel, 'close');
  const child = spawn(process.execPath, ['-e', `
    const {spawn} = require('node:child_process');
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: ['ignore', 'inherit', 'inherit']});
    descendant.on('spawn', () => console.log('ready'));
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'], detached: group });
  const closed = once(child, 'close');
  let stopped = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('owned fixture did not spawn its descendant')), 5_000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('ready')) { clearTimeout(timer); resolve(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    await stopOwnedWatcher(child, closed, group);
    stopped = true;
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(sentinel.exitCode).toBeNull();
    expect(sentinel.signalCode).toBeNull();
    expect(() => process.kill(sentinel.pid!, 0)).not.toThrow();
  } finally {
    if (!stopped) await stopOwnedWatcher(child, closed, group);
    sentinel.kill();
    await sentinelClosed;
  }
}, 15_000);
