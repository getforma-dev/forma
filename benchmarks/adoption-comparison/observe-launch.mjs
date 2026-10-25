// Launch/close provenance only. No page hooks, workload edits or timing changes.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, readlinkSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { affinityFromStatus } from '../grand-prix/harness/resource-profile.mjs';
import { fileHash, validateLaunch, processStartTime, processRemains } from './protocol.mjs';

const expected = JSON.parse(readFileSync(process.env.ADOPTION_LAUNCH_EXPECTED, 'utf8'));
const destination = process.env.ADOPTION_LAUNCH_RECORD;
assert(destination && !existsSync(destination), 'launch output already exists');
const originalLaunch = chromium.launch.bind(chromium);
let launches = 0;
chromium.launch = async options => {
  assert.equal(++launches, 1, 'unexpected additional browser launch');
  assert.deepEqual(options, { headless: true });
  const browser = await originalLaunch(options);
  const record = { options, version: browser.version(), nodePid: process.pid };
  try {
    const matches = [];
    for (const name of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      try {
        const status = readFileSync(`/proc/${name}/status`, 'utf8');
        if (Number(/^PPid:\s*(\d+)/m.exec(status)?.[1]) === process.pid && readlinkSync(`/proc/${name}/exe`) === expected.executable) matches.push({ pid: Number(name), status });
      } catch { /* A different process may exit during enumeration. */ }
    }
    assert.equal(matches.length, 1, 'cannot uniquely identify launched headless shell');
    const { pid, status } = matches[0];
    const cgroup = /^0::([^\n]+)$/m.exec(readFileSync('/proc/self/cgroup', 'utf8'))?.[1];
    assert(cgroup?.startsWith('/') && !cgroup.includes('..'), 'unified cgroup required');
    Object.assign(record, { pid, executable: readlinkSync(`/proc/${pid}/exe`),
      executableSha256: fileHash(`/proc/${pid}/exe`), nodeAffinity: affinityFromStatus(readFileSync('/proc/self/status', 'utf8')),
      browserAffinity: affinityFromStatus(status), cgroup,
      browserCgroup: /^0::([^\n]+)$/m.exec(readFileSync(`/proc/${pid}/cgroup`, 'utf8'))?.[1],
      memoryMax: readFileSync(`/sys/fs/cgroup${cgroup}/memory.max`, 'utf8').trim(),
      swapMax: readFileSync(`/sys/fs/cgroup${cgroup}/memory.swap.max`, 'utf8').trim(),
      browserStartTime: processStartTime(readFileSync(`/proc/${pid}/stat`, 'utf8')) });
    validateLaunch(record, expected);
    writeFileSync(destination, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    record.error = error.message;
    if (!existsSync(destination)) writeFileSync(destination, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    await browser.close(); throw error;
  }
  const originalClose = browser.close.bind(browser);
  browser.close = async (...args) => {
    try { return await originalClose(...args); }
    finally {
      const statPath = `/proc/${record.pid}/stat`;
      let remains;
      try { remains = processRemains(statPath, record.browserStartTime); }
      catch (error) {
        writeFileSync(destination + '.closed.json', JSON.stringify({ pid: record.pid, originalProcessRemains: null, error: error.message }, null, 2) + '\n', { flag: 'wx' });
        throw error;
      }
      writeFileSync(destination + '.closed.json', JSON.stringify({ pid: record.pid, originalProcessRemains: remains }, null, 2) + '\n', { flag: 'wx' });
      assert.equal(remains, false, 'browser process survived close');
    }
  };
  return browser;
};
