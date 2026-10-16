// P17 over the fixture applications (FORMA-188; DR-30, DR-34, L-54). The same sources, `apps.json`
// and checks that apps.spec.ts runs against the working tree run here against the packed set: the
// three libraries come from DS11's tarballs, the Rust servers build against DS11's crates, and
// the browser judges the pages the packed servers send. Only whose `build` and whose crates run differs.
//
// The install lives outside the checkout (os.tmpdir()), so Node's upward search from the packed
// libraries cannot reach this tree's workspace links: alpha.1 failed in P17 because a built
// workstation hid exactly that, and the install here proves each `@getforma/*` import resolves
// inside it (`assertResolvesInside`).
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { CRATES, ROOT, digest, json, run, save, stageNpmLock } from './release-set.mjs';
import { auditCandidateSignatures } from './audit-release-signatures.mjs';
import { withOwnedServer } from './owned-server.mjs';
import { assertN2, n2Rows, readPackedSizes, shapeRow } from './release-measurements.mjs';

export const FIXTURES = join(ROOT, 'e2e/fixtures/apps');
const EXCLUDED = new Set(['out', 'node_modules', 'target', 'README.md', 'apps.spec.ts', 'build.sh']);
const LIBRARIES = ['core', 'compiler', 'build'];

/**
 * The project's own manifest: the three libraries at the set's exact version, and esbuild, which the
 * compiler names as a peer and loads from the application's own tree (without it the compiler cannot
 * lower JSX and falls back to a placeholder, BUILD-603; the templates declare it the same way).
 */
export function fixtureManifest(version, esbuild) {
  return {
    name: 'forma-fixture-apps', version: '0.0.0', private: true,
    dependencies: { '@getforma/core': `=${version}` },
    devDependencies: { '@getforma/build': `=${version}`, '@getforma/compiler': `=${version}`, esbuild },
  };
}

/** esbuild and its platform binaries, exactly as the tagged tree's lock pins them (nothing is resolved afresh). */
function esbuildEntries(rootLock) {
  const range = rootLock.packages?.['']?.devDependencies?.esbuild;
  assert(range && rootLock.packages['node_modules/esbuild'], 'the tagged tree\'s lock does not pin esbuild, the compiler\'s peer');
  const entries = {};
  for (const [key, entry] of Object.entries(rootLock.packages)) {
    if (key !== 'node_modules/esbuild' && !key.startsWith('node_modules/@esbuild/')) continue;
    assert(entry.version && entry.resolved && entry.integrity, `${key}: the tagged tree's lock holds no integrity-pinned archive`);
    const copy = structuredClone(entry);
    for (const flag of ['dev', 'devOptional', 'peer', 'optional']) delete copy[flag];
    if (key.startsWith('node_modules/@esbuild/')) copy.optional = true;
    entries[key] = copy;
  }
  return { range, entries };
}

/**
 * The manifest and lock for the packed install. The lock starts as an empty seed with one entry per
 * library; `stageNpmLock` fills each from DS11's bytes and copies every external package from the
 * tagged tree's own lock (nothing is resolved afresh), then localizes the three to their tarballs.
 */
export function stageFixtureNpm(packages, artifactDir, rootLock) {
  const candidates = LIBRARIES.map(name => {
    const found = packages.find(p => p.registry === 'npm' && p.name === `@getforma/${name}`);
    assert(found, `DS11 has no @getforma/${name}`);
    return found;
  });
  const version = candidates[0].version;
  for (const p of candidates) assert.equal(p.version, version, `${p.name}: the libraries must share one version`);
  const { range, entries } = esbuildEntries(rootLock);
  const manifest = fixtureManifest(version, range);
  const seed = {
    name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
    packages: {
      '': { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies, devDependencies: manifest.devDependencies },
      ...Object.fromEntries(candidates.map(p => [`node_modules/${p.name}`, {}])),
      ...entries,
    },
  };
  const seeded = stageNpmLock(manifest, seed, packages, artifactDir, false, rootLock);
  return stageNpmLock(seeded.manifest, seeded.lock, packages, artifactDir, true);
}

/** Copy the fixture sources, leaving out what a build or a reader of the repository adds. */
export function copyFixtureSources(destination, source = FIXTURES) {
  cpSync(source, destination, { recursive: true, filter: path => {
    const relative = path.slice(source.length + 1);
    return !relative || !EXCLUDED.has(relative.split(sep)[0]);
  } });
}

/**
 * The crate's manifest for the packed crates: the two path dependencies become exact registry
 * requirements, and DS11's extracted crates replace the registry through `[patch.crates-io]` (the
 * same substitution P17 makes for the templates). The crate becomes its own workspace.
 */
