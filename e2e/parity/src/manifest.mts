/**
 * A schema-2 manifest around one corpus module, as `@getforma/build` would write for a one-page
 * application: the module on route `/` in SSR mode, and one JavaScript entry (the harness's boot)
 * so the served document loads it under the server's own policy. Integrity is the canonical
 * SHA-384 of each file's bytes, which the production loader checks before it binds.
 */
import { createHash } from 'node:crypto';

export const BOOT_FILE = 'parity-boot.js';

export function integrity(bytes: Uint8Array | string): string {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

export interface ManifestInput {
  readonly app: string;
  readonly irFile: string;
  readonly ir: Uint8Array;
  readonly boot: string;
}

export function synthesizeManifest(input: ManifestInput): Record<string, unknown> {
  // The manifest's app grammar is the worker namespace's: lowercase letters, digits and hyphens.
  const app = `parity-${input.app}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return {
    version: 2,
    writer: '3.0.0',
    app,
    build: 'parity',
    aliases: { [input.irFile]: input.irFile },
    assets: {
      [input.irFile]: { immutable: false, integrity: integrity(input.ir) },
      [BOOT_FILE]: { immutable: false, integrity: integrity(input.boot) },
    },
    routes: {
      '/': { mode: 'ssr', ir: input.irFile, js: [BOOT_FILE], css: [], fonts: [], modulepreload: [], total_size_br: 0, budget_warn_threshold: 0 },
    },
  };
}
