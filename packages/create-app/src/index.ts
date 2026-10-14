#!/usr/bin/env node
import prompts from 'prompts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  NEVER_COPY,
  TEMPLATE_INFO,
  TEMPLATES,
  placeCargoLockRoot,
  replacePlaceholders,
  restoreGitignores,
  validateProjectName,
} from './scaffold';

// ── Colored output helpers ─────────────────────────────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ── Detect package manager ─────────────────────────────────────────────

function detectPackageManager(): string {
  const ua = process.env.npm_config_user_agent ?? '';
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('bun')) return 'bun';
  return 'npm';
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // --help / -h
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${bold('create-forma-app')} — Scaffold a full-stack Forma application

${bold('Usage:')}
  npx @getforma/create-app ${cyan('[project-name]')} ${dim('[options]')}

${bold('Options:')}
  --template ${cyan('<name>')}  Template to use (${TEMPLATES.join(', ')})
  --help, -h         Show this help message
  --version, -v      Show version
  --dry-run          Preview without creating files

${bold('Templates:')}
${TEMPLATES.map((t) => `  ${cyan(t.padEnd(9))}  ${TEMPLATE_INFO[t]!.description}`).join('\n')}

${bold('Examples:')}
  npx @getforma/create-app my-app
  npx @getforma/create-app my-app --template dashboard
  npx @getforma/create-app my-app --template minimal
`);
    process.exit(0);
  }

  // --version / -v
  if (args.includes('--version') || args.includes('-v')) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
    process.exit(0);
  }

  const isDryRun = args.includes('--dry-run');

  // Parse --template flag. The value is consumed by index so that a project
  // name equal to the template name (`create-app minimal --template minimal`)
  // is still recognised as the project name.
  const templateArgIdx = args.indexOf('--template');
  let templateArg: string | null = null;
  if (templateArgIdx !== -1) {
    const value = args[templateArgIdx + 1];
    if (value === undefined || value.startsWith('--')) {
      console.error(`--template needs a value. Available: ${TEMPLATES.join(', ')}`);
      process.exit(1);
    }
    if (!TEMPLATES.includes(value)) {
      console.error(`Invalid template "${value}". Available: ${TEMPLATES.join(', ')}`);
      process.exit(1);
    }
    templateArg = value;
  }

  // ── Project name ──

  console.log();
  console.log(bold('  Forma') + dim(' — Create a new full-stack application'));
  console.log();

  const templateValueIdx = templateArgIdx === -1 ? -1 : templateArgIdx + 1;
  const positional = args.filter(
    (a, i) => !a.startsWith('--') && i !== templateValueIdx,
  );
  const projectName =
    positional[0] ||
    (await prompts({ type: 'text', name: 'value', message: 'Project name?' })).value;

  const nameError = validateProjectName(projectName ?? '');
  if (nameError) {
    console.error(nameError);
    process.exit(1);
  }

  // ── Template selection ──

  const template = templateArg
    ? templateArg
    : (await prompts({
        type: 'select',
        name: 'template',
        message: 'Template?',
        choices: TEMPLATES.map((t) => ({
          title: TEMPLATE_INFO[t]!.title,
          description: TEMPLATE_INFO[t]!.description,
          value: t,
        })),
      })).template;

  if (!template || !TEMPLATES.includes(template)) {
    console.error('Template selection required.');
    process.exit(1);
  }

  // ── Validate destination ──

  const dest = path.resolve(projectName);
  // lstat, not existsSync: existsSync follows symlinks and so reports false
  // for a dangling one, which would then make cpSync write through the link.
  // Verified by: tests/scaffold.test.ts > "refuses to scaffold onto a dangling symlink"
  try {
    fs.lstatSync(dest);
    console.error(`\n  ${dest} already exists.\n`);
    process.exit(1);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (isDryRun) {
    console.log(`${dim('[dry-run]')} Would create ${cyan(projectName)} with template: ${cyan(template)}`);
    return;
  }

  // ── Scaffold ──

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const templateDir = path.join(__dirname, '..', 'templates', template);

  if (!fs.existsSync(templateDir)) {
    console.error(`Template "${template}" not found at ${templateDir}`);
    process.exit(1);
  }

  console.log();
  console.log(dim('  Scaffolding project...'));

  try {
    fs.cpSync(templateDir, dest, {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
      filter: (src) => !NEVER_COPY.has(path.basename(src)),
    });

    restoreGitignores(dest);

    // Replace ALL placeholder variants
    replacePlaceholders(dest, {
      '{{PROJECT_NAME}}': projectName,
      '{{project-name}}': projectName,
    });

    // The crate's own Cargo.lock entry was just renamed; put it back where
    // cargo sorts it, so the first `cargo run` leaves the lockfile untouched.
    placeCargoLockRoot(path.join(dest, 'Cargo.lock'), projectName);
  } catch (err) {
    // Never leave a half-written project behind: the next run would refuse to
    // start because the directory now exists.
    fs.rmSync(dest, { recursive: true, force: true });
    throw err;
  }

  // ── Git init ──

  try {
    execSync('git init', { cwd: dest, stdio: 'ignore' });
    execSync('git add -A', { cwd: dest, stdio: 'ignore' });
    execSync('git commit -m "Initial commit from create-forma-app"', { cwd: dest, stdio: 'ignore' });
  } catch {
    // git missing, or no commit identity configured — the project is complete
    // either way, so this is not worth failing the scaffold over.
  }

  // ── Success output ──

  const pm = detectPackageManager();
  const runCmd = pm === 'npm' ? 'npm run' : pm;

  console.log();
  console.log(green('  ✓') + bold(` Created ${projectName}`));
  console.log();
  console.log(dim('  Next steps:'));
  console.log();
  console.log(`  ${cyan('cd')} ${projectName}`);
  console.log();
  console.log(dim('  # Build the frontend'));
  console.log(`  ${cyan('cd')} admin`);
  console.log(`  ${cyan(pm)} install`);
  console.log(`  ${cyan(runCmd)} build`);
  console.log(`  ${cyan('cd')} ..`);
  console.log();
  console.log(dim('  # Start the Rust server'));
  console.log(`  ${cyan('cargo')} run`);
  console.log();
  console.log(dim(`  Open ${cyan('http://localhost:3000')}`));
  console.log();

  if (template === 'dashboard') {
    console.log(dim('  This dashboard demonstrates:'));
    console.log(dim('  • 4 pages with createShow routing + History API (no router library)'));
    console.log(dim('  • 8 Rust JSON API routes — unauthenticated, localhost-only by default'));
    console.log(dim('  • createFetch, createSignal, createShow, createComputed, createList, createEffect'));
    console.log(dim('  • Hand-rolled SVG chart, command palette (Cmd+K), Tailwind CSS v4'));
    console.log();
  } else {
    console.log(dim('  Server-side rendering:'));
    console.log(dim(`  • ${runCmd} build:ssr  in admin/ — the server then renders the page from IR`));
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
