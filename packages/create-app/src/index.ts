#!/usr/bin/env node
import prompts from 'prompts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATES = ['minimal', 'dashboard'];

export function replacePlaceholders(dir: string, replacements: Record<string, string>) {
  const TEXT_EXTS = new Set(['.toml', '.rs', '.ts', '.tsx', '.json', '.md', '.css', '.html']);

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

async function main() {
  const args = process.argv.slice(2);

  // --help / -h
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: create-forma-app [project-name] [options]

Options:
  --template <name>  Template to use (minimal, dashboard)
  --help, -h         Show this help message
  --version, -v      Show version
  --dry-run          Preview without creating files

Templates:
  minimal    Counter with signals and JSX (learning/prototyping)
  dashboard  Live dashboard with islands, API routes, dark theme (full-stack showcase)
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
    console.error(`Invalid template "${templateArg}". Available templates: ${TEMPLATES.join(', ')}`);
    process.exit(1);
  }

  const projectName =
    args.find((a) => !a.startsWith('--') && a !== templateArg) ||
    (await prompts({ type: 'text', name: 'value', message: 'Project name?' })).value;
  if (!projectName) {
    console.error('Project name required.');
    process.exit(1);
  }

  // Validate project name (must be a valid directory + Cargo package name)
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectName)) {
    console.error('Project name must be lowercase alphanumeric with hyphens/underscores. Cannot start with - or _.');
    process.exit(1);
  }

  const template = templateArg
    ? templateArg
    : (await prompts({
        type: 'select',
        name: 'template',
        message: 'Template?',
        choices: [
          { title: 'dashboard', description: 'Live dashboard with islands, API routes, dark theme', value: 'dashboard' },
          { title: 'minimal', description: 'Counter with signals and JSX (learning)', value: 'minimal' },
        ],
      })).template;

  if (!template) {
    console.error('Template selection required.');
    process.exit(1);
  }

  const dest = path.resolve(projectName);
  if (fs.existsSync(dest)) {
    console.error(`${dest} already exists.`);
    process.exit(1);
  }

  if (isDryRun) {
    console.log(`[dry-run] Would create ${dest} with template: ${template}`);
    return;
  }

  // Resolve templates/ relative to this file
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const templateDir = path.join(__dirname, '..', 'templates', template);

  if (!fs.existsSync(templateDir)) {
    console.error(`Template "${template}" not found at ${templateDir}`);
    process.exit(1);
  }

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

  // Replace placeholders in all text files
  replacePlaceholders(dest, { '{{PROJECT_NAME}}': projectName });

  console.log(`\nCreated ${projectName} with the ${template} template.\n`);
  console.log('Next steps:');
  console.log(`  cd ${projectName}`);
  console.log('  cd admin && npm install && npm run build && cd ..');
  console.log('  cargo run');
  console.log('  # Open http://127.0.0.1:3000');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
