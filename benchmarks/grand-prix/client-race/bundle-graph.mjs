// Read-only static graph collection. Node parses module syntax but never executes it.
import { readFile, realpath, lstat, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const parser = `import { SourceTextModule } from 'node:vm';
import { readFileSync } from 'node:fs';
process.stdout.write(JSON.stringify(new SourceTextModule(readFileSync(0, 'utf8')).dependencySpecifiers));`;
export function staticImports(source, label = 'module') {
  const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-vm-modules', '--input-type=module', '-e', parser], {
    input: source, encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`Cannot parse static imports in ${label}: ${result.error?.message || result.stderr.slice(-2000)}`);
  return JSON.parse(result.stdout);
}
function attributes(text) {
  const out = {};
  for (const match of text.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = match[1].toLowerCase();
    if (Object.hasOwn(out, name)) throw new Error('Duplicate HTML attribute: ' + name);
    out[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return out;
}
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function referenceFile(root, reference, from, isImport) {
  if (!reference || reference.trim() !== reference || reference.includes('&') || reference.includes('\\') || /[?#]/.test(reference)) throw new Error('Unsupported script reference: ' + reference);
  let decoded;
  try { decoded = decodeURIComponent(reference); } catch { throw new Error('Invalid encoded script reference: ' + reference); }
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('//')) throw new Error('Unmeasured remote or non-file JavaScript: ' + reference);
  if (isImport && !decoded.startsWith('./') && !decoded.startsWith('../') && !decoded.startsWith('/')) throw new Error('Unsupported bare static import: ' + reference);
  const file = decoded.startsWith('/') ? path.resolve(root, '.' + decoded) : path.resolve(from ? path.dirname(from) : root, decoded);
  if (!inside(root, file)) throw new Error('JavaScript reference escapes dist: ' + reference);
  if (!/\.m?js$/i.test(file)) throw new Error('Unsupported non-JavaScript static module: ' + reference);
  return file;
}
export async function collectBundle(dist) {
  const root = path.resolve(dist);
  if ((await lstat(root)).isSymbolicLink()) throw new Error('dist must not be a symbolic link');
  const canonicalRoot = await realpath(root);
  async function readContained(file) {
    const canonicalFile = await realpath(file);
    if (!inside(canonicalRoot, canonicalFile)) throw new Error('JavaScript symlink escapes dist: ' + path.relative(root, file));
    if (!(await stat(canonicalFile)).isFile()) throw new Error('Expected a regular file: ' + file);
    return readFile(canonicalFile);
  }
  const html = (await readContained(path.join(root, 'index.html'))).toString('utf8').replace(/<!--[\s\S]*?-->/g, '');
  if (/<base\b/i.test(html)) throw new Error('HTML base URLs are unsupported by the bundle measurement');
  const entries = [], inlineSources = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = attributes(match[1]), type = (attrs.type || '').toLowerCase();
    if (type === 'importmap') throw new Error('Import maps require a separately supported bundle protocol');
    if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
    if (Object.hasOwn(attrs, 'nomodule')) throw new Error('nomodule scripts require a separately supported bundle protocol');
    if (Object.hasOwn(attrs, 'src')) entries.push(attrs.src);
    else if (match[2].trim()) inlineSources.push(match[2]);
  }
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = attributes(match[1]);
    if ((attrs.rel || '').toLowerCase().split(/\s+/).includes('modulepreload')) {
      if (!attrs.href) throw new Error('modulepreload is missing href');
      entries.push(attrs.href);
    }
  }
  const files = new Map();
  async function walk(reference, from = null, isImport = false) {
    const file = referenceFile(root, reference, from, isImport);
    if (files.has(file)) return;
    let bytes;
    try { bytes = await readContained(file); } catch (error) { throw new Error(`Cannot measure referenced JavaScript ${reference}: ${error.message}`); }
    files.set(file, { file: path.relative(root, file), bytes });
    for (const imported of staticImports(bytes.toString('utf8'), reference)) await walk(imported, file, true);
  }
  for (const entry of entries) await walk(entry);
  for (const source of inlineSources) for (const imported of staticImports(source, 'inline script')) await walk(imported, path.join(root, 'index.html'), true);
  if (!files.size && !inlineSources.length) throw new Error('No reachable JavaScript for this interactive workload');
  return { files: [...files.values()], inlineSources };
}
