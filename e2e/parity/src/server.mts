/**
 * The server side: `crates/forma-server/examples/parity_render.rs`, run through cargo so the
 * walker under test is this tree's. `CARGO_TARGET_DIR` is honoured (several agents share this
 * machine; each keeps its own target directory).
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

function run(command: 'describe' | 'render', ir: string, input?: string): string {
  const result = spawnSync('cargo', ['run', '--quiet', '--locked', '-p', 'forma-server', '--example', 'parity_render', '--', command, ir], {
    cwd: REPO, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, timeout: 600_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`parity_render ${command} ${ir} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}

export function describeModule(ir: string): Described {
  return JSON.parse(run('describe', ir)) as Described;
}

/** The low-level path: states as slot JSON by slot name (the typed path through `Pages::bind` is FORMA-183's second slice). */
export function renderStates(ir: string, states: readonly unknown[]): readonly (Rendered | RenderError)[] {
  return JSON.parse(run('render', ir, JSON.stringify({ states }))) as (Rendered | RenderError)[];
}
