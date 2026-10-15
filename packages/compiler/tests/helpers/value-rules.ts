/**
 * Shared helpers for FORMA-182's compiled value-rule vectors (rules 4, 6 and
 * 7): each vector is a page source the compiler either builds (`code` null)
 * or refuses with the named code. The vector files are forma-ir's and core's
 * too (crates/forma-ir/tests/fixtures/parity/).
 */
import { expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateRealIr } from '../../src/esbuild-ssr-plugin';
import { collectDiagnostics } from '../../src/diagnostics';
import { renderDefaults, ZWSP } from './render';

export const VECTOR_DIR = resolve(__dirname, '../../../../crates/forma-ir/tests/fixtures/parity');
export const readVectors = <T>(name: string): T => JSON.parse(readFileSync(resolve(VECTOR_DIR, name), 'utf8')) as T;

export interface TextVector { id: string; props?: string; setup?: string; child?: string; attribute?: string; value?: string; code: string | null; slot?: string; writes?: string }
export interface ConditionVector { id: string; props?: string; setup?: string; condition?: string; child?: string; code: string | null; writes?: string; diagnostics?: string[] }

const folders: string[] = [];
export function cleanup(): void { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); }

/** Compile a declared page from its source: its FMIR and the codes of every
 * diagnostic it reported. A refusal throws with its code. */
export function emitDeclaredPage(page: string): { binary: Uint8Array; codes: string[] } {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const dir = mkdtempSync(join(tmpdir(), 'forma-value-rules-')); folders.push(dir);
  writeFileSync(join(dir, 'app.ts'), `import { mount } from '@getforma/core'; import { Page } from './page'; mount(() => Page(), '#app');`);
  writeFileSync(join(dir, 'page.ts'), page);
  const { result, diagnostics } = collectDiagnostics(() => generateRealIr(join(dir, 'app.ts')));
  expect(result, 'an admitted page must emit actual IR').not.toBeNull();
  return { binary: result!.binary, codes: diagnostics.map(diagnostic => diagnostic.code) };
}

/** The text a browser shows for a page under its slot defaults: tags,
 * markers and the empty range's U+200B removed. */
export function visibleText(binary: Uint8Array): string {
  return renderDefaults(binary, { stripMarkers: true }).replace(/<[^>]*>/g, '').split(ZWSP).join('');
}

const head = `import { h, createSignal, createShow } from '@getforma/core';\n`;

export function textPage(vector: TextVector): string {
  const body = vector.attribute !== undefined
    ? `h('p', { ${vector.attribute}: ${vector.value} }, 'x')`
    : `h('p', null, ${vector.child})`;
  return `${head}${vector.setup ?? ''}\nexport function Page(props: ${vector.props ?? '{}'}) { return h('main', null, ${body}); }`;
}

export function conditionPage(vector: ConditionVector): string {
  const body = vector.child !== undefined
    ? vector.child
    : `createShow(${vector.condition}, () => h('b', null, 'yes'), () => h('i', null, 'no'))`;
  return `${head}${vector.setup ?? ''}\nexport function Page(props: ${vector.props ?? '{}'}) { return h('main', null, ${body}); }`;
}

export const refusal = (code: string | null): RegExp => new RegExp(`^${code} `);
