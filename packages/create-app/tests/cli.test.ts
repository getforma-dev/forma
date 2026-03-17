import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replacePlaceholders, TEMPLATES } from '../src/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const TEST_OUTPUT = path.join(__dirname, '..', 'test-output');

function rmrf(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('TEMPLATES constant', () => {
  it('lists minimal and dashboard', () => {
    expect(TEMPLATES).toEqual(['minimal', 'dashboard']);
  });
});

describe('template directories exist', () => {
  for (const template of TEMPLATES) {
    it(`templates/${template}/ exists`, () => {
      const dir = path.join(TEMPLATES_DIR, template);
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    });
  }
});

describe('template files contain expected structure', () => {
  for (const template of TEMPLATES) {
    describe(template, () => {
      it('has Cargo.toml with placeholder', () => {
        const cargo = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'Cargo.toml'), 'utf8');
        if (template === 'dashboard') {
          expect(cargo).toContain('{{project-name}}');
        } else {
          expect(cargo).toContain('{{PROJECT_NAME}}');
        }
        expect(cargo).toContain('forma-ir');
        expect(cargo).toContain('forma-server');
      });

      it('has src/main.rs', () => {
        const main = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'src', 'main.rs'), 'utf8');
        expect(main).toContain('forma_server');
        expect(main).toContain('render_page');
        expect(main).toContain('serve_asset::<Assets>');
        if (template === 'minimal') {
          expect(main).toContain('tracing_subscriber::fmt::init()');
          expect(main).toContain('route("/favicon.ico"');
        }
        if (template === 'dashboard') {
          expect(main).toContain('api_stats');
          expect(main).toContain('/api/stats');
        }
        expect(main).toContain('route("/sw.js"');
      });

      it('has admin/package.json with @getforma/core', () => {
        const pkg = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'admin', 'package.json'), 'utf8');
        expect(pkg).toContain('@getforma/core');
        expect(pkg).toContain('@getforma/compiler');
        expect(pkg).toContain('@getforma/build');
      });

      it('has admin/build.ts', () => {
        const build = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'admin', 'build.ts'), 'utf8');
        expect(build).toContain('@getforma/build');
        if (template === 'dashboard') {
          expect(build).toContain("outfile: 'dashboard.js'");
          expect(build).toContain("entry: 'src/app.tsx'");
        } else {
          expect(build).toContain("outfile: 'home.js'");
        }
      });

      if (template === 'minimal') {
        it('has admin/src/home/app.tsx with mount render function', () => {
          const app = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'admin', 'src', 'home', 'app.tsx'), 'utf8');
          expect(app).toContain("mount(() => HomeIsland(), '#app')");
        });

        it('has admin/src/home/HomeIsland.tsx with JSX syntax', () => {
          const island = fs.readFileSync(
            path.join(TEMPLATES_DIR, template, 'admin', 'src', 'home', 'HomeIsland.tsx'),
            'utf8',
          );
          expect(island).toContain('@getforma/core');
          expect(island).toContain('<div');
          expect(island).toContain('onClick');
          // Ensure no virtual DOM patterns
          expect(island).not.toContain('createElement');
          expect(island).not.toContain('render(');
        });
      }

      if (template === 'dashboard') {
        it('has admin/src/app.tsx with activateIslands', () => {
          const app = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'admin', 'src', 'app.tsx'), 'utf8');
          expect(app).toContain('activateIslands');
        });

        it('has admin/src/islands/DataTable.tsx with JSX syntax', () => {
          const island = fs.readFileSync(
            path.join(TEMPLATES_DIR, template, 'admin', 'src', 'islands', 'DataTable.tsx'),
            'utf8',
          );
          expect(island).toContain('@getforma/core');
          expect(island).toContain('<div');
          expect(island).toContain('onClick');
          // Ensure no virtual DOM patterns
          expect(island).not.toContain('createElement');
          expect(island).not.toContain('render(');
        });
      }

      it('has admin/tsconfig.json with JSX settings', () => {
        const tsconfig = JSON.parse(
          fs.readFileSync(path.join(TEMPLATES_DIR, template, 'admin', 'tsconfig.json'), 'utf8'),
        );
        expect(tsconfig.compilerOptions.jsx).toBe('react');
        expect(tsconfig.compilerOptions.jsxFactory).toBe('h');
        expect(tsconfig.compilerOptions.jsxFragmentFactory).toBe('Fragment');
      });

      it('has README.md with placeholder', () => {
        const readme = fs.readFileSync(path.join(TEMPLATES_DIR, template, 'README.md'), 'utf8');
        if (template === 'dashboard') {
          expect(readme).toContain('{{project-name}}');
          expect(readme).toContain('@getforma/core');
        } else {
          expect(readme).toContain('{{PROJECT_NAME}}');
          expect(readme).toContain('getforma.dev');
        }
      });

      it('has _gitignore (renamed for npm pack compatibility)', () => {
        const gi = fs.readFileSync(path.join(TEMPLATES_DIR, template, '_gitignore'), 'utf8');
        expect(gi).toContain('target/');
        expect(gi).toContain('node_modules/');
      });
    });
  }
});

