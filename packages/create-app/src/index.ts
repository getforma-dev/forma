#!/usr/bin/env node
import prompts from 'prompts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATES = ['minimal', 'dashboard'];

export function replacePlaceholders(dir: string, replacements: Record<string, string>) {
  const TEXT_EXTS = new Set(['.toml', '.rs', '.ts', '.json', '.md', '.css', '.html']);

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
  const isDryRun = args.includes('--dry-run');

  const projectName =
    args.find((a) => !a.startsWith('--')) ||
    (await prompts({ type: 'text', name: 'value', message: 'Project name?' })).value;
  if (!projectName) {
    console.error('Project name required.');
    process.exit(1);
  }

  const { template } = await prompts({
    type: 'select',
    name: 'template',
    message: 'Template?',
    choices: TEMPLATES.map((t) => ({ title: t, value: t })),
  });

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

  // Replace placeholders in all text files
  replacePlaceholders(dest, { '{{PROJECT_NAME}}': projectName });

  console.log(`\nCreated ${projectName} with the ${template} template.\n`);
  console.log('Next steps:');
  console.log(`  cd ${projectName}`);
  console.log('  cd admin && npm install && npm run build && cd ..');
  console.log('  cargo run');
  console.log('  # Open http://127.0.0.1:3000');
}

main().catch(console.error);
