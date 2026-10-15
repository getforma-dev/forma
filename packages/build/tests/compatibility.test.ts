import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptsWriter, baseVersion, checkProjectCompatibility, nearestFile, resolveAppName } from '../src/compatibility';

const vectors = JSON.parse(readFileSync(new URL('../../../crates/forma-ir/tests/fixtures/compatibility/version-pairs.json', import.meta.url), 'utf8')) as {reader: string; writer: string; accepted: boolean}[];
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'forma-window-'));
  roots.push(root);
  const nested = join(root, 'admin', 'src');
  mkdirSync(nested, { recursive: true });
  return {root, nested, lock: join(root, 'Cargo.lock')};
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, {recursive: true, force: true})));
function locked(version: string) {
  return `version = 4\n# name = "forma-server"\n[[package]]\nname = "decoy"\nversion = "99.0.0"\n[[package]]\nname = 'forma-server'\nversion = '${version}'\n`;
}

describe('the shared reader/writer window at the real Cargo.lock boundary', () => {
  it.each(vectors)('$writer -> $reader accepted=$accepted', ({reader, writer, accepted}) => {
    expect(acceptsWriter(baseVersion(reader), baseVersion(writer))).toBe(accepted);
    const {root, nested, lock} = fixture();
    writeFileSync(lock, locked(reader));
    const run = () => checkProjectCompatibility(nested, [{name: '@getforma/compiler', version: baseVersion(writer)}], true);
    if (accepted) expect(run()).toEqual([]);
    else {
      expect(run).toThrow(`writer ${baseVersion(writer).join('.')} is incompatible with forma-server ${reader}`);
      expect(run).toThrow(`upgrade forma-server to at least ${baseVersion(writer)[0]}.${baseVersion(writer)[1]}.0`);
      expect(readFileSync(lock, 'utf8')).toBe(locked(reader));
    }
    expect(nearestFile(nested, 'Cargo.lock')).toBe(join(root, 'Cargo.lock'));
  });

  it('checks both the manifest writer and the module writer', () => {
    const {nested, lock} = fixture();
    writeFileSync(lock, locked('3.1.0'));
    expect(() => checkProjectCompatibility(nested, [
      {name: '@getforma/build', version: [3, 1, 0]}, {name: '@getforma/compiler', version: [3, 2, 0]},
    ], true)).toThrow('@getforma/compiler writer 3.2.0');
    expect(() => checkProjectCompatibility(nested, [
      {name: '@getforma/build', version: [3, 2, 0]}, {name: '@getforma/compiler', version: [3, 1, 0]},
    ], true)).toThrow('@getforma/build writer 3.2.0');
  });

  it('never skips a nearer malformed lock in favor of a good ancestor', () => {
    const {root, nested, lock} = fixture();
    writeFileSync(lock, locked('3.1.0'));
    const near = join(root, 'admin', 'Cargo.lock');
    writeFileSync(near, '[[package]\n');
    expect(() => checkProjectCompatibility(nested, [], true)).toThrow(`cannot parse ${near}`);
    expect(readFileSync(lock, 'utf8')).toBe(locked('3.1.0'));
  });

  it.each(['Cargo.lock', 'Cargo.toml'])('refuses a dangling nearer %s link while allowing absent and valid nearer links', name => {
    const {root, nested} = fixture();
    const content = name === 'Cargo.lock' ? locked('3.1.0') : '[package]\nname="ledger"\n';
    const ancestor = join(root, name), near = join(root, 'admin', name);
    writeFileSync(ancestor, content);
    const check = () => name === 'Cargo.lock' ? checkProjectCompatibility(nested, [{name: '@getforma/build', version: [3, 0, 0]}], true) : resolveAppName(nested);
    expect(() => check()).not.toThrow();
    expect(nearestFile(nested, name)).toBe(ancestor);
    symlinkSync(join(root, 'missing-target'), near, 'file');
    expect(check).toThrow(`cannot read ${near}`);
    rmSync(near);
    symlinkSync(ancestor, near, 'file');
    expect(() => check()).not.toThrow();
    expect(nearestFile(nested, name)).toBe(near);
  });

  it('does not take a comment or duplicate renderer table as the chosen version', () => {
    const {nested, lock} = fixture();
    writeFileSync(lock, locked('3.1.0') + '\n[[package]]\nname="forma-server"\nversion="2.9.0"\n');
    expect(() => checkProjectCompatibility(nested, [], true)).toThrow('resolves 2 forma-server packages');
    writeFileSync(lock, 'version=4\n# [[package]]\n# name="forma-server"\n[[package]]\nname="other"\nversion="3.0.0"\n');
    expect(() => checkProjectCompatibility(nested, [], true)).toThrow('has no forma-server package');
    expect(checkProjectCompatibility(nested, [], false)).toEqual([`BUILD-809 ${lock} has no forma-server package; startup compatibility could not be checked`]);
  });

  it('warns with the searched path when there is no lockfile', () => {
    const {nested} = fixture();
    expect(checkProjectCompatibility(nested, [], true)).toEqual([`BUILD-809 no Cargo.lock found from ${nested}; forma-server compatibility cannot be checked until startup`]);
  });

  it.each(['3.1', '03.1.0', '-1.2.3', '3.65536.0', '3.0.65536', '3.1.0junk', '3.1.0-'])('refuses malformed/overflow package version %s', value => {
    expect(() => baseVersion(value)).toThrow('BUILD-809');
    expect(baseVersion('3.1.0-dev')).toEqual([3, 1, 0]);
  });

  it('rejects unsafe TOML keys rather than letting metadata alter prototypes', () => {
    const {nested, lock} = fixture();
    writeFileSync(lock, locked('3.0.0') + '\n[__proto__]\npolluted=true\n');
    expect(() => checkProjectCompatibility(nested, [], true)).toThrow('cannot parse');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('stable application identity resolution', () => {
  it('takes explicit identity or an already valid Cargo package name, without normalizing', () => {
    const {root, nested} = fixture();
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname="ledger"\nversion="0.1.0"\n');
    expect(resolveAppName(nested)).toBe('ledger');
    expect(resolveAppName(nested, 'other')).toBe('other');
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname="ledger_admin"\n');
    expect(() => resolveAppName(nested)).toThrow('configure app explicitly');
    expect(resolveAppName(nested, 'ledger-admin')).toBe('ledger-admin');
  });
  it('does not infer a name from the output directory or a virtual workspace', () => {
    const {root, nested} = fixture();
    expect(() => resolveAppName(nested)).toThrow('BUILD-815');
    writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers=[]\n');
    expect(() => resolveAppName(nested)).toThrow(join(root, 'Cargo.toml'));
    expect(resolveAppName(nested, 'explicit')).toBe('explicit');
  });
});
