import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { instrumentRenderCounts } from './render-counts-source.mjs';

const source = readFileSync(new URL('../contestants/forma/src/main.rs', import.meta.url), 'utf8');
test('counts instrumentation changes only the SSR response, leaving the island handler intact', () => {
  const result = instrumentRenderCounts(source);
  assert.equal(result.split('GP_RENDER_COUNTS_INSTRUMENTATION').length, 2);
  assert.equal(result.slice(result.indexOf('\nasync fn island_route')), source.slice(source.indexOf('\nasync fn island_route')));
  assert(result.indexOf('let counts = page.counts();') < result.indexOf('let mut response = page.into_response();', result.indexOf('async fn ssr(')));
});
test('response drift fails before another handler can be instrumented', () => {
  assert.throws(() => instrumentRenderCounts(source.replace('Ok(page) => page.into_response(),', 'Ok(page) => other(page),')));
  assert.throws(() => instrumentRenderCounts(source + '\nasync fn ssr() {}'));
  assert.throws(() => instrumentRenderCounts(instrumentRenderCounts(source)));
});
