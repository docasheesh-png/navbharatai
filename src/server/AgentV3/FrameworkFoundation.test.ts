import { describe, it, expect } from 'vitest';
import { ensureViteReactFoundation, isViteReactTarget, sanitizeTsconfigExtends } from './FrameworkFoundation';

// The EXACT file set the deep-test Level-1 planner produced (build 7c56b35a) — 5 files, NO package.json.
const LEVEL1_PLANNER_OUTPUT: Record<string, string> = {
  'src/index.css': 'body { margin: 0; }',
  'src/components/HelloWorld.tsx': "import React from 'react';\nexport const HelloWorld = () => <h1>Hi</h1>;",
  'vite.config.ts': "import { defineConfig } from 'vite';\nexport default defineConfig({});",
  'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);",
  'src/App.tsx': "import React from 'react';\nimport { HelloWorld } from './components/HelloWorld';\nexport default function App() { return <HelloWorld />; }",
};

describe('ensureViteReactFoundation — the Level-1 planner-omitted-package.json regression', () => {
  it('synthesizes the missing package.json (the exact bug: npm install ENOENT)', () => {
    const res = ensureViteReactFoundation(LEVEL1_PLANNER_OUTPUT, { framework: 'vite-react', appName: 'Login' });
    expect(res.added).toContain('package.json');
    expect(res.files['package.json']).toBeDefined();
    const pkg = JSON.parse(res.files['package.json']);
    // React runtime baseline is always declared.
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.dependencies['react-dom']).toBeDefined();
    // The vite toolchain is in devDependencies so `npm run dev`/`vite build` resolve.
    expect(pkg.devDependencies.vite).toBeDefined();
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeDefined();
    // TS project ⇒ typescript + @types present.
    expect(pkg.devDependencies.typescript).toBeDefined();
    expect(pkg.devDependencies['@types/react']).toBeDefined();
    // A real dev script so `npm run dev` works.
    expect(pkg.scripts.dev).toBe('vite');
  });

  it('also supplies index.html (Vite has nothing to serve without it)', () => {
    const res = ensureViteReactFoundation(LEVEL1_PLANNER_OUTPUT, { framework: 'vite-react' });
    expect(res.added).toContain('index.html');
    // The generated HTML must boot the REAL entry that exists in the set.
    expect(res.files['index.html']).toContain('src="/src/main.tsx"');
    expect(res.files['index.html']).toContain('id="root"');
  });

  it('supplies tsconfig.json for a TypeScript app', () => {
    const res = ensureViteReactFoundation(LEVEL1_PLANNER_OUTPUT, { framework: 'vite-react' });
    expect(res.added).toContain('tsconfig.json');
    expect(() => JSON.parse(res.files['tsconfig.json'])).not.toThrow();
  });

  it('does NOT re-create vite.config.ts (the planner already wrote it)', () => {
    const res = ensureViteReactFoundation(LEVEL1_PLANNER_OUTPUT, { framework: 'vite-react' });
    expect(res.added).not.toContain('vite.config.ts');
    expect(res.files['vite.config.ts']).toBeUndefined();
  });
});