export function fixtureCargoToml(text, version, cratesDir) {
  assert(!/^\[(?:workspace|patch)/m.test(text), 'the fixture manifest already has a workspace or a patch table');
  let replaced = 0;
  const staged = text.replace(/^(forma-ir|forma-server) = \{ path = "[^"]+" \}$/gm, (_, name) => { replaced += 1; return `${name} = "=${version}"`; });
  assert.equal(replaced, 2, 'the fixture manifest must name forma-ir and forma-server by path');
  const patch = CRATES.map(name => `${name} = { path = ${JSON.stringify(join(cratesDir, name))} }`).join('\n');
  return `${staged.trimEnd()}\n\n[workspace]\n\n[patch.crates-io]\n${patch}\n`;
}

const dependencyNames = block => [...(/^dependencies = \[\n([\s\S]*?)\n\]/m.exec(block)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(m => m[1]);

/**
 * The fixture crate's own lock, taken from the e2e workspace's committed one: the packages the crate
 * reaches, in the committed order, third-party versions and checksums untouched; the three Forma
 * packages (path packages, no source) are set to the packed version. `cargo build --locked` is the
 * proof that nothing else had to be resolved. A dependency the lock does not hold is an error.
 */
export function pruneCargoLock(text, rootName, version) {
  const [header, ...chunks] = text.split(/(?=^\[\[package\]\]\n)/m);
  assert(chunks.length > 0, 'the recorded lock has no packages');
  const blocks = chunks.map(raw => ({ raw, name: /^name = "([^"]+)"$/m.exec(raw)?.[1], version: /^version = "([^"]+)"$/m.exec(raw)?.[1] }));
  const byName = new Map();
  for (const block of blocks) byName.set(block.name, [...(byName.get(block.name) ?? []), block]);
  const root = byName.get(rootName)?.[0];
  assert(root, `the recorded lock has no package ${rootName}`);
  const kept = new Set([root]), pending = [root];
  while (pending.length) {
    const block = pending.pop();
    for (const entry of dependencyNames(block.raw)) {
      const [name, wanted] = entry.split(' ');
      const found = (byName.get(name) ?? []).filter(candidate => !wanted || candidate.version === wanted);
      assert(found.length === 1, `${block.name}: dependency ${entry} is ${found.length ? 'ambiguous' : 'absent'} in the recorded lock`);
      if (!kept.has(found[0])) { kept.add(found[0]); pending.push(found[0]); }
    }
  }
  const output = blocks.filter(block => kept.has(block)).map(block => {
    if (!CRATES.includes(block.name)) return block.raw;
    assert(!/^source = /m.test(block.raw) && !/^checksum = /m.test(block.raw), `${block.name}: the recorded lock must hold the Forma crates as path packages`);
    return block.raw.replace(/^version = "[^"]+"$/m, `version = "${version}"`);
  });
  // Cargo writes the file with one blank line between packages and a single final newline, and
  // `--locked` compares text: a pruned lock must end the way a written one does.
  return `${header}${output.join('').trimEnd()}\n`;
}

/**
 * Where Node finds `name` for a file at `from`: the nearest enclosing node_modules directory that
 * holds it, as the resolver walks up. Returns the real path of the package directory, or null.
 */
export function nearestPackage(from, name) {
  for (let dir = dirname(realpathSync(from)); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}

/** Every import of the installed libraries (the other libraries, and the esbuild the compiler loads) resolves inside the project. */
export function assertResolvesInside(project, consumers = { '@getforma/build': ['@getforma/compiler', '@getforma/core', 'esbuild'], '@getforma/compiler': ['@getforma/core', 'esbuild'] }) {
  const inside = realpathSync(project) + sep;
  const found = {};
  for (const [consumer, imports] of Object.entries(consumers)) {
    const from = join(project, 'node_modules', consumer, 'package.json');
    assert(existsSync(from), `${consumer} is not installed in the fixture project`);
    for (const name of imports) {
      const resolved = nearestPackage(from, name);
      assert(resolved?.startsWith(inside), `${consumer} resolves ${name} to ${resolved ?? 'nothing'}, outside the packed install ${project}`);
      found[`${consumer} -> ${name}`] = resolved.slice(inside.length);
    }
  }
  return found;
}

/** The expectations `lib/verify-page.mjs` takes, from an apps.json page or variant. */
export function expectedFor(page, expectation) {
  const hosts = {};
  for (const island of page.islands) hosts[island] = (hosts[island] ?? 0) + 1;
  return {
    serverValues: expectation.serverValues ?? [],
    state: expectation.state ? Object.fromEntries(Object.entries(expectation.state).map(([component, each]) => [component, [each]])) : undefined,
    statePrefix: expectation.statePrefix,
    hosts,
  };
}

/** The sources copied into the project are the committed ones: a dirty tree cannot be what a tag verified. */
function sourceEquality(project, commit) {
  const names = run('git', ['ls-tree', '-r', '--name-only', commit, '--', 'e2e/fixtures/apps'], ROOT).trim().split('\n').filter(Boolean)
    .map(path => path.slice('e2e/fixtures/apps/'.length)).filter(path => !EXCLUDED.has(path.split('/')[0]));
  assert(names.length > 20, 'the committed fixture inventory is incomplete');
  for (const name of names) {
    const committed = run('git', ['show', `${commit}:e2e/fixtures/apps/${name}`], ROOT, { encoding: 'buffer' });
    assert(existsSync(join(project, name)) && Buffer.compare(readFileSync(join(project, name)), committed) === 0, `fixture source ${name} differs from commit ${commit.slice(0, 12)}`);
  }
  return { commit, files: names.length };
}

/**
 * Stage the project and build every application with the packed `build`. Returns what the later
 * stages and FORMA-186's skew drill need: `{project, build, targetDir, cratesDir}` (the drill is a call
 * over these, not a rewrite).
 */
export async function stageFixtureProject({ set, dir, cratesDir, targetDir, test, report }) {
  const version = set.packages[0].version;
  const project = mkdtempSync(join(tmpdir(), 'forma-packed-fixtures-'));
  const staged = { project, cratesDir, targetDir };
  await test('fixture applications: the sources are the committed ones and the packed libraries install locked, signed and isolated', async () => {
    copyFixtureSources(project);
    report.fixtureSourceEquality = sourceEquality(project, set.commit);
    const install = stageFixtureNpm(set.packages, dir, json(join(ROOT, 'package-lock.json')));
    save(join(project, 'package.json'), install.manifest); save(join(project, 'package-lock.json'), install.lock);
    const lockHash = digest(join(project, 'package-lock.json'));
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], project, { stdio: 'inherit' });
    assert.equal(digest(join(project, 'package-lock.json')), lockHash, 'npm changed the fixture lock');
    for (const p of set.packages.filter(p => p.registry === 'npm' && LIBRARIES.includes(p.name.split('/')[1]))) {
      assert.equal(json(join(project, 'node_modules', p.name, 'package.json')).version, p.version, `the fixture project installed another ${p.name}`);
    }
    staged.resolution = assertResolvesInside(project);
    staged.signatures = auditCandidateSignatures(project, set.packages, dir);
    staged.npmLockSha256 = lockHash;
  });
  const packedBuild = join(project, 'node_modules/@getforma/build/dist/index.js');
  staged.build = (await import(pathToFileURL(packedBuild).href)).build;
  assert.equal(typeof staged.build, 'function', 'the packed build package lacks build()');
  const { buildApps } = await import(pathToFileURL(join(FIXTURES, 'lib/build-apps.mjs')).href);
  await test('fixture applications: every application builds with the packed build in strict mode, nothing above a note', async () => {
    staged.reports = await buildApps({ build: staged.build, root: project, outRoot: join(project, 'out') });
  });
  await test('fixture applications: the Rust servers build from the packed crates on the committed lock, pruned to the crate', async () => {
    const lock = pruneCargoLock(readFileSync(join(ROOT, 'e2e/Cargo.lock'), 'utf8'), 'forma-fixture-apps', version);
    writeFileSync(join(project, 'Cargo.lock'), lock);
    writeFileSync(join(project, 'Cargo.toml'), fixtureCargoToml(readFileSync(join(project, 'Cargo.toml'), 'utf8'), version, cratesDir));
    run('cargo', ['build', '--locked'], project, { stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: targetDir, CARGO_INCREMENTAL: '0' } });
    staged.cargoLockSha256 = digest(join(project, 'Cargo.lock'));
  });
  return staged;
}

/** Everything P17 runs over the fixtures; returns the record P17 saves under `report.fixtures`. */
export async function verifyPackedFixtures({ set, dir, cratesDir, targetDir, browser, test, report }) {
  const { verifyIslandPage } = await import(pathToFileURL(join(FIXTURES, 'lib/verify-page.mjs')).href);
  const { BEHAVIOURS, EXTRAS } = await import(pathToFileURL(join(FIXTURES, 'lib/behaviours.mjs')).href);
  const { buildNegative, buildPositive, readApps } = await import(pathToFileURL(join(FIXTURES, 'lib/build-apps.mjs')).href);
  const staged = await stageFixtureProject({ set, dir, cratesDir, targetDir, test, report });
  const { project } = staged;
  try {
    const index = readApps(project);
    const expectedRoutes = Object.entries(index.apps).flatMap(([app, each]) => Object.keys(each.routes).map(route => ({ app, route })));
    const n2 = Object.keys(staged.reports).flatMap(app => n2Rows(app, readPackedSizes(join(project, 'out', app, 'dist'))));
    const positives = [];
    await test('fixture applications: the packed build admits a client-side keyed list and reports its size policy (L-58)', async () => {
      for (const entry of index.positive) {
        const result = await buildPositive({ build: staged.build, root: project, outRoot: join(project, 'out'), name: entry.name });
        const app = `positive/${entry.name}`;
        const rows = n2Rows(app, readPackedSizes(result.outputDir));
        assert(rows.every(row => row.formaGzip > 0), `${app}: expected an interactive route with Forma code`);
        n2.push(...rows);
        expectedRoutes.push({ app, route: '/' });
        positives.push({ name: entry.name, sizeReport: result.sizeReport });
      }
    });
    const shapes = [], pages = [];
    await test('fixture applications: Forma\'s code on every fixture route is inside N2\'s ceiling in the packed build', async () => { assertN2(n2, expectedRoutes); });
    for (const [name, app] of Object.entries(index.apps)) {
      await test(`fixture ${name}: the packed server serves each page; adoption writes nothing, the server's values stay, and the islands work`, async () => {
        const manifest = json(join(project, 'out', name, 'dist/manifest.json'));
        const binary = join(targetDir, 'debug', `fixture-${name}${process.platform === 'win32' ? '.exe' : ''}`);
        await withOwnedServer(binary, [], project, async (_response, origin) => {
          for (const [route, page] of Object.entries(app.routes)) {
            const cases = [{ label: route, path: page.path ?? route, expectation: page, main: true },
              ...(page.variants ?? []).map(variant => ({ label: `${route} (${variant.name})`, path: variant.path, expectation: variant, main: false }))];
            for (const { label, path, expectation, main } of cases) {
              const behaviour = BEHAVIOURS[main ? `${name} ${route}` : `${name} ${label}`] ?? {};
              const result = await verifyIslandPage(browser, origin, route, manifest, {
                path, expected: expectedFor(page, expectation), hold: behaviour.hold ?? [],
                interact: behaviour.interact,
              });
              assert.equal(result.mutations, 0, `${name} ${label}: adoption wrote to the DOM`);
              assert(result.interacted, `${name} ${label}: nothing proved the islands active`);
              pages.push({ app: name, page: label, path, mutations: result.mutations, elements: result.nodes, hosts: result.hosts, counts: result.served.counts });
            }
            if (page.shape) {
              const response = await fetch(new URL(route, origin).href);
              assert.equal(response.status, 200, `${name} ${route}: shape request`);
              shapes.push(shapeRow(name, route, response.headers.get('x-fixture-counts'), page.shape.islands));
            }
          }
          for (const extra of EXTRAS[name] ?? []) await extra.run({ browser, origin });
        }, { timeout: 60_000 });
      });
    }
    await test('fixture applications: the packed compiler refuses the shapes the contract refuses (BUILD-610, with a file, a line and a column)', async () => {
      for (const entry of index.negative.filter(each => each.fails === 'diagnostic')) {
        const result = await buildNegative({ build: staged.build, root: project, outRoot: join(project, 'out'), name: entry.name });
        assert.equal(result.built, false, `${entry.name}: the packed build accepted a refused shape`);
        const found = result.diagnostics.filter(each => each.code === entry.code && each.message.includes(entry.message));
        assert(found.length > 0 && found.every(each => each.file.endsWith(entry.file) && each.line > 0 && each.column > 0), `${entry.name}: expected ${entry.code} "${entry.message}" with a position, got ${JSON.stringify(result.diagnostics)}`);
      }
    });
    return {
      npmLockSha256: staged.npmLockSha256, cargoLockSha256: staged.cargoLockSha256, signatures: staged.signatures,
      resolution: staged.resolution, apps: Object.fromEntries(Object.entries(staged.reports).map(([app, each]) => [app, { buildHash: each.buildHash, routes: each.routes, seconds: each.seconds }])),
      pages, positives, n2, shapes, expectedRoutes,
    };
  } finally { rmSync(project, { recursive: true, force: true }); }
}
