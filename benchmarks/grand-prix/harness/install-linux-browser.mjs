// One committed browser archive and executable for every round-2 Linux lane.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installSandboxProfile, sandboxProfile as describeSandboxProfile } from './browser-sandbox.mjs';

assert.equal(process.platform, 'linux', 'the frozen browser is for Linux');
assert.equal(process.arch, 'x64', 'the frozen browser is for Linux x64');
const cacheDir = resolve(process.argv[2] ?? '');
assert(process.argv[2], 'usage: install-linux-browser.mjs CACHE_DIRECTORY [--install-deps]');
const lock = JSON.parse(await readFile(new URL('./chromium-linux-lock.json', import.meta.url), 'utf8'));
const require = createRequire(new URL('../island-race/package.json', import.meta.url));
const { install, Browser, BrowserPlatform, getDownloadUrl } = await import(pathToFileURL(require.resolve('@puppeteer/browsers')).href);
assert.equal(getDownloadUrl(Browser.CHROME, BrowserPlatform.LINUX, lock.version).href, lock.archiveUrl);
const installed = await install({ browser: Browser.CHROME, platform: BrowserPlatform.LINUX,
  buildId: lock.version, cacheDir, expectedHash: lock.archiveSha256,
  installDeps: process.argv.includes('--install-deps') });
const hash = createHash('sha256');
for await (const chunk of createReadStream(installed.executablePath)) hash.update(chunk);
assert.equal(hash.digest('hex'), lock.executableSha256, 'installed Chromium executable differs from the frozen bytes');
const configureSandbox = process.argv.includes('--install-apparmor-profile');
// Publish recovery identity before creating/loading the owned profile. The
// always step can remove it even if installation or later evidence writes fail.
if (configureSandbox && process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
  `sandbox_profile=${describeSandboxProfile(installed.executablePath).path}\n`);
const sandboxProfile = configureSandbox ? installSandboxProfile(installed.executablePath) : null;
const observation = { ...lock, executablePath: installed.executablePath, sandboxProfile, installedAt: new Date().toISOString() };
await writeFile(resolve(cacheDir, 'browser-lock.json'), JSON.stringify(observation, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
  `path=${installed.executablePath}\nsha256=${lock.executableSha256}\n`);
console.log(JSON.stringify(observation));
