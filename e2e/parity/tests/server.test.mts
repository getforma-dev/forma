// The server half: crates/forma-server/examples/parity_render.rs, built by cargo, over committed
// modules. The walker, the production loader, bind and render are the real ones; nothing is stubbed.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BOOT_SOURCE } from '../src/boot.mts';
import { generate, REFUSALS, type Json } from '../src/generate.mts';
import { BOOT_FILE, integrity, synthesizeManifest } from '../src/manifest.mts';
import { describeModule, renderStates, renderTyped, REPO, type Rendered, type RenderError, type TypedRequest } from '../src/server.mts';

const scratch = mkdtempSync(join(tmpdir(), 'forma-parity-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const bootPath = join(scratch, BOOT_FILE);
writeFileSync(bootPath, BOOT_SOURCE);

/** A typed request for one module, as the suite builds it; `manifest` may be altered by the caller. */
function typedRequest(name: string, irPath: string, states: readonly Json[], alter?: (manifest: Record<string, unknown>) => void): TypedRequest {
  const manifest = synthesizeManifest({ app: name, irFile: `${name}.ir`, ir: readFileSync(irPath), boot: BOOT_SOURCE });
  alter?.(manifest);
  return { name, route: '/', manifest, files: { [`${name}.ir`]: irPath, [BOOT_FILE]: bootPath }, states };
}
const propsContract = resolve(REPO, 'crates/forma-server/tests/fixtures/props-contract/home.ir');

const ir = (name: string): string => resolve(REPO, 'crates/forma-ir/tests/fixtures/js-emitter', `${name}.ir`);

test('describe: nested-islands declares two page strings and three island occurrences over two schemas', () => {
  const described = describeModule(ir('nested-islands'));
  assert.deepEqual(described.schema[0], [
    { name: 'panelClass', type: { kind: 'string' } },
    { name: 'badgeTitle', type: { kind: 'string' } },
  ]);
  assert.deepEqual(described.islands.map(island => [island.id, island.name, island.schemaObject]), [[0, 'OuterPanel', 1], [1, 'InnerBadge', 2], [2, 'InnerBadge', 2]]);
  assert.deepEqual(described.schema[2], [{ name: 'title', type: { kind: 'string' } }]);
  assert.ok(described.islands.every(island => /^[0-9a-f]{16}$/.test(island.h)), 'each island carries its contract digest');
  assert.deepEqual(described.slots.filter(slot => slot.source === 'server').map(slot => slot.name), ['panelClass', 'badgeTitle']);
});

test('describe: create-show declares no props and no island; its state is its client-owned slot table', () => {
  const described = describeModule(ir('create-show'));
  assert.deepEqual(described.schema, [[]]);
  assert.deepEqual(described.islands, []);
  assert.ok(described.slots.length > 0 && described.slots.every(slot => slot.source === 'client'));
});

test('render: one entry per state; the walker escapes for transport, applies rule 1 to the visible value and keeps the state exact', () => {
  const [plain, ruled] = renderStates(ir('nested-islands'), [
    { panelClass: '</script>', badgeTitle: 'b' },
    { panelClass: 'a\0b\r\nc', badgeTitle: 't' },
  ]) as Rendered[];
  assert.ok(plain && ruled);
  assert.match(plain.html, /^<main id="app"><!--f:i0--><div data-forma-island="0"/);
  assert.ok(plain.html.includes('class="&lt;/script&gt;"'), plain.html);
  assert.ok(!plain.html.includes('</script>'), 'no raw </script> in the body');
  assert.ok(plain.counts.nodes > 0 && plain.counts.bytes === Buffer.byteLength(plain.html));
  assert.ok(ruled.html.includes('class="a�b\nc"'), 'NUL to U+FFFD and CRLF to LF in the attribute value');
  const state = JSON.parse(ruled.state) as { i: { p: Record<string, string> }[] };
  assert.equal(state.i[0]!.p.panelClass, 'a\0b\r\nc', 'transport is exact');
});

test('render: a state the walker cannot take is an entry naming the reason, not a crash', () => {
  const [notObject, wrongType, missing] = renderStates(ir('nested-islands'), ['x', { panelClass: 5, badgeTitle: 'b' }, {}]) as RenderError[];
  assert.match(notObject!.error, /not slot JSON/);
  assert.match(wrongType!.error, /InvalidIslandState.*panelClass/);
  assert.deepEqual(wrongType!.componentPath, ['OuterPanel']);
  assert.match(missing!.error, /InvalidIslandState/);
});

test('a module that is not there fails loudly, naming the command and the path', () => {
  assert.throws(() => describeModule(resolve(REPO, 'crates/forma-ir/tests/fixtures/js-emitter/no-such-module.ir')), /parity_render describe .*no-such-module\.ir failed \(1\).*No such file/s);
});

test('typed: the synthesized manifest loads through the production loader, binds DynProps and renders the server\'s own document and headers', () => {
  const manifest = synthesizeManifest({ app: 'Nested Islands', irFile: 'nested-islands.ir', ir: readFileSync(ir('nested-islands')), boot: BOOT_SOURCE });
  assert.equal(manifest.app, 'parity-nested-islands', 'the app name is reduced to the worker-namespace grammar');
  assert.equal(integrity('export {};\n'), 'sha384-z0dQZuTpVhlJhRpzBVjQTCgdq+BUSh89DMD4c8ea5gn4XTF+416jeLVKPWSl2O8q');
  const [module] = renderTyped([typedRequest('nested-islands', ir('nested-islands'), [{ panelClass: '</script>', badgeTitle: 'b' }])]);
  assert.deepEqual(module!.bind, []);
  const [render] = module!.renders;
  assert.ok(render && 'document' in render, JSON.stringify(render));
  const nonce = /nonce="([^"]+)"/.exec(render.document)?.[1];
  assert.ok(nonce, 'the document carries a nonce');
  assert.match(render.headers['content-security-policy']!, new RegExp(`script-src 'nonce-${nonce.replace(/[+/=]/g, c => `\\${c}`)}' 'strict-dynamic'`));
  assert.match(render.headers['content-security-policy']!, /require-trusted-types-for 'script'/);
  assert.ok(render.document.includes(`src="/_assets/${BOOT_FILE}" integrity="${integrity(BOOT_SOURCE)}"`), 'the boot is the route script, integrity-checked');
  assert.ok(render.document.includes('<div id="app" data-forma-build="parity" data-forma-ssr><main id="app"><!--f:i0-->'), 'the root names the manifest\'s build (FORMA-186)');
  assert.ok(render.document.includes('class="&lt;/script&gt;"'));
  assert.match(render.document, /<script type="application\/json" data-island-state>\{"v":1,/);
});

test('typed: generated states of every declared type render, and the refusal table is refused with its code at its path', () => {
  const described = describeModule(propsContract);
  const schema = described.schema;
  const keyPaths = described.keys.map(key => key.path);
  assert.deepEqual(described.keys.map(key => [key.slot, key.path]), [['rows', ['id']], ['rows', ['id']]], 'two keyed views of rows, by id');
  const generated = Array.from({ length: 10 }, (_, index) => generate(schema, 'forma-183', index, { module: 'props-contract', keyPaths }));
  const base = generate(schema, 'forma-183', 1, { module: 'props-contract', keyPaths }) as Record<string, Json>;
  assert.equal((base.rows as Json[]).length, 1, 'state 1 has one row, so rows[0] exists');
  const refusals: { state: Record<string, Json>; code: string; path: string }[] = REFUSALS.map(refusal => ({
    state: { ...base, [refusal.type === 'number' ? 'safeCount' : 'at']: refusal.value },
    code: refusal.code, path: refusal.type === 'number' ? 'safeCount' : 'at',
  }));
  refusals.push({ state: { ...base, mode: 'unknown' }, code: 'RENDER-404', path: 'mode' });
  refusals.push({ state: { ...base, title: 7 }, code: 'RENDER-404', path: 'title' });
  refusals.push({ state: { ...base, rows: [{ ...(base.rows as Record<string, Json>[])[0]!, id: 'one' }] }, code: 'RENDER-404', path: 'rows[0].id' });
  const { title: _omitted, ...missing } = base;
  refusals.push({ state: missing, code: 'RENDER-404', path: 'title' });
  const [module] = renderTyped([typedRequest('props-contract', propsContract, [...generated, ...refusals.map(r => r.state)])]);
  assert.deepEqual(module!.bind, []);
  module!.renders.slice(0, 10).forEach((render, index) => assert.ok('document' in render, `generated state ${index} renders: ${JSON.stringify(render)}`));
  module!.renders.slice(10).forEach((render, k) => {
    assert.ok('refused' in render, `refusal ${k} is refused: ${JSON.stringify(render)}`);
    assert.equal(render.refused.code, refusals[k]!.code, JSON.stringify(refusals[k]!.state[refusals[k]!.path]));
    assert.equal(render.refused.path, refusals[k]!.path);
  });
});

test('typed: a module the production loader refuses is that module\'s entry with the loader\'s code, and the batch goes on', () => {
  const missing = { ...typedRequest('nested-islands', ir('nested-islands'), [{ panelClass: 'a', badgeTitle: 'b' }]), files: { 'nested-islands.ir': join(scratch, 'absent.ir'), [BOOT_FILE]: bootPath } };
  const [refused, fine] = renderTyped([missing, typedRequest('create-show', ir('create-show'), [{}])]);
  assert.deepEqual(refused!.bind.map(error => error.code), ['LOAD-101'], JSON.stringify(refused!.bind));
  assert.deepEqual(refused!.renders, []);
  assert.deepEqual(fine!.bind, []);
  assert.ok('document' in fine!.renders[0]!);
});

test('typed: string row keys stay unique under rule 1, so a 32-row keyed list renders where two edges are one text', () => {
  const ir = resolve(REPO, 'crates/forma-ir/tests/fixtures/island-emitter/aggregate-fallback.ir');
  const described = describeModule(ir);
  assert.deepEqual(described.keys.map(key => key.path), [['id']], 'rows keyed by a string id');
  const keyPaths = described.keys.map(key => key.path);
  const states: Json[] = [];
  for (let index = 0; states.length < 4 && index < 400; index++) {
    const state = generate(described.schema, 'forma-183', index, { module: 'aggregate-fallback', keyPaths }) as { rows?: { id: string }[] };
    // The rows that would collide without the position suffix: "\r\n" and "\r" are one text after rule 1.
    if ((state.rows?.length ?? 0) >= 32) states.push(state as Json);
  }
  assert.equal(states.length, 4, 'four 32-row states');
  const ruleOne = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\0/g, '�');
  for (const state of states as { rows: { id: string }[] }[]) {
    const keys = state.rows.map(row => ruleOne(row.id));
    assert.equal(new Set(keys).size, keys.length, 'unique key texts');
  }
  const [module] = renderTyped([typedRequest('aggregate-fallback', ir, states)]);
  assert.deepEqual(module!.bind, []);
  module!.renders.forEach((render, k) => assert.ok('document' in render, `state ${k} renders: ${JSON.stringify(render).slice(0, 200)}`));
});