describe('ensureViteReactFoundation — dependency derivation from real imports', () => {
  it('declares third-party packages the code imports (so npm install fetches them)', () => {
    const files = {
      ...LEVEL1_PLANNER_OUTPUT,
      'src/store.ts': "import { create } from 'zustand';\nimport clsx from 'clsx';\nexport const s = create(() => ({}));",
      'src/icons.tsx': "import { Home } from 'lucide-react';\nexport const I = Home;",
    };
    const pkg = JSON.parse(ensureViteReactFoundation(files, { framework: 'vite-react' }).files['package.json']);
    expect(pkg.dependencies.zustand).toBe('latest');
    expect(pkg.dependencies.clsx).toBe('latest');
    expect(pkg.dependencies['lucide-react']).toBe('latest');
  });

  it('collapses sub-paths + scoped packages and ignores relative imports / the @ alias / builtins', () => {
    const files = {
      'src/App.tsx': [
        "import React from 'react';",
        "import { motion } from 'motion/react';",           // sub-path → 'motion'
        "import { z } from 'zod';",
        "import { thing } from '@dnd-kit/modifiers';",       // scoped
        "import { a } from './local';",                       // relative → ignored
        "import { b } from '@/lib/util';",                    // alias → ignored
        "import path from 'node:path';",                      // builtin → ignored
        'export default function App() { return null; }',
      ].join('\n'),
    };
    const pkg = JSON.parse(ensureViteReactFoundation(files, { framework: 'vite-react' }).files['package.json']);
    expect(pkg.dependencies.motion).toBe('latest');
    expect(pkg.dependencies.zod).toBe('latest');
    expect(pkg.dependencies['@dnd-kit/modifiers']).toBe('latest');
    expect(pkg.dependencies['./local']).toBeUndefined();
    expect(Object.keys(pkg.dependencies)).not.toContain('@/lib/util');
    expect(pkg.dependencies.path).toBeUndefined();
  });

  it('routes an imported @types/* package into devDependencies', () => {
    const files = {
      'src/App.tsx': "import React from 'react';\nimport 'node';\nexport default () => null;",
      'src/x.ts': "import type {} from '@types/uuid';\nexport const x = 1;",
    };
    const pkg = JSON.parse(ensureViteReactFoundation(files, { framework: 'vite-react' }).files['package.json']);
    expect(pkg.devDependencies['@types/uuid']).toBe('latest');
    expect(pkg.dependencies['@types/uuid']).toBeUndefined();
  });
});

describe('ensureViteReactFoundation — idempotence & non-destructiveness', () => {
  it('returns nothing when the project already has every foundational file', () => {
    const complete = {
      'package.json': '{"name":"x","dependencies":{"react":"^18"}}',
      'index.html': '<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>',
      'vite.config.ts': 'export default {};',
      'tsconfig.json': '{}',
      // The release typecheck config is foundational too (2026-08-11): without it the generated build
      // script `tsc -p tsconfig.build.json` cannot run at all.
      'tsconfig.build.json': '{"extends":"./tsconfig.json"}',
      'src/main.tsx': "import App from './App';",
      'src/App.tsx': 'export default () => null;',
    };
    const res = ensureViteReactFoundation(complete, { framework: 'vite-react' });
    expect(res.added).toEqual([]);
    expect(Object.keys(res.files)).toEqual([]);
  });

  it('running the guard on its own output is a no-op (true idempotence)', () => {
    const first = ensureViteReactFoundation(LEVEL1_PLANNER_OUTPUT, { framework: 'vite-react' });
    const merged = { ...LEVEL1_PLANNER_OUTPUT, ...first.files };
    const second = ensureViteReactFoundation(merged, { framework: 'vite-react' });
    expect(second.added).toEqual([]);
  });

  it('respects existingPaths (an actuator scaffold already on disk) and never re-creates them', () => {
    const res = ensureViteReactFoundation(LEVEL1_PLANNER_OUTPUT, {
      framework: 'vite-react',
      existingPaths: ['package.json', 'index.html', 'tsconfig.json', 'tsconfig.build.json'],
    });
    expect(res.added).toEqual([]); // everything missing-from-files is present on disk
  });

  it('synthesizes an entry only when an App exists but no entry does', () => {
    const noEntry = {
      'src/App.tsx': 'export default () => null;',
      'src/index.css': 'body{}',
    };
    const res = ensureViteReactFoundation(noEntry, { framework: 'vite-react' });
    expect(res.added).toContain('src/main.tsx');
    expect(res.files['src/main.tsx']).toContain("import App from './App'");
    expect(res.files['src/main.tsx']).toContain("import './index.css'");
  });
});

describe('isViteReactTarget — only touches vite-react, leaves other stacks alone', () => {
  it('true for vite-react / react / empty-with-react-imports', () => {
    expect(isViteReactTarget('vite-react', {})).toBe(true);
    expect(isViteReactTarget('react', {})).toBe(true);
    expect(isViteReactTarget('', { 'src/App.tsx': "import React from 'react';" })).toBe(true);
    expect(isViteReactTarget('', { 'vite.config.ts': 'export default {}' })).toBe(true);
  });

  it('false for Next.js / other frameworks (their foundation differs)', () => {
    expect(isViteReactTarget('nextjs', {})).toBe(false);
    expect(isViteReactTarget('next', {})).toBe(false);
    expect(isViteReactTarget('astro', {})).toBe(false);
    expect(isViteReactTarget('angular', {})).toBe(false);
    // A next.config file overrides even a react label.
    expect(isViteReactTarget('react', { 'next.config.js': 'module.exports = {}' })).toBe(false);
  });

  it('a Next.js build is left completely untouched by the guard', () => {
    const res = ensureViteReactFoundation({ 'app/page.tsx': 'export default () => null;' }, { framework: 'nextjs' });
    expect(res.added).toEqual([]);
    expect(Object.keys(res.files)).toEqual([]);
  });
});

