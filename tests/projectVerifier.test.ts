import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { verifyProject, extractBareImports } from '../src/server/project/ProjectVerifier';

const vfsFrom = (f: Record<string, string>) => VirtualFileSystem.fromRecord(f);

describe('verifyProject', () => {
  it('passes a clean static project', () => {
    const r = verifyProject(vfsFrom({
      'index.html': '<link rel="stylesheet" href="style.css"><script src="app.js"></script>',
      'style.css': 'body{}', 'app.js': 'var a=1;',
    }));
    expect(r.ok).toBe(true);
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
  });

  it('flags invalid JSON as an error', () => {
    const r = verifyProject(vfsFrom({ 'index.html': '<h1>x</h1>', 'data.json': '{ bad json' }));
    expect(r.ok).toBe(false);
    expect(r.errors).toBe(1);
    expect(r.issues[0].message).toMatch(/Invalid JSON/);
  });

  it('flags a missing entry for a static project', () => {
    const r = verifyProject(vfsFrom({ 'style.css': 'body{}' }));
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => /No entry point/.test(i.message))).toBe(true);
  });

  it('warns on broken non-critical local refs (images) but does not flag CDN urls', () => {
    const r = verifyProject(vfsFrom({
      'index.html': '<img src="missing.png"><script src="https://cdn.x/y.js"></script>',
    }));
    expect(r.warnings).toBe(1); // only missing.png (a broken image, not a hard break)
    expect(r.issues.some(i => /missing\.png/.test(i.message))).toBe(true);
    expect(r.issues.some(i => /cdn\.x/.test(i.message))).toBe(false);
    expect(r.ok).toBe(true); // an image warning doesn't fail the project
  });

  it('flags a missing classic <script src> or stylesheet <link> as an ERROR (hard break)', () => {
    const r = verifyProject(vfsFrom({
      'index.html': '<link rel="stylesheet" href="missing.css"><script src="app.js"></script>',
    }));
    expect(r.ok).toBe(false); // a static app whose JS/CSS is missing IS broken
    expect(r.issues.some(i => i.severity === 'error' && /missing\.css/.test(i.message))).toBe(true);
    expect(r.issues.some(i => i.severity === 'error' && /app\.js/.test(i.message))).toBe(true);
    // a type="module" script (bundler-resolved) stays a non-blocking warning
    const r2 = verifyProject(vfsFrom({ 'index.html': '<script type="module" src="missing-entry.js"></script><div>x</div>' }));
    expect(r2.errors).toBe(0);
  });

  it('does not flag missing entry when package.json present (build project)', () => {
    const r = verifyProject(vfsFrom({ 'package.json': JSON.stringify({ name: 'x' }), 'src/index.js': 'const a = 1;' }));
    expect(r.issues.some(i => /No entry point/.test(i.message))).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('flags a dangling relative import as an error', () => {
    const r = verifyProject(vfsFrom({
      'index.html': '<div id="root"></div><script type="module" src="main.jsx"></script>',
      'main.jsx': "import App from './App.jsx';\n",
    }));
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => /Broken import.*App\.jsx/.test(i.message))).toBe(true);
  });

  it('resolves relative imports across extensions and /index', () => {
    const r = verifyProject(vfsFrom({
      'index.html': '<script type="module" src="main.jsx"></script>',
      'main.jsx': "import App from './App';\nimport './styles.css';\nimport { x } from './util/index';\n",
      'App.jsx': 'export default function App(){return null;}',
      'styles.css': 'body{}',
      'util/index.js': 'export const x = 1;',
    }));
    expect(r.issues.some(i => /Broken import/.test(i.message))).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('warns when a bare dependency is not declared in package.json', () => {
    const r = verifyProject(vfsFrom({
      'package.json': JSON.stringify({ dependencies: { react: '^18' } }),
      'index.html': '<script type="module" src="src/main.jsx"></script>',
      'src/main.jsx': "import React from 'react';\nimport { create } from 'zustand';\n",
    }));
    expect(r.issues.some(i => /zustand.*not in package\.json/.test(i.message))).toBe(true);
    expect(r.issues.some(i => /react.*not in package\.json/.test(i.message))).toBe(false); // react is declared
    expect(r.ok).toBe(true); // it's a warning, not an error
  });

  it('does not flag node builtins or scoped deps incorrectly', () => {
    const r = verifyProject(vfsFrom({
      'package.json': JSON.stringify({ dependencies: { '@scope/lib': '^1' } }),
      'src/index.ts': "import fs from 'node:fs';\nimport path from 'path';\nimport x from '@scope/lib/sub';\n",
      'index.html': '<script type="module" src="src/index.ts"></script>',
    }));
    expect(r.warnings).toBe(0);
  });
});

describe('extractBareImports', () => {
  it('returns expected bare roots from source files', () => {
    const result = extractBareImports(vfsFrom({
      'package.json': JSON.stringify({ dependencies: { react: '^18' } }),
      'src/main.tsx': "import React from 'react';\nimport { create } from 'zustand';\nimport './local';\n",
      'src/utils.ts': "import axios from 'axios';\nimport fs from 'fs';\n",
    }));
    expect(result).toContain('react');
    expect(result).toContain('zustand');
    expect(result).toContain('axios');
    expect(result).not.toContain('fs');          // node builtin excluded
    expect(result).not.toContain('./local');     // relative excluded
  });

  it('deduplicates across files', () => {
    const result = extractBareImports(vfsFrom({
      'package.json': JSON.stringify({}),
      'src/a.ts': "import axios from 'axios';",
      'src/b.ts': "import axios from 'axios';",
    }));
    expect(result.filter(p => p === 'axios')).toHaveLength(1);
  });

  it('returns empty array for a static project with no source files', () => {
    const result = extractBareImports(vfsFrom({
      'index.html': '<h1>Hello</h1>',
      'style.css': 'body {}',
    }));
    expect(result).toHaveLength(0);
  });
});
