#!/usr/bin/env node
import prompts from 'prompts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ── Constants ──────────────────────────────────────────────────────────

export const TEMPLATES = ['dashboard', 'minimal'];

const TEMPLATE_INFO: Record<string, { title: string; description: string }> = {
  dashboard: {
    title: 'dashboard',
    description: 'Live dashboard with islands, API routes, dark theme — full showcase',
  },
  minimal: {
    title: 'minimal',
    description: 'Clean slate — Rust server + JSX frontend, ready to build on',
  },
};

// ── Placeholder replacement ────────────────────────────────────────────

const TEXT_EXTS = new Set(['.toml', '.rs', '.ts', '.tsx', '.json', '.md', '.css', '.html', '.yml']);

export function replacePlaceholders(dir: string, replacements: Record<string, string>) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      replacePlaceholders(fullPath, replacements);
    } else if (TEXT_EXTS.has(path.extname(entry.name))) {
      let content = fs.readFileSync(fullPath, 'utf8');
      for (const [placeholder, value] of Object.entries(replacements)) {
        content = content.replaceAll(placeholder, value);
      }
      fs.writeFileSync(fullPath, content);
    }
  }
}

// ── Colored output helpers ─────────────────────────────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

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
  ${cyan('dashboard')}  Live dashboard with islands, API routes, dark theme ${dim('(full showcase)')}
  ${cyan('minimal')}    Clean slate — Rust server + JSX frontend ${dim('(build your own)')}

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

  // Parse --template flag
  const templateArgIdx = args.indexOf('--template');
  const templateArg = templateArgIdx !== -1 ? args[templateArgIdx + 1] : null;

  if (templateArg && !TEMPLATES.includes(templateArg)) {
    console.error(`Invalid template "${templateArg}". Available: ${TEMPLATES.join(', ')}`);
    process.exit(1);
  }

  // ── Project name ──

  console.log();
  console.log(bold('  Forma') + dim(' — Create a new full-stack application'));
  console.log();

  const projectName =
    args.find((a) => !a.startsWith('--') && a !== templateArg) ||
    (await prompts({ type: 'text', name: 'value', message: 'Project name?' })).value;
  if (!projectName) {
    console.error('Project name required.');
    process.exit(1);
  }

  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectName)) {
    console.error('Project name must be lowercase alphanumeric with hyphens/underscores.');
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

  if (!template) {
    console.error('Template selection required.');
    process.exit(1);
  }

  // ── Validate destination ──

  const dest = path.resolve(projectName);
  if (fs.existsSync(dest)) {
    console.error(`\n  ${dest} already exists.\n`);
    process.exit(1);
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

  fs.cpSync(templateDir, dest, { recursive: true });

  // Rename _gitignore to .gitignore (npm pack renames .gitignore to .npmignore)
  const possibleGitignores = [
    path.join(dest, '_gitignore'),
    path.join(dest, 'admin', '_gitignore'),
  ];
  for (const gi of possibleGitignores) {
    if (fs.existsSync(gi)) {
      fs.renameSync(gi, gi.replace('_gitignore', '.gitignore'));
    }
  }

  // Replace ALL placeholder variants
  replacePlaceholders(dest, {
    '{{PROJECT_NAME}}': projectName,
    '{{project-name}}': projectName,
  });

  // ── Git init ──

  try {
    execSync('git init', { cwd: dest, stdio: 'ignore' });
    execSync('git add -A', { cwd: dest, stdio: 'ignore' });
    execSync('git commit -m "Initial commit from create-forma-app"', { cwd: dest, stdio: 'ignore' });
  } catch {
    // git not available — skip silently
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
    console.log(dim('  • 3 pages with createShow routing + History API (no router library)'));
    console.log(dim('  • Rust API routes (/api/metrics, /api/deployments, /api/servers, +5 more)'));
    console.log(dim('  • createFetch, createSignal, createShow, createComputed, createList, createEffect'));
    console.log(dim('  • Hand-rolled SVG chart, command palette (Cmd+K), Tailwind CSS v4'));
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
