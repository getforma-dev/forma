// The server half: crates/forma-server/examples/parity_render.rs through cargo, over committed
// corpus modules. The walker is the real one; nothing is stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describeModule, renderStates, REPO, type Rendered, type RenderError } from '../src/server.mts';

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
