import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = '/docs/archive/';

// A tracked snapshot is evidence, not a maintained dependency installation.
// This checks our configuration, not whether GitHub applied it to an update job.
export function validateDependabotPolicy(config, trackedFiles) {
  const errors = [];
  if (config?.version !== 2 || !Array.isArray(config.updates)) {
    return ['Dependabot configuration must have version 2 and an updates array'];
  }
  const manifests = new Set(trackedFiles
    .filter(file => file.startsWith('docs/archive/') && file.endsWith('/package.json'))
    .map(file => `/${file.slice(0, -'/package.json'.length)}`));
  const covered = new Set();
  for (const update of config.updates) {
    if (update['package-ecosystem'] !== 'npm') continue;
    const directories = update.directories ?? (update.directory ? [update.directory] : []);
    if (!Array.isArray(directories) || !directories.every(path => typeof path === 'string')) {
      errors.push('npm update directories must be a list of paths');
      continue;
    }
    const ignoresAll = Array.isArray(update.ignore)
      && update.ignore.some(rule => rule['dependency-name'] === '*');
    const hasArchive = directories.some(path => path.startsWith(ARCHIVE));
    if (!ignoresAll && !hasArchive) continue;
    if (directories.length === 0) errors.push('Wildcard npm ignore needs explicit archive directories');
    for (const path of directories) {
      if (!manifests.has(path)) {
        errors.push(`Wildcard npm ignore must name an exact tracked archive manifest directory: ${path}`);
      } else if (covered.has(path)) {
        errors.push(`Archive manifest directory appears more than once: ${path}`);
      } else {
        covered.add(path);
      }
    }
    if (update['open-pull-requests-limit'] !== 0) {
      errors.push('Archive version updates must remain disabled with open-pull-requests-limit: 0');
    }
    if (update['target-branch'] !== undefined) {
      errors.push('Archive security-update policy must not specify target-branch');
    }
    if (!Array.isArray(update.ignore) || update.ignore.length !== 1
      || update.ignore[0]['dependency-name'] !== '*'
      || Object.keys(update.ignore[0]).length !== 1) {
      errors.push('Archive update policy must ignore all dependency versions, including security PRs');
    }
  }
  for (const path of manifests) {
    if (!covered.has(path)) errors.push(`Missing archive update policy: ${path}`);
  }
  return errors;
}

export function checkDependabotPolicy(root = ROOT) {
  // Ruby YAML is also used by the existing release-workflow checks in this job.
  const config = JSON.parse(execFileSync('ruby', ['-rjson', '-ryaml', '-e',
    'puts JSON.generate(YAML.load(STDIN.read))'], {
    input: readFileSync(join(root, '.github/dependabot.yml')), encoding: 'utf8',
  }));
  const trackedFiles = execFileSync('git', ['ls-files', '--cached', '-z', '--', 'docs/archive'], {
    cwd: root, encoding: 'utf8',
  }).split('\0').filter(Boolean);
  return validateDependabotPolicy(config, trackedFiles);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkDependabotPolicy();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Dependabot archive policy: all tracked manifests covered; active npm paths excluded');
  }
}
