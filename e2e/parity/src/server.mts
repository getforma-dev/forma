/**
 * The server side: `crates/forma-server/examples/parity_render.rs`, built once by cargo from this
 * tree (so the walker and the server under test are this tree's) and then run directly. Cargo's
 * own `CARGO_TARGET_DIR` is honoured (several agents share a machine; each keeps its own).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Schema } from './generate.mts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));

export interface Described {
  readonly schema: Schema;
  readonly islands: readonly { readonly id: number; readonly name: string; readonly schemaObject: number; readonly h: string }[];
  readonly slots: readonly { readonly id: number; readonly name: string; readonly type: string; readonly source: 'server' | 'client'; readonly default: string }[];
}

export interface Rendered {
  readonly html: string;
  readonly state: string;
  readonly counts: { readonly nodes: number; readonly bytes: number; readonly listIterations: number };
}
export interface RenderError { readonly error: string; readonly componentPath?: readonly string[] }

/** A typed-path refusal: a bind code (`BIND-1xx`) or a checked value code (`RENDER-401..404`). */
export interface Refusal { readonly code: string; readonly route: string; readonly path: string; readonly message: string }
export type TypedRender =
  | { readonly document: string; readonly headers: Readonly<Record<string, string>> }
  | { readonly refused: Refusal }
  | { readonly error: { readonly code: string; readonly message: string } };
export interface TypedModule {
  readonly name: string;
  readonly bind: readonly Refusal[];
  readonly renders: readonly TypedRender[];
}
export interface TypedRequest {
  readonly name: string;
  readonly route: string;
  readonly manifest: unknown;
  /** Manifest file name to an absolute path the production loader reads it from. */
  readonly files: Readonly<Record<string, string>>;
  readonly states: readonly unknown[];
}

let binary: string | undefined;

/** Build the example once and return its executable (cargo prints it in its JSON messages). */
export function parityRender(): string {
  if (binary) return binary;
  const result = spawnSync('cargo', ['build', '--quiet', '--locked', '-p', 'forma-server', '--example', 'parity_render', '--message-format=json'], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`building parity_render failed (${result.status}): ${result.stderr}`);
  for (const line of result.stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    const message = JSON.parse(line) as { reason?: string; target?: { name?: string }; executable?: string | null };
    if (message.reason === 'compiler-artifact' && message.target?.name === 'parity_render' && message.executable) binary = message.executable;
  }
  if (!binary) throw new Error('cargo built parity_render but named no executable');
  return binary;
}

function run(args: readonly string[], input?: string): string {
  const result = spawnSync(parityRender(), args, { cwd: REPO, encoding: 'utf8', input, maxBuffer: 512 * 1024 * 1024, timeout: 600_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`parity_render ${args.join(' ')} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}

export function describeModule(ir: string): Described {
  return JSON.parse(run(['describe', ir])) as Described;
}

/** The low-level path: states as slot JSON by slot name, through `walk_to_html_counted`. */
export function renderStates(ir: string, states: readonly unknown[]): readonly (Rendered | RenderError)[] {
  return JSON.parse(run(['render', ir], JSON.stringify({ states }))) as (Rendered | RenderError)[];
}

/** The application's path, for many modules in one process: load, bind, finalize, render each state. */
export function renderTyped(modules: readonly TypedRequest[]): readonly TypedModule[] {
  return JSON.parse(run(['typed'], JSON.stringify({ modules }))) as TypedModule[];
}
