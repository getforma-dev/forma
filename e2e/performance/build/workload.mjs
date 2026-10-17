// Fixed A9 representative, not a copy of an external application's source.
// Generate before measurement; all 300 definitions must appear in real SSR HTML.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const number = n => String(n).padStart(2, '0');
export const ROUTES = Array.from({ length: 12 }, (_, i) => `/page/${number(i)}`);
export const REVISION = 'n7-original-revision';
export const NEXT_REVISION = 'n7-updated-revision';
export const TIMED_ROUTE = ROUTES[0];
export const sharedFor = route => [0, 1, 2, 3].map(offset => `Shared${number((route * 2 + offset) % 24)}`);
export const expectedFor = route => [`Page${number(route)}`, ...sharedFor(route), ...Array.from({ length: 22 }, (_, j) => `Part${number(route)}_${number(j)}`)];
export const AFFECTED_ROUTES = ROUTES.filter((_, i) => sharedFor(i).includes('Shared00'));

export function sources() {
  const files = new Map();
  for (let i = 0; i < 24; i++) {
    const name = `Shared${number(i)}`;
    files.set(`shared/${name}.tsx`, `import { h } from '@getforma/core';\nexport function ${name}() { return <aside data-n7-component="${name}"><h2>Shared workspace ${i}</h2><p>${i === 0 ? REVISION : 'Reviewed application information'}</p><a href="/page/${number(i % 12)}">Open section</a></aside>; }\n`);
  }
  for (let i = 0; i < 12; i++) {
    const page = number(i);
    for (let j = 0; j < 22; j++) {
      const name = `Part${page}_${number(j)}`;
      const text = `Section ${i}, panel ${j}`;
      let body;
      if (j === 0) {
        body = `import { h, createSignal } from '@getforma/core';\ntype CounterProps = { count: number };\nexport function ${name}(props: CounterProps) { const [count, setCount] = createSignal(props.count); return <section data-n7-component="${name}"><h2>${text}</h2><output class="count">{() => count()}</output><button type="button" onClick={() => setCount(count() + 1)}>Increment</button></section>; }\n`;
      } else {
        const contents = [
          `<h2>${text}</h2><p>Current project information and a meaningful descriptive summary.</p><a href="/page/${number((i + 1) % 12)}">Next section</a>`,
          `<h2>${text}</h2><label>Project name <input type="text" value="Workspace ${i}" /></label><p>Review the name before saving.</p>`,
          `<h2>${text}</h2><dl><dt>Status</dt><dd>Active</dd><dt>Owner</dt><dd>Team ${i}</dd></dl>`,
          `<h2>${text}</h2><table><tbody><tr><th>Category</th><td>Operations</td></tr><tr><th>Region</th><td>Local</td></tr></tbody></table>`,
        ][j % 4];
        body = `import { h } from '@getforma/core';\nexport function ${name}() { return <section data-n7-component="${name}">${contents}</section>; }\n`;
      }
      files.set(`page${page}/${name}.tsx`, body);
    }
    const imports = [...sharedFor(i).map(name => `import { ${name} } from '../shared/${name}.tsx';`), ...Array.from({ length: 22 }, (_, j) => `import { Part${page}_${number(j)} } from './Part${page}_${number(j)}.tsx';`)];
    files.set(`page${page}/app.tsx`, `import { h, mount, activateIslands, createList, createShow } from '@getforma/core';\n${imports.join('\n')}\ntype Row = { id: number; label: string };\ntype PageProps = { count: number; title: string; rows: Row[]; showNotice: boolean };\nfunction Page${page}(props: PageProps) { return <main data-n7-component="Page${page}"><h1>{props.title}</h1>${sharedFor(i).map(name => `<${name} />`).join('')}<div class="panels"><Part${page}_00 count={props.count} />${Array.from({ length: 21 }, (_, j) => `<Part${page}_${number(j + 1)} />`).join('')}</div>{createShow(() => props.showNotice, () => <p class="notice">Pending review</p>)}<ul>{createList(() => props.rows, row => row.id, row => <li>{row.label}</li>)}</ul></main>; }\nawait activateIslands({ Part${page}_00 });\nmount(() => Page${page}({ count: 0, title: 'Workspace ${i}', rows: [{ id: 1, label: 'Open' }, { id: 2, label: 'Closed' }], showNotice: true }), '#app');\n`);
  }
  return files;
}

export function assertGraph(files) {
  const definitions = new Map();
  for (const [path, source] of files) {
    const names = [...source.matchAll(/(?:export )?function ((?:Shared|Part|Page)[\w]+)\(/g)].map(match => match[1]);
    assert.equal(names.length, 1, `${path}: exactly one named component definition`);
    assert(!definitions.has(names[0]), `duplicate definition ${names[0]}`);
    assert(source.includes(`data-n7-component="${names[0]}"`), `${path}: missing observable component marker`);
    definitions.set(names[0], path);
  }
  assert.equal(definitions.size, 300, 'A9 needs 300 distinct definitions');
  const reached = new Set();
  for (let i = 0; i < 12; i++) {
    const entry = files.get(`page${number(i)}/app.tsx`);
    for (const name of expectedFor(i)) {
      const path = definitions.get(name);
      assert(path, `${name}: missing definition`);
      if (!name.startsWith('Page')) {
        assert(entry.includes(`import { ${name} } from `), `${name}: not imported by its page`);
        assert(entry.includes(`<${name} `), `${name}: not rendered by its page`);
      }
      reached.add(name);
    }
  }
  assert.equal(reached.size, 300, 'every definition must be reachable');
  return [...reached];
}

export function materialize(root) {
  const files = sources();
  const inventory = assertGraph(files);
  for (const [file, source] of files) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  return inventory;
}

export function changeRevision(root) {
  const path = join(root, 'shared/Shared00.tsx');
  const before = readFileSync(path, 'utf8');
  assert.equal(before.split(REVISION).length, 2, 'exactly one predeclared edit');
  const after = before.replace(REVISION, NEXT_REVISION);
  writeFileSync(path, after);
  return { path, before, after };
}