describe('sanitizeTsconfigExtends — strip a dangling tsconfig `extends` (autopsy buildId 9245f090)', () => {
  const REACT_PKG = JSON.stringify({
    name: 'saas-admin-dashboard',
    dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
    devDependencies: { typescript: '^5.5.3', vite: '^5.4.1', '@vitejs/plugin-react': '^4.3.1' },
  });

  it('removes an `extends` to a package NOT in package.json (the phantom @tsconfig/react)', () => {
    const files = {
      'package.json': REACT_PKG,
      'tsconfig.app.json': JSON.stringify({ extends: '@tsconfig/react/tsconfig.json', compilerOptions: { jsx: 'react-jsx', strict: true } }, null, 2),
    };
    const res = sanitizeTsconfigExtends(files);
    expect(res.fixes).toHaveLength(1);
    expect(res.fixes[0].file).toBe('tsconfig.app.json');
    expect(res.fixes[0].removed).toEqual(['@tsconfig/react/tsconfig.json']);
    const out = JSON.parse(res.patch['tsconfig.app.json']);
    expect(out.extends).toBeUndefined(); // dangling extends gone
    expect(out.compilerOptions.jsx).toBe('react-jsx'); // the file's own options are preserved
  });

  it('KEEPS an `extends` whose package IS a declared dependency', () => {
    const files = {
      'package.json': JSON.stringify({ devDependencies: { '@tsconfig/node20': '^20.0.0' } }),
      'tsconfig.json': JSON.stringify({ extends: '@tsconfig/node20/tsconfig.json', compilerOptions: {} }),
    };
    expect(sanitizeTsconfigExtends(files).fixes).toHaveLength(0);
  });

  it('KEEPS a relative `extends` (a local base file), never treats it as a package', () => {
    const files = {
      'package.json': REACT_PKG,
      'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: {} }),
    };
    expect(sanitizeTsconfigExtends(files).fixes).toHaveLength(0);
  });

  it('filters only the dangling entry from an `extends` ARRAY, keeping resolvable ones', () => {
    const files = {
      'package.json': JSON.stringify({ devDependencies: { '@tsconfig/strictest': '^2.0.0' } }),
      'tsconfig.json': JSON.stringify({ extends: ['@tsconfig/strictest/tsconfig.json', '@tsconfig/react/tsconfig.json', './base.json'], compilerOptions: {} }),
    };
    const res = sanitizeTsconfigExtends(files);
    expect(res.fixes[0].removed).toEqual(['@tsconfig/react/tsconfig.json']);
    const out = JSON.parse(res.patch['tsconfig.json']);
    expect(out.extends).toEqual(['@tsconfig/strictest/tsconfig.json', './base.json']);
  });

  it('leaves a coherent project untouched (no extends, or only resolvable ones)', () => {
    const files = {
      'package.json': REACT_PKG,
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'tsconfig.app.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }),
    };
    const res = sanitizeTsconfigExtends(files);
    expect(res.fixes).toHaveLength(0);
    expect(Object.keys(res.patch)).toHaveLength(0);
  });

  it('handles a tsconfig with comments (JSONC) and still strips the phantom extends', () => {
    const files = {
      'package.json': REACT_PKG,
      'tsconfig.app.json': '{\n  // app config\n  "extends": "@tsconfig/react/tsconfig.json",\n  "compilerOptions": { "strict": true }, // trailing comma ok\n}',
    };
    const res = sanitizeTsconfigExtends(files);
    expect(res.fixes).toHaveLength(1);
    expect(JSON.parse(res.patch['tsconfig.app.json']).extends).toBeUndefined();
  });

  it('skips an unparseable tsconfig rather than corrupting it', () => {
    const files = { 'package.json': REACT_PKG, 'tsconfig.json': 'this is not json at all {{{' };
    expect(sanitizeTsconfigExtends(files).fixes).toHaveLength(0);
  });
});
