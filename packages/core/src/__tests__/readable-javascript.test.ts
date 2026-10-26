import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, type Options } from 'tsup';
import { stripDeliveryComments } from '../../scripts/readable-javascript.mjs';
import configs from '../../tsup.config';

describe('readable JavaScript delivery', () => {
  it('removes only descriptive comments while preserving behavior and every token position', () => {
    const code = String.raw`/*! SPDX-License-Identifier: MIT */
// descriptive source label
const marker = "/* string content */";
const template = \`// template content\`;
const pattern = /\/\* pattern \*\//;
class Counter {
  /** descriptive method documentation */
  value() { return 7; }
}
const retained = /* @__PURE__ */ new Counter();
globalThis.result = [retained.value(), marker, template, pattern.test('/* pattern */')];
`.replace(/\\`/g, '`') + '/' + '/# sourceMappingURL=artifact.js.map\n';
    const printed = stripDeliveryComments(code);
    expect(printed).not.toContain('descriptive');
    expect(printed).toContain('SPDX-License-Identifier: MIT');
    expect(printed).toContain('/* @__PURE__ */');
    expect(printed).toContain('//# sourceMappingURL=artifact.js.map');
    expect(printed.length).toBe(code.length);
    expect(printed.indexOf('value()')).toBe(code.indexOf('value()'));
    expect(printed.split('\n').map(line => line.length)).toEqual(code.split('\n').map(line => line.length));
    const original: { result?: unknown } = {}, actual: { result?: unknown } = {};
    runInNewContext(code, original); runInNewContext(printed, actual);
    expect(actual.result).toEqual([7, '/* string content */', '// template content', true]);
    expect(actual.result).toEqual(original.result);
  });

  it('the real split build preserves licenses and maps while omitting descriptive comments', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'forma-readable-'));
    const input = join(directory, 'fixture.ts'), output = join(directory, 'dist');
    const source = `/*! Copyright fixture authors; MIT */
export class ReadableCounter {
  /** fixture documentation */
  value() { return 7; }
}
export const counters = /* @__PURE__ */ new Map();
`;
    writeFileSync(input, source);
    try {
      const base = (configs as Options[]).find(config => Object.keys(config.entry ?? {}).includes('index'))!;
      await build({ ...base, config: false, entry: { fixture: input }, format: ['esm'],
        outDir: output, dts: false, sourcemap: true, silent: true });
      const code = readFileSync(join(output, 'fixture.js'), 'utf8');
      const map = JSON.parse(readFileSync(join(output, 'fixture.js.map'), 'utf8'));
      expect(code).toContain('Copyright fixture authors; MIT');
      expect(code).not.toContain('fixture documentation');
      expect(code).toContain('ReadableCounter');
      expect(code).toContain('/* @__PURE__ */');
      expect(code.split('\n').length).toBeGreaterThan(5);
      expect(map.sourcesContent).toContain(source);
      expect(map.mappings.length).toBeGreaterThan(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
