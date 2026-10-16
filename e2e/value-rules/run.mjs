// FORMA-182: bounded, seeded real-writer/fresh-DOM/strict-adoption qualification.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import { serveOwnedAdoption } from '../../packages/core/e2e/helpers/owned-adoption.ts';
import { generate, admission } from './generate.mjs';
import { nativeWorker } from './native-worker.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];
};
const count = Number(option('count', '1000'));
const batch = Number(option('batch', '1000'));
const seed = Number(option('seed', '1820300'));
const engine = option('engine', 'chromium');
const output = resolve(option('output', 'e2e/value-rules/out/result.json'));
assert(Number.isSafeInteger(count) && count > 0 && count <= 1_000_000);
assert(Number.isSafeInteger(batch) && batch > 0 && batch <= 10_000);
assert(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
assert(['chromium', 'firefox', 'webkit'].includes(engine));
mkdirSync(dirname(output), { recursive: true });
// An interrupted rerun must never leave an earlier successful result behind.
rmSync(output, { force: true });
rmSync(output.replace(/\.json$/, '') + '-failure.json', { force: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_BUILD_JOBS: '3' }, ...extra });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
const compilerControls = run('npm', ['exec', '-w', 'packages/compiler', '--', 'vitest', 'run',
  'tests/value-rule-4-dates.test.ts', 'tests/value-rule-6-boolean-text.test.ts',
  'tests/value-rule-7-conditions.test.ts', '--maxWorkers=2']);