describe('dashboard template specifics', () => {
  it('uses createList in islands', () => {
    const dataTable = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'dashboard', 'admin', 'src', 'islands', 'DataTable.tsx'),
      'utf8',
    );
    expect(dataTable).toContain('createList');
    expect(dataTable).toContain('createFetch');
    expect(dataTable).toContain('createStore');
    // createList renderFn should receive plain item, not () => T
    // The pattern: (user) => (...) where user is used directly (user.name, user.email)
    expect(dataTable).toContain('user.name');
    expect(dataTable).toContain('user.email');
    expect(dataTable).toContain('user.role');
  });

  it('uses createList in ActivityFeed', () => {
    const feed = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'dashboard', 'admin', 'src', 'islands', 'ActivityFeed.tsx'),
      'utf8',
    );
    expect(feed).toContain('createList');
    expect(feed).toContain('createFetch');
    expect(feed).toContain('item.id');
    expect(feed).toContain('item.message');
  });

  it('has API routes in main.rs', () => {
    const main = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'dashboard', 'src', 'main.rs'),
      'utf8',
    );
    expect(main).toContain('api_stats');
    expect(main).toContain('/api/stats');
    expect(main).toContain('/api/activity');
    expect(main).toContain('/api/users');
  });

  it('build.ts references src/app.tsx entry point with dashboard.js output', () => {
    const build = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'dashboard', 'admin', 'build.ts'),
      'utf8',
    );
    expect(build).toContain("entry: 'src/app.tsx'");
    expect(build).toContain("outfile: 'dashboard.js'");
  });

  it('app.tsx uses activateIslands with all islands', () => {
    const app = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'dashboard', 'admin', 'src', 'app.tsx'),
      'utf8',
    );
    expect(app).toContain('activateIslands');
    expect(app).toContain('StatsCards');
    expect(app).toContain('Sidebar');
    expect(app).toContain('ActivityFeed');
    expect(app).toContain('DataTable');
  });
});

describe('replacePlaceholders', () => {
  beforeEach(() => {
    rmrf(TEST_OUTPUT);
    fs.mkdirSync(TEST_OUTPUT, { recursive: true });
  });

  afterEach(() => {
    rmrf(TEST_OUTPUT);
  });

  it('replaces placeholders in .toml files', () => {
    fs.writeFileSync(
      path.join(TEST_OUTPUT, 'Cargo.toml'),
      'name = "{{PROJECT_NAME}}"\nversion = "0.1.0"',
    );
    replacePlaceholders(TEST_OUTPUT, { '{{PROJECT_NAME}}': 'my-app' });
    const result = fs.readFileSync(path.join(TEST_OUTPUT, 'Cargo.toml'), 'utf8');
    expect(result).toBe('name = "my-app"\nversion = "0.1.0"');
    expect(result).not.toContain('{{PROJECT_NAME}}');
  });

  it('replaces placeholders in .rs files', () => {
    fs.writeFileSync(
      path.join(TEST_OUTPUT, 'main.rs'),
      '// {{PROJECT_NAME}} server',
    );
    replacePlaceholders(TEST_OUTPUT, { '{{PROJECT_NAME}}': 'test-project' });
    const result = fs.readFileSync(path.join(TEST_OUTPUT, 'main.rs'), 'utf8');
    expect(result).toBe('// test-project server');
  });

  it('replaces placeholders in .tsx files', () => {
    fs.writeFileSync(
      path.join(TEST_OUTPUT, 'HomeIsland.tsx'),
      '<h1>{{PROJECT_NAME}}</h1>',
    );
    replacePlaceholders(TEST_OUTPUT, { '{{PROJECT_NAME}}': 'jsx-app' });
    const result = fs.readFileSync(path.join(TEST_OUTPUT, 'HomeIsland.tsx'), 'utf8');
    expect(result).toBe('<h1>jsx-app</h1>');
    expect(result).not.toContain('{{PROJECT_NAME}}');
  });

  it('replaces placeholders in .md files', () => {
    fs.writeFileSync(path.join(TEST_OUTPUT, 'README.md'), '# {{PROJECT_NAME}}');
    replacePlaceholders(TEST_OUTPUT, { '{{PROJECT_NAME}}': 'cool-app' });
    const result = fs.readFileSync(path.join(TEST_OUTPUT, 'README.md'), 'utf8');
    expect(result).toBe('# cool-app');
  });

  it('replaces multiple occurrences', () => {
    fs.writeFileSync(
      path.join(TEST_OUTPUT, 'test.toml'),
      '{{PROJECT_NAME}} is {{PROJECT_NAME}}',
    );
    replacePlaceholders(TEST_OUTPUT, { '{{PROJECT_NAME}}': 'app' });
    const result = fs.readFileSync(path.join(TEST_OUTPUT, 'test.toml'), 'utf8');
    expect(result).toBe('app is app');
  });

  it('handles nested directories', () => {
    const nested = path.join(TEST_OUTPUT, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'config.toml'), 'name = "{{PROJECT_NAME}}"');
    replacePlaceholders(TEST_OUTPUT, { '{{PROJECT_NAME}}': 'nested-app' });
    const result = fs.readFileSync(path.join(nested, 'config.toml'), 'utf8');
    expect(result).toBe('name = "nested-app"');
  });

  it('skips non-text files', () => {
    const binContent = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    fs.writeFileSync(path.join(TEST_OUTPUT, 'binary.wasm'), binContent);
    replacePlaceholders(TEST_OUTPUT, { '{{PROJECT_NAME}}': 'app' });
    const result = fs.readFileSync(path.join(TEST_OUTPUT, 'binary.wasm'));
    expect(result).toEqual(binContent);
  });

  it('handles multiple different placeholders', () => {
    fs.writeFileSync(
      path.join(TEST_OUTPUT, 'test.json'),
      '{"name": "{{PROJECT_NAME}}", "port": "{{PORT}}"}',
    );
    replacePlaceholders(TEST_OUTPUT, {
      '{{PROJECT_NAME}}': 'my-app',
      '{{PORT}}': '3000',
    });
    const result = fs.readFileSync(path.join(TEST_OUTPUT, 'test.json'), 'utf8');
    expect(result).toBe('{"name": "my-app", "port": "3000"}');
  });
});
