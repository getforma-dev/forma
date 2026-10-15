/** Install ranges, build guards and runtime readers share the same numeric window. */
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import metadata from '../package.json';
import { APP_NAME } from './service-worker.js';

export type Version = readonly [number, number, number];
const PACKAGE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

export function baseVersion(value: string): Version {
  const match = PACKAGE_VERSION.exec(value);
  if (!match) throw new Error(`BUILD-809 invalid package version ${JSON.stringify(value)}: expected X.Y.Z[-prerelease]`);
  const triple = match.slice(1, 4).map(Number);
  if (triple.some(n => !Number.isInteger(n) || n > 0xffff)) throw new Error(`BUILD-809 version ${value} exceeds FMIR's u16 version fields`);
  return triple as unknown as Version;
}

export const BUILD_WRITER_VERSION: Version = baseVersion(metadata.version);
export function acceptsWriter(reader: Version, writer: Version): boolean {
  return reader[0] === writer[0] && writer[1] <= reader[1];
}

/** The first matching file wins. An unreadable nearer file is never skipped. */
export function nearestFile(start: string, name: string): string | undefined {
  for (let directory = resolve(start);; directory = dirname(directory)) {
    const file = join(directory, name);
    let exists = false;
    try { lstatSync(file); exists = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`BUILD-809 cannot read ${file}: ${(error as Error).message}`);
    }
    if (exists) {
      try {
        if (!statSync(file).isFile()) throw new Error('path is not a file');
        return file;
      } catch (error) {
        // A present dangling link is an unreadable nearest file, not absence.
        throw new Error(`BUILD-809 cannot read ${file}: ${(error as Error).message}`);
      }
    }
    if (dirname(directory) === directory) return undefined;
  }
}

function readToml(file: string): Record<string, unknown> {
  try {
    if (statSync(file).size > 16 * 1024 * 1024) throw new Error('file exceeds the 16 MiB build metadata limit');
    return parse(readFileSync(file, 'utf8'), { unsafeKeyBehaviour: 'throw' });
  } catch (error) {
    throw new Error(`BUILD-809 cannot parse ${file}: ${(error as Error).message}`);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** No Cargo process or network lookup: the lock is the application's resolved graph. */
export function checkProjectCompatibility(
  start: string,
  writers: readonly { name: string; version: Version }[],
  requiresServer: boolean,
): string[] {
  const file = nearestFile(start, 'Cargo.lock');
  if (!file) return [`BUILD-809 no Cargo.lock found from ${resolve(start)}; forma-server compatibility cannot be checked until startup`];
  const lock = readToml(file);
  if (!Array.isArray(lock.package)) throw new Error(`BUILD-809 ${file}: Cargo.lock has no package array`);
  const servers = lock.package.filter(p => object(p) && p.name === 'forma-server');
  if (servers.length === 0) {
    const message = `BUILD-809 ${file} has no forma-server package; startup compatibility could not be checked`;
    if (requiresServer) throw new Error(message);
    return [message];
  }
  if (servers.length !== 1) throw new Error(`BUILD-809 ${file} resolves ${servers.length} forma-server packages; make the renderer version unambiguous before building`);
  const server = servers[0] as Record<string, unknown>;
  if (typeof server.version !== 'string') throw new Error(`BUILD-809 ${file}: forma-server version must be a string`);
  const reader = baseVersion(server.version);
  for (const writer of writers) {
    if (!acceptsWriter(reader, writer.version)) {
      throw new Error(`BUILD-809 ${writer.name} writer ${writer.version.join('.')} is incompatible with forma-server ${server.version} in ${file}; upgrade forma-server to at least ${writer.version[0]}.${writer.version[1]}.0 within major ${writer.version[0]} before rebuilding`);
    }
  }
  return [];
}

/** An explicit application ID wins; only an already-valid Cargo name is inferred. */
export function resolveAppName(start: string, explicit?: string): string {
  if (explicit !== undefined) {
    if (!APP_NAME.test(explicit)) throw new Error('BUILD-815 app must use 1 to 63 lowercase letters, digits or hyphens, starting with a letter or digit');
    return explicit;
  }
  const manifest = nearestFile(start, 'Cargo.toml');
  if (manifest) {
    const cargo = readToml(manifest);
    const name = object(cargo.package) ? cargo.package.name : undefined;
    if (typeof name === 'string' && APP_NAME.test(name)) return name;
  }
  throw new Error(`BUILD-815 configure app explicitly: no valid application name in ${manifest ?? `a Cargo.toml above ${resolve(start)}`}; use the same app as forma-server's ServiceWorker::for_app`);
}

/** npm may override an optional peer conflict; the build still refuses it. */
export function requireCompatibleCompiler(compiler: Version, build: Version = BUILD_WRITER_VERSION): void {
  if (!acceptsWriter(compiler, build)) throw new Error(`BUILD-809 @getforma/build ${build.join('.')} requires @getforma/compiler from major ${build[0]} at least ${build[0]}.${build[1]}.0; installed compiler is ${compiler.join('.')}`);
}