writeFileSync(output.replace(/\.json$/, '') + '-compiler-controls.log', compilerControls);
const built = run('cargo', ['build', '--quiet', '--locked', '--release', '-p', 'forma-ir', '--example', 'value_rule_render', '--message-format=json']);
const binary = built.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(message => message.reason === 'compiler-artifact' && message.target.name === 'value_rule_render' && message.executable)?.executable;
assert(binary, 'cargo did not identify the native executable');
const core = resolve(root, 'packages/core/dist/forma.esm.js');
const report = {
  schema: 1, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  node: process.version, engine, seed, comparedPerRule: count, batch, passed: false,
  nativeSha256: hash(readFileSync(binary)), coreSha256: hash(readFileSync(core)),
  rules: [], controls: { compilerLogSha256: hash(compilerControls) }, startedAt: new Date().toISOString(),
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const browser = await ({ chromium, firefox, webkit })[engine].launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
await serveOwnedAdoption(page, '/core.mjs');
await page.route('**/core.mjs', route => route.fulfill({ path: core, contentType: 'text/javascript' }));
await page.route('**/qualification.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><div id="app"></div>' }));
await page.goto('http://value-rules.invalid/qualification.html');
await page.evaluate(async () => {
  const { h, Fragment, createShow, createRoot, createSignal } = await import('/core.mjs');
  const { adoptMatching } = await import('/test-owned-adoption.mjs');
  const app = document.getElementById('app');
  const value = input => input.rule === 1 ? input.value : input.rule === 2 || input.rule === 3 ? Number(input.value)
    : input.rule === 4 ? new Date(Number(BigInt(input.value) / 1000000n)).getTime()
    : input.rule === 5 ? input.value === 'null' ? null : undefined : input.value;
  const allNodes = host => { const nodes = []; const walker = document.createTreeWalker(host); for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node); return nodes; };
  window.checkAdoptionLive = ({ input, native }, disabled) => {
    app.innerHTML = native.html;
    const root = app.firstElementChild, nodes = allNodes(app), html = app.innerHTML;
    const [read, write] = createSignal(input.value);
    const make = () => h(input.tag, { [input.attr]: read }, () => input.before, read, () => input.after);
    const observer = new MutationObserver(() => {});
    observer.observe(app, { subtree: true, childList: true, characterData: true, attributes: true });
    let dispose = () => {};
    try {
      // The negative control substitutes precisely the no-op this gate must
      // reject. Both paths begin with the same real native document.
      if (!disabled) dispose = adoptMatching(() => h(Fragment, null, make()), app);
      const initialWrites = observer.takeRecords().length;
      const initialUnchanged = app.innerHTML === html;
      write('adopted-update');
      const records = observer.takeRecords(), after = allNodes(app);
      const kept = after.length === nodes.length && after.every((node, i) => node === nodes[i]);
      const live = app.firstElementChild === root && kept
        && root.getAttribute(input.attr) === 'adopted-update'
        && root.textContent === input.before + 'adopted-update' + input.after
        && records.some(record => record.type === 'attributes' && record.target === root && record.attributeName === input.attr)
        && records.some(record => record.type === 'characterData' && root.contains(record.target));
      return { live, initialWrites, initialUnchanged, kept, updateWrites: records.length };
    } finally { observer.disconnect(); dispose(); }
  };
  window.checkCases = entries => {
    for (const { input, native } of entries) {
      const v = value(input);
      const text = input.rule === 6 ? String(v) : v;
      const make = () => input.rule === 7
        ? h(input.tag, null, createShow(() => v, () => h('span', null, () => input.before), () => h('span', null, () => input.after)))
        : h(input.tag, { [input.attr]: () => v }, () => input.before, () => text, () => input.after);
      const empty = new Set();
      if (!input.before) { empty.add(1); empty.add(5); }
      if (!input.after) { empty.add(3); empty.add(6); }
      if (text == null || text === '') empty.add(2);
      const snapshot = (element, nativeTree) => {
        const readText = node => {
          if (node.nodeType === Node.TEXT_NODE) {
            const id = node.previousSibling?.nodeType === Node.COMMENT_NODE && /^f:t(\d+)$/.exec(node.previousSibling.data);
            return nativeTree && node.data === '\u200b' && id && empty.has(Number(id[1])) ? '' : node.data;
          }
          return [...node.childNodes].map(readText).join('');
        };
        return { tag: element.localName, attrs: [...element.attributes].map(a => [a.name, a.value]).sort(), text: readText(element), children: [...element.children].map(child => snapshot(child, nativeTree)) };
      };
      // The parser consumes actual native HTML; each case gets a new subtree,
      // and every reactive root is disposed before the next case.
      app.innerHTML = native.html;
      const served = snapshot(app.firstElementChild, true), nodes = allNodes(app), html = app.innerHTML;
      let fresh, stopFresh;
      createRoot(dispose => { stopFresh = dispose; fresh = make(); });
      const client = snapshot(fresh, false);
      stopFresh();
      if (JSON.stringify(served) !== JSON.stringify(client)) return { input, native, stage: 'fresh', served, client };
      const observer = new MutationObserver(() => {});
      observer.observe(app, { subtree: true, childList: true, characterData: true, attributes: true });
      let stop;
      try { stop = adoptMatching(() => h(Fragment, null, make()), app); }
      catch (error) { observer.disconnect(); return { input, native, stage: 'adoption', error: String(error) }; }
      const writes = observer.takeRecords().length;
      const adopted = snapshot(app.firstElementChild, true), after = allNodes(app);
      const kept = after.length === nodes.length && after.every((node, i) => node === nodes[i]);
      const unchanged = html === app.innerHTML;
      // A deliberate write confirms this very observer is attached and active.
      app.setAttribute('data-control', String(input.index));
      const control = observer.takeRecords();
      observer.disconnect(); stop(); app.removeAttribute('data-control');
      if (writes || !kept || !unchanged || JSON.stringify(adopted) !== JSON.stringify(served)
        || control.length !== 1 || control[0].target !== app || control[0].attributeName !== 'data-control') {
        return { input, native, stage: 'zero-write', writes, kept, served, adopted, control: control.length };
      }
    }
    return null;
  };
});
const worker = nativeWorker(binary, ['--stream'], { cwd: root });
async function nativeBatch(inputs) {
  try { return await worker.batch(inputs); }
  catch (error) {
    writeFileSync(output.replace(/\.json$/, '') + '-failure.json', JSON.stringify({ seed, engine, stage: 'native-transport', inputs, error: String(error) }, null, 2) + '\n');
    throw error;
  }
}
async function check(inputs, native) {
  assert.equal(native.length, inputs.length, 'native batch count');
  const admitted = [];
  let refused = 0;
  for (let index = 0; index < inputs.length; index++) {
    const expected = admission(inputs[index]);
    if (expected) { assert.equal(native[index].refused, expected, JSON.stringify({ input: inputs[index], native: native[index] })); refused++; }
    else {
      assert.equal(typeof native[index].html, 'string', JSON.stringify({ input: inputs[index], native: native[index] }));
      if (inputs[index].rule === 3) assert.equal(native[index].wire, Number(BigInt(inputs[index].value)));
      if (inputs[index].rule === 4) assert.equal(native[index].wire, Number(BigInt(inputs[index].value) / 1000000n));
      admitted.push({ input: inputs[index], native: native[index] });
    }
  }
  const mismatch = await page.evaluate(entries => window.checkCases(entries), admitted);
  if (mismatch) {
    writeFileSync(output.replace(/\.json$/, '') + '-failure.json', JSON.stringify({ seed, engine, ...mismatch }, null, 2) + '\n');
    throw new Error(`rule${mismatch.input.rule} index${mismatch.input.index} ${mismatch.stage}: saved replay input`);
  }
  assert.deepEqual(pageErrors, []);
  return { compared: admitted.length, refused };
}
try {
  // The same differential path must catch a modified native output. Do not
  // count controls as random inputs or auto-update the expected result.
  const control = generate(seed, 1, 0); control.value = 'sentinel'; control.before = 'before'; control.after = 'after'; control.attr = 'title';
  const correct = await nativeBatch([control]);
  await check([control], correct);
  const broken = [{ ...correct[0], html: correct[0].html.replace('sentinel', 'changed') }];
  const caught = await page.evaluate(entries => window.checkCases(entries), [{ input: control, native: broken[0] }]);
  assert(caught, 'differential mismatch positive control was not detected');
  report.controls.nativeMismatch = caught.stage;
  const pair = { input: control, native: correct[0] };
  const adopted = await page.evaluate(entry => window.checkAdoptionLive(entry, false), pair);
  assert(adopted.live && adopted.initialWrites === 0 && adopted.initialUnchanged,
    `adoption liveness control failed: ${JSON.stringify(adopted)}`);
  const disabled = await page.evaluate(entry => window.checkAdoptionLive(entry, true), pair);
  assert(!disabled.live && disabled.updateWrites === 0 && disabled.initialWrites === 0,
    `disabled adoption was not detected: ${JSON.stringify(disabled)}`);
  report.controls.adoptionLiveness = adopted;
  report.controls.disabledAdoption = disabled;
  const started = performance.now();
  for (let rule = 1; rule <= 7; rule++) {
    const began = performance.now();
    let compared = 0, refused = 0, offset = 0;
    const digest = createHash('sha256');
    while (compared < count) {
      const inputs = Array.from({ length: Math.min(batch, count - compared) }, (_, i) => generate(seed, rule, offset + i));
      for (const input of inputs) digest.update(JSON.stringify(input) + '\n');
      const totals = await check(inputs, await nativeBatch(inputs));
      compared += totals.compared; refused += totals.refused;
      offset += inputs.length;
      assert(offset <= count * 2 + batch, 'generator did not provide enough admitted inputs');
      if (offset % 50_000 < inputs.length) {
        report.active = { rule, compared, refused, inputs: offset };
        writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ ...report.active, progress: true }));
      }
    }
    assert.equal(compared, count);
    assert.equal(compared + refused, offset);
    report.rules.push({ rule, inputs: offset, compared, refused, inputSha256: digest.digest('hex'), seconds: (performance.now() - began) / 1000 });
    delete report.active;
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.rules.at(-1)));
  }
  report.seconds = (performance.now() - started) / 1000;
  report.finishedAt = new Date().toISOString(); report.passed = true;
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
} finally { await worker.close(); await browser.close(); }
