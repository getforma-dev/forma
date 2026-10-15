import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT, listFiles } from './helpers';

/**
 * Resolves the `Verified by:` citations this repo's docs and sources carry.
 *
 * The convention is load-bearing across the whole stack: a citation is what
 * tells the next reader that a documented behaviour is actually pinned. A
 * citation naming a test that does not exist is worse than no citation, because
 * it converts a reviewer's suspicion into confidence — so every one is resolved
 * here rather than reviewed.
 *
 * This only proves the citation *resolves*. Whether the cited test would fail
 * when the property breaks is the author's job, with the mutation probe
 * described in the stack testing policy.
 */

const CITATION = /Verified by:?\s+`?([\w./-]+\.test\.ts)`?\s*>\s*"([^"]+)"/g;

/** Docs and sources that may carry citations. Templates included: they ship. */
function citedFiles(): string[] {
  const roots = ['docs', 'src', 'tests', 'templates'];
  const out = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];
  for (const root of roots) {
    const dir = path.join(REPO_ROOT, root);
    if (!fs.existsSync(dir)) continue;
    for (const rel of listFiles(dir)) {
      if (/\.(md|ts|tsx)$/.test(rel) && !rel.includes('node_modules/')) {
        out.push(`${root}/${rel}`);
      }
    }
  }
  return out.filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));
}

describe('"Verified by" citations', () => {
  it('every citation names a test file that exists and a test that is in it', () => {
    const broken: string[] = [];
    let checked = 0;

    for (const rel of citedFiles()) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      for (const m of text.matchAll(CITATION)) {
        const [, cited, name] = m;
        checked += 1;
        const line = text.slice(0, m.index).split('\n').length;
        const target = path.join(REPO_ROOT, cited!);
        if (!fs.existsSync(target)) {
          broken.push(`${rel}:${line} → missing file ${cited}`);
          continue;
        }
        // A test name may be declared with any quote style, so accept all three.
        const source = fs.readFileSync(target, 'utf8');
        const declared =
          source.includes(`'${name}'`) || source.includes(`"${name}"`) || source.includes(`\`${name}\``);
        if (!declared) broken.push(`${rel}:${line} → no test named "${name}" in ${cited}`);
      }
    }

    expect(broken, 'fix or remove these citations').toEqual([]);
    // Two-sided: if the docs stop citing anything, this test must not go quietly
    // green — that would be the same "passes with the feature deleted" shape the
    // citations exist to prevent.
    expect(checked, 'the docs and sources should still carry citations').toBeGreaterThan(5);
  });
});
